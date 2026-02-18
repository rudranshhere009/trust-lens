from __future__ import annotations

import re
import time
import uuid
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, TypedDict
from urllib.parse import quote, urlparse

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from langgraph.graph import END, StateGraph


class RunRequest(BaseModel):
    claim: str = ""
    source_url: str = ""
    context: str = ""
    input_type: Literal["url", "image", "document"] = "url"
    file_name: str = ""


class SourceItem(BaseModel):
    title: str
    url: str
    snippet: str
    source: Literal["web", "wikipedia", "duckduckgo"] = "web"
    quality: Literal["high", "medium", "low"] = "medium"
    stance: Literal["support", "oppose", "neutral"] = "neutral"
    quote: str = ""


class SubClaimVerdict(BaseModel):
    sub_claim: str
    verdict: Literal["True", "Mostly True", "Mixed", "Mostly False", "False", "Unverifiable"]
    supporting: int
    opposing: int
    strongest_links: List[str] = Field(default_factory=list)
    strongest_quotes: List[str] = Field(default_factory=list)


class RunResponse(BaseModel):
    claim: str
    verdict: Literal["True", "Mostly True", "Mixed", "Mostly False", "False", "Unverifiable"]
    confidence: int
    timeline: List[str]
    source_count: int
    sources: List[SourceItem]
    sub_claims: List[str]
    table: List[SubClaimVerdict]
    gaps: List[str]
    recommendations: List[Dict[str, str]]


class ChatAsset(BaseModel):
    id: str
    name: str
    type: str
    summary: str
    extracted_text: str = ""


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    mode: Literal["legal", "compliance", "truthdesk"]
    question: str
    selected_asset: Optional[ChatAsset] = None
    history: List[ChatTurn] = Field(default_factory=list)


class ChatResponse(BaseModel):
    answer: str
    used_asset: bool


class GraphState(TypedDict):
    claim: str
    source_url: str
    context: str
    input_type: Literal["url", "image", "document"]
    file_name: str
    anchor_text: str
    anchor_terms: List[str]
    timeline: List[str]
    sub_claims: List[str]
    queries: List[str]
    pivot_queries: List[str]
    discovered_links: List[str]
    sources: List[Dict[str, Any]]
    table: List[Dict[str, Any]]
    verdict: str
    confidence: int
    gaps: List[str]
    recommendations: List[Dict[str, str]]


STOPWORDS = {
    "the",
    "and",
    "for",
    "that",
    "with",
    "this",
    "from",
    "have",
    "will",
    "would",
    "could",
    "about",
    "http",
    "https",
    "www",
    "news",
    "report",
    "article",
    "update",
    "said",
    "says",
    "saying",
    "also",
    "into",
    "over",
    "after",
    "before",
    "their",
    "there",
    "where",
    "when",
    "what",
    "which",
}


def _n(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def _domain(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower().removeprefix("www.")
    except Exception:
        return ""


def _canon(url: str) -> str:
    try:
        p = urlparse(url.strip())
        host = (p.hostname or "").lower()
        if not host:
            return url
        path = p.path.rstrip("/") or "/"
        # Strip query/fragment to reduce duplicates and force stable https canonical form.
        return f"https://{host}{path}"
    except Exception:
        return url


def _readable(url: str, max_chars: int = 30000) -> str:
    try:
        u = url if url.startswith("http") else f"https://{url}"
        proxy = f"https://r.jina.ai/http://{u.replace('https://', '').replace('http://', '')}"
        r = requests.get(proxy, timeout=25)
        if r.status_code >= 400:
            return ""
        return _n(r.text)[:max_chars]
    except Exception:
        return ""


def _extract_links(text: str) -> List[str]:
    links = re.findall(r"https?://[^\s\"'<>)]+", text or "")
    cleaned = [_canon(x.rstrip(".,);")) for x in links]
    seen = set()
    out = []
    for x in cleaned:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def _keywords(text: str, k: int = 8) -> List[str]:
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9]{3,}", (text or "").lower())
    freq: Dict[str, int] = {}
    for w in words:
        if w in STOPWORDS:
            continue
        freq[w] = freq.get(w, 0) + 1
    return [x for x, _ in sorted(freq.items(), key=lambda it: it[1], reverse=True)[:k]]


def _slug_keywords(url: str, k: int = 8) -> List[str]:
    p = urlparse(url or "")
    slug = f"{p.path} {p.netloc}".replace("-", " ").replace("_", " ")
    return _keywords(slug, k)


def _term_overlap_score(text: str, terms: List[str]) -> float:
    if not terms:
        return 0.0
    t = set(_keywords(text, 30))
    if not t:
        return 0.0
    hits = sum(1 for x in terms if x in t)
    return hits / max(1, len(terms))


def _quality(url: str) -> Literal["high", "medium", "low"]:
    d = _domain(url)
    if any(d.endswith(x) for x in [".gov", ".edu"]) or "pubmed" in d or "nature.com" in d:
        return "high"
    if "wikipedia.org" in d or "reuters.com" in d or "apnews.com" in d:
        return "medium"
    return "low"


def _blocked_domain(url: str) -> bool:
    d = _domain(url)
    if not d:
        return True
    blocked = {
        "r.jina.ai",
        "duckduckgo.com",
        "news.google.com",
        "google.com",
        "microsoft.com",
        "bing.com",
        "localhost",
        "127.0.0.1",
    }
    return d in blocked


def _is_relevant_candidate(
    url: str,
    body: str,
    anchor_terms: List[str],
    sub_claim_terms: List[str],
    source_domain: str,
) -> bool:
    if _blocked_domain(url):
        return False
    if len(body) < 240:
        return False
    overlap_anchor = _term_overlap_score(body, anchor_terms[:12])
    overlap_sub = _term_overlap_score(body, sub_claim_terms[:14])
    d = _domain(url)
    same_domain_boost = bool(source_domain and d.endswith(source_domain))
    # Strong topic lock: either meaningful semantic overlap, or moderate overlap plus source-domain affinity.
    if overlap_anchor >= 0.22 or overlap_sub >= 0.22:
        return True
    if same_domain_boost and (overlap_anchor >= 0.14 or overlap_sub >= 0.14):
        return True
    return False


def _stance(claim: str, snippet: str) -> Literal["support", "oppose", "neutral"]:
    t = f"{claim} {snippet}".lower()
    if any(x in t for x in ["debunk", "false", "hoax", "not true", "retracted", "denied"]):
        return "oppose"
    if any(x in t for x in ["confirmed", "official", "announced", "reported", "verified"]):
        return "support"
    return "neutral"


def _rss_links(query: str) -> List[str]:
    q = quote(query)
    feeds = [
        f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en",
        f"https://news.google.com/rss/search?q={q}+debunked&hl=en-US&gl=US&ceid=US:en",
    ]
    out: List[str] = []
    for f in feeds:
        # Prefer direct RSS fetch first; fallback to readable proxy.
        xml = ""
        try:
            r = requests.get(f, timeout=20)
            if r.status_code < 400:
                xml = r.text
        except Exception:
            xml = ""
        if not xml:
            xml = _readable(f, 80000)

        if xml:
            try:
                root = ET.fromstring(xml)
                for item in root.findall(".//item"):
                    link_node = item.find("link")
                    if link_node is not None and (link_node.text or "").strip():
                        out.append(_canon((link_node.text or "").strip()))
            except Exception:
                out.extend(_extract_links(xml))
    return out


def _image_vertical_links(query: str) -> List[str]:
    q = quote(query)
    targets = [
        f"https://www.google.com/search?tbm=isch&q={q}",
        f"https://www.bing.com/images/search?q={q}",
    ]
    out: List[str] = []
    for t in targets:
        body = _readable(t, 90000)
        if not body:
            continue
        out.extend(_extract_links(body))
    return out


def _ddg_links(query: str) -> List[str]:
    try:
        u = f"https://duckduckgo.com/?q={quote(query)}&format=json&no_html=1&skip_disambig=1"
        r = requests.get(u, timeout=20)
        if r.status_code >= 400:
            return []
        js = r.json()
        out = []
        if js.get("AbstractURL"):
            out.append(_canon(js["AbstractURL"]))
        for item in js.get("RelatedTopics", [])[:20]:
            if isinstance(item, dict):
                if item.get("FirstURL"):
                    out.append(_canon(item["FirstURL"]))
                for child in item.get("Topics", []) or []:
                    if isinstance(child, dict) and child.get("FirstURL"):
                        out.append(_canon(child["FirstURL"]))
        return out
    except Exception:
        return []


def _wiki_links(query: str) -> List[str]:
    try:
        u = (
            "https://en.wikipedia.org/w/api.php?action=query&list=search"
            f"&srsearch={quote(query)}&utf8=&format=json&origin=*"
        )
        r = requests.get(u, timeout=20)
        if r.status_code >= 400:
            return []
        js = r.json()
        out = []
        for s in js.get("query", {}).get("search", [])[:8]:
            t = s.get("title")
            if t:
                out.append(_canon(f"https://en.wikipedia.org/wiki/{quote(t.replace(' ', '_'))}"))
        return out
    except Exception:
        return []


def node_decomposer(state: GraphState) -> GraphState:
    claim = _n(state["claim"])
    input_type = state.get("input_type", "url")
    file_name = _n(state.get("file_name", ""))
    anchor_text = ""
    if state.get("source_url"):
        anchor_text = _readable(state["source_url"], 45000)
        if anchor_text:
            claim = _n(claim or anchor_text[:240])
    if input_type in {"image", "document"} and state.get("context"):
        claim = _n(claim or state["context"][:360])
    if not claim and file_name:
        claim = re.sub(r"\.[a-z0-9]{2,5}$", "", file_name, flags=re.I).replace("-", " ").replace("_", " ")
    state["anchor_text"] = anchor_text
    slug_terms = _slug_keywords(state.get("source_url", ""), 8)
    state["anchor_terms"] = list(dict.fromkeys(_keywords(f"{claim} {anchor_text}", 14) + slug_terms))[:18]
    if not claim and state["source_url"]:
        claim = _n(state["source_url"])
    parts = [p for p in re.split(r"\b(?:and|but|while|because|,|;)\b", claim) if _n(p)]
    sub_claims = [_n(p) for p in parts[:8] if len(_n(p)) > 15]
    if len(sub_claims) < 4:
        kws = _keywords(claim, 12)
        while len(sub_claims) < 4 and kws:
            sub_claims.append(" ".join(kws[: min(6, len(kws))]))
            kws = kws[2:]
    sub_claims = sub_claims[:8]
    state["sub_claims"] = sub_claims
    state["timeline"].append(
        f"Decomposer: generated {len(sub_claims)} sub-claims with {len(state['anchor_terms'])} anchor terms."
    )
    return state


def node_planner(state: GraphState) -> GraphState:
    claim = state["claim"]
    input_type = state.get("input_type", "url")
    file_name = state.get("file_name", "")
    kws = _keywords(f"{claim} {state.get('context', '')} {state.get('anchor_text', '')}", 12)
    anchor_terms = state.get("anchor_terms", [])[:10]
    base = " ".join(kws[:6]) if kws else claim
    anchor_base = " ".join(anchor_terms[:6]) if anchor_terms else base
    queries = [
        anchor_base,
        f"{anchor_base} official statement",
        f"{anchor_base} Reuters AP",
        f"{anchor_base} debunked false",
        f"{anchor_base} criticism",
        f"{anchor_base} retracted",
        f"{anchor_base} filetype:pdf",
        f"{anchor_base} site:.gov",
        f"{anchor_base} site:pubmed.ncbi.nlm.nih.gov",
        f"{anchor_base} site:scholar.google.com",
        f"{anchor_base} fact check",
        f"{anchor_base} primary source",
    ]
    if input_type == "document":
        doc_terms = _keywords(f"{state.get('context', '')} {file_name}", 10)
        doc_base = " ".join(doc_terms[:6]) if doc_terms else anchor_base
        queries.extend(
            [
                f"{doc_base} official pdf",
                f"{doc_base} document verification",
                f"{doc_base} legal filing statement",
            ]
        )
    if input_type == "image":
        img_terms = _keywords(f"{state.get('context', '')} {file_name} {claim}", 10)
        img_base = " ".join(img_terms[:6]) if img_terms else anchor_base
        queries.extend(
            [
                f"{img_base} reverse image search",
                f"{img_base} image fact check",
                f"{img_base} visual match source",
                f"{img_base} photo verification",
            ]
        )
    state["queries"] = list(dict.fromkeys([_n(q) for q in queries if _n(q)]))[:12]
    state["timeline"].append(f"Planner: generated {len(state['queries'])} diverse queries.")
    return state


def node_searcher(state: GraphState) -> GraphState:
    links = []
    input_type = state.get("input_type", "url")
    # Seed directly from submitted article/video readable body first.
    if state.get("anchor_text"):
        links.extend(_extract_links(state["anchor_text"]))
    for q in state["queries"]:
        links.extend(_rss_links(q))
        # Keep DDG/Wiki as low-priority enrichers only.
        if len(links) < 120:
            links.extend(_ddg_links(q))
        if len(links) < 140:
            links.extend(_wiki_links(q))
        if input_type == "image":
            links.extend(_image_vertical_links(q))
    if state["source_url"]:
        links.insert(0, _canon(state["source_url"]))
    dedup = []
    seen = set()
    source_domain = _domain(state.get("source_url", ""))
    for l in links:
        if not l or l in seen:
            continue
        if _blocked_domain(l):
            continue
        seen.add(l)
        dedup.append(l)
    # Prioritize same-domain and known news-like domains before long-tail.
    dedup.sort(key=lambda u: (0 if _domain(u).endswith(source_domain) and source_domain else 1, 0 if "news" in _domain(u) else 1))
    state["discovered_links"] = dedup[:220]
    state["timeline"].append(f"Searcher: collected {len(state['discovered_links'])} candidate links.")
    return state


def _extract_quote(text: str, claim: str) -> str:
    sents = re.split(r"[.!?]\s+", text)
    best = ""
    best_score = -1
    claim_words = set(_keywords(claim, 12))
    for s in sents[:120]:
        ns = _n(s)
        if len(ns) < 40:
            continue
        words = set(_keywords(ns, 12))
        score = len(claim_words.intersection(words))
        if score > best_score:
            best_score = score
            best = ns
    return best[:320]


def node_browser_chain(state: GraphState) -> GraphState:
    links = state["discovered_links"][:120]
    source_seen = set()
    sources: List[Dict[str, Any]] = []
    queue = list(links)
    iterations = 0
    anchor_terms = state.get("anchor_terms", [])
    sub_claim_terms = _keywords(" ".join(state.get("sub_claims", [])), 20)
    source_domain = _domain(state.get("source_url", ""))
    seen_domains: Dict[str, int] = {}
    while queue and len(source_seen) < 35 and iterations < 220:
        iterations += 1
        url = _canon(queue.pop(0))
        if url in source_seen:
            continue
        d = _domain(url)
        if _blocked_domain(url):
            continue
        # Keep source diversity; avoid flooding from one domain.
        if d and seen_domains.get(d, 0) >= 4:
            continue
        # Try direct first, then readable proxy fallback.
        body = ""
        try:
            r = requests.get(url, timeout=20)
            if r.status_code < 400:
                body = _n(r.text)[:40000]
        except Exception:
            body = ""
        if len(body) < 120:
            body = _readable(url, 40000)

        if not _is_relevant_candidate(url, body, anchor_terms, sub_claim_terms, source_domain):
            continue
        source_seen.add(url)
        seen_domains[d] = seen_domains.get(d, 0) + 1
        quote = _extract_quote(body, state["claim"])
        snippet = quote or body[:260]
        sources.append(
            {
                "title": d or "Source",
                "url": url,
                "snippet": snippet[:260],
                "source": "web",
                "quality": _quality(url),
                "stance": _stance(state["claim"], snippet),
                "quote": quote,
            }
        )
        newly_mentioned = _extract_links(body)
        ranked = []
        for x in newly_mentioned:
            cx = _canon(x)
            dx = _domain(cx)
            if not dx or cx in source_seen or _blocked_domain(cx):
                continue
            ranked.append(cx)
        ranked.sort(key=lambda x: (0 if source_domain and _domain(x).endswith(source_domain) else 1))
        for x in ranked[:8]:
            queue.append(x)
    state["sources"] = sources
    state["timeline"].append(f"Browser chain: processed {len(sources)} quality sources.")
    return state


def node_critic(state: GraphState) -> GraphState:
    if len(state["sources"]) < 25:
        state["timeline"].append("Shallow / circular results. Pivoting to new angles:")
        c = state["claim"]
        state["pivot_queries"] = [
            f"{c} site:.gov",
            f"{c} site:pubmed.ncbi.nlm.nih.gov",
            f"{c} site:scholar.google.com",
            f"{c} filetype:pdf",
            f"{c} debunked false criticism",
        ]
        more = []
        for q in state["pivot_queries"]:
            more.extend(_rss_links(q))
            more.extend(_ddg_links(q))
        seen = {x["url"] for x in state["sources"]}
        for l in more:
            cl = _canon(l)
            if cl and cl not in seen:
                seen.add(cl)
                if _blocked_domain(cl):
                    continue
                body = _readable(cl, 25000)
                sub_claim_terms = _keywords(" ".join(state.get("sub_claims", [])), 20)
                if not _is_relevant_candidate(
                    cl,
                    body,
                    state.get("anchor_terms", []),
                    sub_claim_terms,
                    _domain(state.get("source_url", "")),
                ):
                    continue
                quote = _extract_quote(body, state["claim"])
                sn = quote or body[:260]
                state["sources"].append(
                    {
                        "title": _domain(cl),
                        "url": cl,
                        "snippet": sn[:260],
                        "source": "web",
                        "quality": _quality(cl),
                        "stance": _stance(state["claim"], sn),
                        "quote": quote,
                    }
                )
                if len(state["sources"]) >= 35:
                    break
    state["timeline"].append(f"Critic: total sources after pivot {len(state['sources'])}.")
    return state


def node_synthesizer(state: GraphState) -> GraphState:
    sources = state["sources"]
    support = [s for s in sources if s["stance"] == "support"]
    oppose = [s for s in sources if s["stance"] == "oppose"]
    total = len(sources)
    if total < 30:
        verdict = "Unverifiable"
        confidence = 38
    else:
        ratio = (len(support) + 1) / (len(oppose) + 1)
        if ratio > 2.8:
            verdict = "True"
            confidence = 84
        elif ratio > 1.7:
            verdict = "Mostly True"
            confidence = 76
        elif ratio > 0.8:
            verdict = "Mixed"
            confidence = 62
        elif ratio > 0.45:
            verdict = "Mostly False"
            confidence = 70
        else:
            verdict = "False"
            confidence = 78

    table = []
    for sc in state["sub_claims"]:
        sup = [s for s in sources if _stance(sc, s["snippet"]) == "support"]
        opp = [s for s in sources if _stance(sc, s["snippet"]) == "oppose"]
        sv = "Unverifiable"
        if len(sup) > len(opp) * 2 and len(sup) >= 2:
            sv = "Mostly True"
        elif len(opp) > len(sup) * 2 and len(opp) >= 2:
            sv = "Mostly False"
        elif len(sup) + len(opp) >= 3:
            sv = "Mixed"
        table.append(
            {
                "sub_claim": sc,
                "verdict": sv,
                "supporting": len(sup),
                "opposing": len(opp),
                "strongest_links": [x["url"] for x in (sup[:2] + opp[:2])],
                "strongest_quotes": [x["quote"] for x in (sup[:2] + opp[:2]) if x.get("quote")],
            }
        )

    gaps = []
    if total < 30:
        gaps.append("Thin source depth (<30 sources) after chaining.")
    if len(oppose) == 0:
        gaps.append("Limited explicit counter-claim evidence discovered.")

    state["verdict"] = verdict
    state["confidence"] = confidence
    state["table"] = table
    state["gaps"] = gaps
    state["recommendations"] = [
        {"title": s["title"], "url": s["url"], "whyRelevant": "High-overlap source from deep chain."}
        for s in sources[:8]
    ]
    state["timeline"].append(f"Synthesizer: verdict {verdict} at confidence {confidence}%.")
    return state


def build_graph():
    g = StateGraph(GraphState)
    g.add_node("decomposer", node_decomposer)
    g.add_node("planner", node_planner)
    g.add_node("searcher", node_searcher)
    g.add_node("browser_chain", node_browser_chain)
    g.add_node("critic", node_critic)
    g.add_node("synthesizer", node_synthesizer)
    g.set_entry_point("decomposer")
    g.add_edge("decomposer", "planner")
    g.add_edge("planner", "searcher")
    g.add_edge("searcher", "browser_chain")
    g.add_edge("browser_chain", "critic")
    g.add_edge("critic", "synthesizer")
    g.add_edge("synthesizer", END)
    return g.compile()


GRAPH = build_graph()
app = FastAPI(title="TrustLens FactCheck Graph API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _initial_state(req: RunRequest) -> GraphState:
    return {
        "claim": _n(req.claim),
        "source_url": _n(req.source_url),
        "context": _n(req.context),
        "input_type": req.input_type,
        "file_name": _n(req.file_name),
        "timeline": [],
        "sub_claims": [],
        "queries": [],
        "pivot_queries": [],
        "discovered_links": [],
        "sources": [],
        "table": [],
        "verdict": "Unverifiable",
        "confidence": 25,
        "gaps": [],
        "recommendations": [],
    }


def _chat_fallback_answer(req: ChatRequest) -> str:
    q = _n(req.question)
    asset = req.selected_asset
    if asset:
        excerpt = _n((asset.extracted_text or "")[:1200])
        context_line = f"Attached file: {asset.name} ({asset.type}) | {asset.summary}"
        if excerpt:
            return (
                f"{context_line}\n\n"
                f"Question: {q}\n\n"
                f"Context excerpt:\n{excerpt}\n\n"
                "Fallback response: Backend received your file context. "
                "Configure Groq to generate full semantic answers."
            )
        return (
            f"{context_line}\n\nQuestion: {q}\n\n"
            "Fallback response: File metadata received. "
            "Configure Groq to answer deeply using extracted content."
        )
    return (
        f"Question: {q}\n\n"
        "Fallback response: No file attached. Use From Files to attach document/image context, "
        "then ask targeted questions."
    )


def _groq_answer(req: ChatRequest) -> Optional[str]:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant").strip()

    asset_text = ""
    if req.selected_asset:
        asset_text = (
            f"Attached file: {req.selected_asset.name} ({req.selected_asset.type})\n"
            f"Summary: {req.selected_asset.summary}\n"
            f"Extracted text:\n{_n(req.selected_asset.extracted_text)[:4000]}"
        )

    system_prompt = (
        "You are TrustLens Assistant. Answer clearly and operationally. "
        "If file context is attached, prioritize it. If evidence is insufficient, say what is missing."
    )
    messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    if asset_text:
        messages.append({"role": "system", "content": asset_text})
    for h in req.history[-8:]:
        messages.append({"role": h.role, "content": _n(h.content)[:2000]})
    messages.append({"role": "user", "content": _n(req.question)[:2500]})

    try:
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            timeout=45,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.2,
                "messages": messages,
            },
        )
        if r.status_code >= 400:
            return None
        js = r.json()
        content = (
            js.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        return _n(content) or None
    except Exception:
        return None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/factcheck/run", response_model=RunResponse)
def run_factcheck(req: RunRequest):
    if not req.claim and not req.source_url:
        raise HTTPException(status_code=400, detail="claim or source_url is required")

    start = time.time()
    state = _initial_state(req)
    out = GRAPH.invoke(state)
    elapsed = int((time.time() - start) * 1000)

    sources = [SourceItem(**s) for s in out["sources"][:35]]
    table = [SubClaimVerdict(**x) for x in out["table"]]
    verdict = out["verdict"]
    confidence = out["confidence"]
    if len(sources) < 30:
        verdict = "Unverifiable"
        confidence = min(confidence, 45)

    return RunResponse(
        claim=out["claim"] or out["source_url"],
        verdict=verdict,  # type: ignore[arg-type]
        confidence=int(confidence),
        timeline=out["timeline"] + [f"Total runtime {elapsed} ms."],
        source_count=len(sources),
        sources=sources,
        sub_claims=out["sub_claims"][:8],
        table=table,
        gaps=out["gaps"],
        recommendations=out["recommendations"][:8],
    )


@app.post("/api/factcheck/chat", response_model=ChatResponse)
def factcheck_chat(req: ChatRequest):
    if not _n(req.question):
        raise HTTPException(status_code=400, detail="question is required")
    ans = _groq_answer(req)
    if not ans:
        ans = _chat_fallback_answer(req)
    return ChatResponse(answer=ans, used_asset=bool(req.selected_asset))
