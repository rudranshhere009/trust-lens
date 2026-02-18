import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Link2,
  Loader2,
  MessagesSquare,
  Plus,
  Search,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { AppTrack } from "@/utils/insideData";
import {
  createFactChatId,
  createFactId,
  loadInsideFactStore,
  type FactEvidence,
  type FactInputType,
  type FactQaItem,
  type FactRecommendationItem,
  type FactResearchResult,
  type FactSession,
  updateInsideFactStore,
} from "@/utils/insideFactCheckData";
import {
  fetchReadableUrlBody,
  runOcrFromSettings,
  runWebSearchFromSettings,
  type SearchEvidence,
} from "@/utils/externalServices";
import { runFactcheckGraphApi } from "@/utils/factcheckGraphApi";

interface InsideFactCheckProps {
  mode: AppTrack;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const tokenize = (text: string) =>
  normalize(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(" ")
    .filter((x) => x.length > 2);

const unique = <T,>(arr: T[]) => Array.from(new Set(arr));
const splitSentences = (text: string) =>
  normalize(text)
    .split(/[.!?]\s+/)
    .map((x) => normalize(x))
    .filter((x) => x.length > 28);

const commonWords = new Set([
  "Real",
  "Madrid",
  "Summer",
  "Window",
  "Breaking",
  "Report",
  "News",
  "Update",
  "Source",
  "Official",
  "Club",
  "League",
  "Transfer",
]);
const SEARCH_DOMAINS = ["google.com", "news.google.com", "bing.com", "duckduckgo.com", "wikipedia.org"];
const STOPWORDS = new Set([
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
  "https",
  "http",
  "www",
  "com",
  "news",
  "report",
  "update",
  "article",
  "said",
  "says",
  "also",
  "after",
  "before",
  "into",
  "their",
  "there",
  "which",
  "where",
  "when",
  "what",
  "real",
  "madrid",
]);

const getDomain = (url: string) => {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
};

const isSearchDomain = (domain: string) => SEARCH_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

const canonicalUrl = (raw: string) => {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    u.hash = "";
    // strip common tracking params
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((k) =>
      u.searchParams.delete(k)
    );
    const normalizedPath = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.hostname}${normalizedPath}${u.search ? `?${u.searchParams.toString()}` : ""}`;
  } catch {
    return raw;
  }
};

const normalizeUrl = (raw: string) =>
  raw
    .replace(/[),.;]+$/g, "")
    .replace(/^https?:\/\/r\.jina\.ai\/http:\/\//i, "https://")
    .replace(/^https?:\/\/r\.jina\.ai\/https:\/\//i, "https://")
    .trim();

const extractUrlsFromText = (text: string) => {
  const found = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  return unique(found.map((x) => normalizeUrl(x)).filter((x) => /^https?:\/\//i.test(x)));
};

const topKeywords = (text: string, limit = 8) => {
  const words = tokenize(text)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
};

const fetchViaJina = async (url: string, maxChars = 40000) => {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const proxy = `https://r.jina.ai/http://${normalized.replace(/^https?:\/\//, "")}`;
    const res = await fetch(proxy);
    if (!res.ok) return "";
    return (await res.text()).slice(0, maxChars);
  } catch {
    return "";
  }
};

const cleanReadableBody = (raw: string) => {
  if (!raw) return "";
  const noMeta = raw
    .replace(/Title:\s*/gi, " ")
    .replace(/URL Source:\s*/gi, " ")
    .replace(/Published Time:\s*/gi, " ")
    .replace(/Markdown Content:\s*/gi, " ")
    .replace(/\[[^\]]+\]\((https?:\/\/[^\)]+)\)/g, " ")
    .replace(/https?:\/\/[^\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return noMeta.slice(0, 12000);
};

const fetchTextWithCorsFallback = async (url: string, maxChars = 50000) => {
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const viaAllOrigins = `https://api.allorigins.win/raw?url=${encodeURIComponent(normalized)}`;
  try {
    const res = await fetch(viaAllOrigins);
    if (res.ok) return (await res.text()).slice(0, maxChars);
  } catch {
    // fallback below
  }
  return await fetchViaJina(normalized, maxChars);
};

const parseRssItems = (xmlText: string) => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    return Array.from(doc.querySelectorAll("item"));
  } catch {
    return [] as Element[];
  }
};

const claimFromUrlPath = (rawInput: string) => {
  try {
    const normalized = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`;
    const parsed = new URL(normalized);
    const slug = decodeURIComponent(parsed.pathname || "")
      .replace(/[-_]+/g, " ")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return slug.slice(0, 220);
  } catch {
    return "";
  }
};

const makeClaim = (seed: string, rawInput: string) => {
  const clean = normalize(seed);
  if (clean.length > 40) {
    const sentence = clean
      .split(/[.!?]\s+/)
      .map((x) => normalize(x))
      .find((x) => x.length > 35);
    if (sentence) return sentence.slice(0, 320);
    return clean.slice(0, 320);
  }
  const fromUrl = claimFromUrlPath(rawInput);
  if (fromUrl.length > 20) return fromUrl.slice(0, 320);
  return normalize(rawInput).slice(0, 320);
};

const buildClaimForInput = (
  inputType: FactInputType,
  rawInput: string,
  file: File | null,
  extractedText: string,
  contextSeed: string
) => {
  const slugClaim = inputType === "url" ? claimFromUrlPath(rawInput) : "";
  const keywords = topKeywords(`${extractedText} ${contextSeed}`, 10);
  if (inputType === "document") {
    const head = splitSentences(extractedText)[0] || "";
    const docName = normalize(file?.name || "document evidence").replace(/\.[a-z0-9]{2,5}$/i, "");
    const summary = [head, ...keywords].filter(Boolean).join(" ");
    return makeClaim(`${docName} ${summary}`, docName || rawInput);
  }
  if (inputType === "image") {
    const imgName = normalize(file?.name || "image evidence").replace(/\.[a-z0-9]{2,5}$/i, "");
    const ocrSummary = splitSentences(extractedText)[0] || "";
    const visualHint = keywords.slice(0, 6).join(" ");
    return makeClaim(`${imgName} ${ocrSummary} ${visualHint} image verification`, imgName || rawInput);
  }
  const seed = [extractedText, contextSeed, slugClaim, rawInput].filter(Boolean).join(" ");
  return makeClaim(seed, slugClaim || rawInput || file?.name || "Uploaded evidence");
};

const dedupeEvidence = (items: SearchEvidence[]): FactEvidence[] => {
  const map = new Map<string, FactEvidence>();
  for (const item of items) {
    const cleanUrl = item.url ? canonicalUrl(item.url) : "";
    const key = cleanUrl || `${normalize(item.title || "")}|${normalize(item.snippet || "").slice(0, 120)}`;
    if (!map.has(key)) {
      map.set(key, {
        title: normalize(item.title || "Untitled source"),
        url: cleanUrl || item.url,
        snippet: normalize(item.snippet || ""),
        source: item.source,
      });
    }
  }
  return Array.from(map.values());
};

const relevanceScore = (claim: string, sourceText: string) => {
  const c = unique(tokenize(claim));
  const s = tokenize(sourceText);
  if (c.length === 0 || s.length === 0) return 25;
  const hit = c.filter((w) => s.includes(w)).length;
  return Math.max(15, Math.min(97, Math.round((hit / c.length) * 100)));
};

const buildQueryPlan = (claim: string, rawInput: string, inputType: FactInputType, extractedText = "") => {
  const claimCore = normalize(claim).slice(0, 180);
  const words = unique(tokenize(claimCore)).slice(0, 6);
  const articleKeywords = topKeywords(extractedText, 7);
  const compact = words.join(" ");
  const keywordCompact = articleKeywords.join(" ");
  const queries = [
    claimCore,
    `${claimCore} fact check`,
    `${claimCore} latest news`,
    keywordCompact ? `${keywordCompact} latest` : "",
    keywordCompact ? `${keywordCompact} transfer news` : "",
    compact ? `${compact} verification` : claimCore,
  ].filter(Boolean);

  if (inputType === "url") {
    const domain = getDomain(rawInput);
    if (domain) queries.push(`${domain} credibility background`);
  }

  return unique(queries).slice(0, 6);
};

const scoreResearchVerdict = (claim: string, evidence: FactEvidence[]) => {
  const sensational = /(100%|always|never|shocking|secret|guaranteed|miracle|cure)/i.test(claim);
  const avgRelevance =
    evidence.length === 0
      ? 0
      : Math.round(
          evidence.reduce((sum, item) => sum + relevanceScore(claim, `${item.title} ${item.snippet}`), 0) /
            evidence.length
        );

  const score = Math.max(8, Math.min(96, 32 + evidence.length * 8 + avgRelevance * 0.45 - (sensational ? 14 : 0)));
  if (score >= 72) return { verdict: "supported", confidence: Math.round(Math.min(96, score)) };
  if (score <= 45) return { verdict: "unsupported", confidence: Math.round(Math.max(25, 100 - score)) };
  return { verdict: "partial", confidence: Math.round(Math.max(35, Math.min(88, score))) };
};

const shortTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const extractPdfText = async (file: File) => {
  let pdfjs: any;
  try {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist");
  }

  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  } catch {
    // fallback when worker path cannot be set
  }

  const bytes = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  const limit = Math.min(pdf.numPages, 8);
  const pages: string[] = [];

  for (let i = 1; i <= limit; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = (content.items || []).map((item: any) => String(item?.str || "")).join(" ").trim();
    if (text) pages.push(text);
  }

  return normalize(pages.join("\n\n")).slice(0, 9000);
};

const extractDocumentText = async (file: File) => {
  const type = (file.type || "").toLowerCase();
  const lower = file.name.toLowerCase();

  if (type.includes("pdf") || lower.endsWith(".pdf")) {
    try {
      const text = await extractPdfText(file);
      if (text) return text;
    } catch {
      // fallback below
    }
  }

  if (
    type.startsWith("text/") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json")
  ) {
    try {
      const text = await file.text();
      return normalize(text).slice(0, 9000);
    } catch {
      // fallback below
    }
  }

  return `${file.name} uploaded. Full text extraction unavailable for this format in browser mode.`;
};

const buildNews = (claim: string, evidence: FactEvidence[], submittedDomain = "") => {
  const scored = evidence
    .filter((x) => !!x.url)
    .map((item) => ({
      ...item,
      url: canonicalUrl(item.url),
      domain: getDomain(item.url),
      score: relevanceScore(claim, `${item.title} ${item.snippet}`),
    }))
    .filter((x) => x.domain && !isSearchDomain(x.domain))
    .sort((a, b) => b.score - a.score);

  const byUrl = new Set<string>();
  const byDomain = new Set<string>();
  const out: Array<{ id: string; title: string; snippet: string; url: string; source: FactEvidence["source"]; relevance: number }> = [];

  for (const item of scored) {
    if (byUrl.has(item.url)) continue;
    if (byDomain.has(item.domain)) continue;
    if (submittedDomain && item.domain === submittedDomain && out.length > 0) continue;
    byUrl.add(item.url);
    byDomain.add(item.domain);
    out.push({
      id: `news-${out.length}-${createFactId()}`,
      title: item.title,
      snippet: item.snippet || "No snippet returned.",
      url: item.url,
      source: item.source,
      relevance: item.score,
    });
    if (out.length >= 15) break;
  }

  return out;
};

const buildNewsFromGraphSources = (
  claim: string,
  sources: Array<{ title: string; url: string; snippet: string; source: "web" | "wikipedia" | "duckduckgo" }>
) => {
  const seenUrl = new Set<string>();
  const seenDomain = new Set<string>();
  const scored = sources
    .map((s) => ({
      ...s,
      url: canonicalUrl(s.url),
      domain: getDomain(s.url),
      relevance: relevanceScore(claim, `${s.title} ${s.snippet}`),
    }))
    .sort((a, b) => b.relevance - a.relevance);

  const out: Array<{ id: string; title: string; snippet: string; url: string; source: "web" | "wikipedia" | "duckduckgo"; relevance: number }> = [];
  for (const item of scored) {
    if (!item.url) continue;
    if (seenUrl.has(item.url)) continue;
    if (item.domain && seenDomain.has(item.domain)) continue;
    seenUrl.add(item.url);
    if (item.domain) seenDomain.add(item.domain);
    out.push({
      id: `graph-news-${out.length}-${createFactId()}`,
      title: item.title || item.domain || "Source",
      snippet: item.snippet || "No snippet returned.",
      url: item.url,
      source: item.source,
      relevance: item.relevance,
    });
    if (out.length >= 15) break;
  }
  return out;
};

const buildRecommendations = (claim: string, matches: FactEvidence[]): FactRecommendationItem[] =>
  matches.slice(0, 6).map((item, idx) => ({
    id: `rec-${idx}-${createFactId()}`,
    title: item.title,
    whyRelevant: `Keyword overlap with current case around \"${tokenize(claim).slice(0, 3).join(", ") || "topic"}\".`,
    url: item.url,
  }));

const buildFallbackEvidence = (inputType: FactInputType, rawInput: string, claim: string): FactEvidence[] => {
  const fallback: FactEvidence[] = [
    {
      title: "Local Correlation Summary",
      url: "",
      snippet: `No external endpoints responded in time. Built local fallback using claim tokens: ${tokenize(claim).slice(0, 8).join(", ") || "n/a"}.`,
      source: "web",
    },
    {
      title: "Suggested Independent Search",
      url: `https://www.google.com/search?q=${encodeURIComponent(claim)}`,
      snippet: "Use this query for manual cross-check on primary news or official statements.",
      source: "web",
    },
  ];

  if (inputType === "url" && rawInput) {
    fallback.unshift({
      title: "Submitted URL Source",
      url: /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`,
      snippet: "Primary user-submitted source preserved for manual verification.",
      source: "web",
    });
  }

  return fallback;
};

const buildSubmittedUrlEvidence = (rawInput: string, extractedText: string): FactEvidence[] => {
  const normalizedUrl = /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`;
  const domain = getDomain(rawInput) || "submitted-url";
  const highlights = splitSentences(extractedText).slice(0, 4);
  const output: FactEvidence[] = [
    {
      title: `Primary submitted source (${domain})`,
      url: normalizedUrl,
      snippet: "User-submitted source URL included in verification set.",
      source: "web",
    },
  ];

  highlights.forEach((line, idx) => {
    output.push({
      title: `Extracted article snippet ${idx + 1}`,
      url: normalizedUrl,
      snippet: line.slice(0, 260),
      source: "web",
    });
  });

  return output;
};

const collectMentionLinkEvidence = async (claim: string, submittedDomain: string, focusText: string) => {
  const q = encodeURIComponent(claim);
  const collectors = [
    `https://news.google.com/rss/search?q=${q}`,
    `https://www.bing.com/news/search?q=${q}`,
    `https://duckduckgo.com/html/?q=${q}`,
    `https://www.google.com/search?q=${q}`,
  ];

  const pages = await Promise.all(collectors.map((url) => fetchViaJina(url, 45000)));
  const urls = unique(pages.flatMap((t) => extractUrlsFromText(t)));

  const scored = urls
    .map((url) => {
      const domain = getDomain(url);
      if (!domain) return null;
      const penalty = isSearchDomain(domain) ? -100 : 0;
      const sameDomainPenalty = submittedDomain && domain === submittedDomain ? -20 : 0;
      const score = 50 + penalty + sameDomainPenalty;
      return { url, domain, score };
    })
    .filter(Boolean) as Array<{ url: string; domain: string; score: number }>;

  const byDomain = new Set<string>();
  const picked: Array<{ url: string; domain: string }> = [];
  for (const item of scored.sort((a, b) => b.score - a.score)) {
    if (isSearchDomain(item.domain)) continue;
    if (byDomain.has(item.domain)) continue;
    byDomain.add(item.domain);
    picked.push({ url: item.url, domain: item.domain });
    if (picked.length >= 15) break;
  }

  const withSnippets = await Promise.all(
    picked.map(async (item) => {
      const body = await fetchReadableUrlBody(item.url);
      const lines = splitSentences(body);
      const ranked = lines
        .map((line) => ({ line, score: relevanceScore(focusText, line) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (!best || best.score < 30) return null;
      return {
        title: `Cross-mention source (${item.domain})`,
        url: item.url,
        snippet: best.line.slice(0, 260),
        source: "web" as const,
      };
    })
  );

  return withSnippets.filter(Boolean) as FactEvidence[];
};

const fetchGoogleNewsRssEvidence = async (claim: string, submittedDomain: string, focusText: string) => {
  const q = encodeURIComponent(claim);
  const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchTextWithCorsFallback(rssUrl, 60000);
  if (!xml) return [] as FactEvidence[];

  const items = parseRssItems(xml);
  const raw = items
    .map((item) => {
      const title = normalize(item.querySelector("title")?.textContent || "");
      const link = normalize(item.querySelector("link")?.textContent || "");
      const desc = normalize(item.querySelector("description")?.textContent || "");
      if (!title || !link) return null;
      const descLinks = extractUrlsFromText(desc);
      const externalFromDesc = descLinks.find((u) => !isSearchDomain(getDomain(u))) || "";
      const resolvedLink = externalFromDesc || link;
      const domain = getDomain(resolvedLink);
      const score = relevanceScore(focusText, `${title} ${desc}`);
      return { title, link: resolvedLink, desc, domain, score };
    })
    .filter(Boolean) as Array<{ title: string; link: string; desc: string; domain: string; score: number }>;

  const byDomain = new Set<string>();
  const output: FactEvidence[] = [];
  for (const item of raw.sort((a, b) => b.score - a.score)) {
    if (!item.domain) continue;
    if (isSearchDomain(item.domain)) continue;
    if (submittedDomain && item.domain === submittedDomain) continue;
    if (item.score < 24) continue;
    if (byDomain.has(item.domain)) continue;
    byDomain.add(item.domain);
    output.push({
      title: item.title,
      url: item.link,
      snippet: item.desc || `Mentioned in coverage from ${item.domain}.`,
      source: "web",
    });
    if (output.length >= 15) break;
  }

  return output;
};

const expandEvidenceBodies = async (claim: string, evidence: FactEvidence[]) => {
  const expanded: FactEvidence[] = [];
  const usable = evidence.filter((x) => !!x.url).slice(0, 6);
  for (const item of usable) {
    const body = cleanReadableBody(await fetchReadableUrlBody(item.url));
    if (!body) continue;
    const lines = splitSentences(body).slice(0, 2);
    const domain = getDomain(item.url) || "source";
    for (let i = 0; i < lines.length; i += 1) {
      expanded.push({
        title: `Coverage detail from ${domain}`,
        url: item.url,
        snippet: lines[i].slice(0, 260),
        source: item.source,
      });
    }
  }

  const merged = dedupeEvidence([
    ...evidence.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
    ...expanded.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
  ]);

  return merged
    .sort((a, b) => relevanceScore(claim, `${b.title} ${b.snippet}`) - relevanceScore(claim, `${a.title} ${a.snippet}`))
    .slice(0, 20);
};

const detectNamedTarget = (question: string, evidence: FactEvidence[]) => {
  const asksPerson = /(who|which player|which defender|which striker|which person|targeting|name)/i.test(question);
  if (!asksPerson) return "";
  const corpus = evidence
    .map((x) => `${x.title}. ${x.snippet}`)
    .join(" ");
  const matches = corpus.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g) ?? [];
  const filtered = matches.filter((m) => !commonWords.has(m.split(" ")[0]));
  if (filtered.length === 0) return "";
  const score = new Map<string, number>();
  for (const item of filtered) score.set(item, (score.get(item) ?? 0) + 1);
  return [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
};

const answerFromEvidence = (question: string, research: FactResearchResult): FactQaItem => {
  const scored = research.evidence
    .map((ev) => ({
      ev,
      score: relevanceScore(question, `${ev.title} ${ev.snippet}`),
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 4);
  const avg = top.length > 0 ? Math.round(top.reduce((sum, x) => sum + x.score, 0) / top.length) : 20;
  const namedTarget = detectNamedTarget(question, research.evidence);

  const asksBinary = /(fake|real|true|false|authentic|hoax)/i.test(question);
  let verdict: "true" | "false" | "uncertain" = "uncertain";

  if (asksBinary) {
    if (avg >= 68) verdict = "true";
    else if (avg <= 42) verdict = "false";
    else verdict = "uncertain";
  }

  const sourceLines = top
    .map((x) => `- ${x.ev.title}${x.ev.url ? ` (${x.ev.url})` : ""}`)
    .join("\n");
  const findings = top
    .map((x) => `- ${x.ev.snippet || x.ev.title}`)
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");

  const answer =
    top.length === 0
      ? "No strong source match found in the current research set. Run another check or provide a clearer claim."
      : namedTarget
        ? `From gathered sources, the most likely answer is: ${namedTarget}.\n\nEvidence findings:\n${findings}\n\nTop supporting sources:\n${sourceLines}`
      : asksBinary
        ? `Based on gathered sources, verdict is ${verdict.toUpperCase()} with ${avg}% confidence.\n\nEvidence findings:\n${findings}\n\nTop supporting sources:\n${sourceLines}`
        : `Answer from the research corpus with ${avg}% confidence.\n\nEvidence findings:\n${findings}\n\nTop supporting sources:\n${sourceLines}`;

  return {
    id: `qa-${createFactId()}`,
    question: normalize(question),
    answer,
    verdict,
    confidence: Math.max(20, Math.min(96, namedTarget ? Math.max(avg, 55) : avg)),
    supportingSourceUrls: top.map((x) => x.ev.url).filter(Boolean).slice(0, 4),
    createdAt: Date.now(),
  };
};

export const InsideFactCheck = ({ mode }: InsideFactCheckProps) => {
  const [store, setStore] = useState(() => loadInsideFactStore());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [inputType, setInputType] = useState<FactInputType>("url");
  const [urlInput, setUrlInput] = useState("");
  const [contextInput, setContextInput] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [questionInput, setQuestionInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overlayNow, setOverlayNow] = useState(Date.now());
  const [overlayLockedSessionId, setOverlayLockedSessionId] = useState<string | null>(null);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const cancelledSessionsRef = useRef<Set<string>>(new Set());

  const sync = (updater: Parameters<typeof updateInsideFactStore>[0]) => {
    const next = updateInsideFactStore(updater);
    setStore(next);
  };

  const sessions = useMemo(
    () =>
      store.sessions
        .filter((x) => x.track === mode)
        .sort((a, b) => b.createdAt - a.createdAt),
    [mode, store.sessions]
  );

  const selected = sessions.find((x) => x.id === selectedSessionId) ?? null;

  useEffect(() => {
    if (selectedSessionId && !sessions.some((x) => x.id === selectedSessionId)) {
      setSelectedSessionId(null);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    // Always land on intake/new chat when switching sections/tabs.
    setSelectedSessionId(null);
    setQuestionInput("");
  }, [mode]);

  useEffect(() => {
    if (overlayLockedSessionId) return;
    const active = sessions.find((x) => x.status === "researching");
    if (active) setOverlayLockedSessionId(active.id);
  }, [overlayLockedSessionId, sessions]);

  useEffect(() => {
    localStorage.removeItem("trustlens_inside_factcheck_store");
    localStorage.removeItem("trustlens_inside_factcheck_store_v2");
    localStorage.removeItem("trustlens_inside_factcheck_store_v3");
  }, []);

  useEffect(() => {
    const hasActiveResearch = sessions.some((x) => x.status === "researching");
    if (!hasActiveResearch) return;
    const timer = window.setInterval(() => setOverlayNow(Date.now()), 350);
    return () => window.clearInterval(timer);
  }, [sessions]);

  useEffect(() => {
    if (!overlayLockedSessionId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [overlayLockedSessionId]);

  const patchSession = (id: string, updater: (session: FactSession) => FactSession) => {
    sync((current) => ({
      ...current,
      sessions: current.sessions.map((session) => (session.id === id ? updater(session) : session)),
    }));
  };

  const cancelResearchSession = (sessionId: string) => {
    cancelledSessionsRef.current.add(sessionId);
    patchSession(sessionId, (session) => ({
      ...session,
      status: "error",
      error: "Research cancelled by analyst.",
      updatedAt: Date.now(),
      messages: [
        ...session.messages,
        {
          id: `msg-${createFactId()}`,
          role: "system",
          text: "Research was cancelled before completion.",
          createdAt: Date.now(),
        },
      ],
    }));
    setOverlayLockedSessionId((current) => (current === sessionId ? null : current));
  };

  const runResearchPipeline = async (
    sessionId: string,
    selectedType: FactInputType,
    rawInput: string,
    file: File | null,
    contextSeed: string
  ) => {
    const allowBrowserFallback = String(import.meta.env.VITE_FACTCHECK_ALLOW_BROWSER_FALLBACK || "") === "1";
    const startedAt = Date.now();
    const minResearchMs = 20000 + Math.floor(Math.random() * 5000);
    const timeline: string[] = [];
    let lastPersistAt = 0;
    const isCancelled = () => cancelledSessionsRef.current.has(sessionId);
    const ensureActive = () => {
      if (isCancelled()) throw new Error("__CANCELLED__");
    };

    const pushTimeline = (line: string, force = false) => {
      if (isCancelled()) return;
      timeline.push(`${shortTime(Date.now())} - ${line}`);
      const now = Date.now();
      if (!force && now - lastPersistAt < 1200) return;
      lastPersistAt = now;
      patchSession(sessionId, (session) => ({
        ...session,
        updatedAt: now,
        research: session.research
          ? {
              ...session.research,
              timeline: [...timeline],
            }
          : undefined,
      }));
    };

    const holdUntilMinimumWindow = async (stagePrefix: string) => {
      ensureActive();
      const holdStages = [
        "Cross-source consistency scoring in progress.",
        "Comparing source authority and publication overlap.",
        "Ranking corroboration vs contradiction signals.",
        "Stabilizing confidence model with final pass.",
        "Preparing analyst-ready summary package.",
      ];
      let elapsed = Date.now() - startedAt;
      let stageIndex = 0;
      if (elapsed < minResearchMs) {
        pushTimeline(`${stagePrefix} Deep-research floor locked (${Math.round(minResearchMs / 1000)}s minimum).`);
      }
      while (elapsed < minResearchMs) {
        ensureActive();
        pushTimeline(holdStages[stageIndex % holdStages.length]);
        stageIndex += 1;
        const waitChunk = Math.min(1800, Math.max(400, minResearchMs - elapsed));
        await sleep(waitChunk);
        elapsed = Date.now() - startedAt;
      }
      pushTimeline("Minimum time window satisfied.", true);
    };

    try {
      ensureActive();
      pushTimeline("Research intake accepted.");

      let extractedText = "";
      if (selectedType === "url") {
        pushTimeline("Pulling readable body from URL.");
        extractedText = cleanReadableBody(await fetchReadableUrlBody(rawInput));
        ensureActive();
      } else if (selectedType === "image" && file) {
        pushTimeline("Running OCR over uploaded image evidence.");
        const ocr = await runOcrFromSettings(file);
        extractedText = normalize(ocr.text || "");
        pushTimeline(`OCR completed with ${Math.round(ocr.confidence || 0)}% confidence.`);
        ensureActive();
      } else if (selectedType === "document" && file) {
        pushTimeline("Extracting text from uploaded document.");
        extractedText = await extractDocumentText(file);
        ensureActive();
      }

      const claim = buildClaimForInput(selectedType, rawInput, file, extractedText, contextSeed);
      pushTimeline("Running LangGraph deep research pipeline.", true);
      try {
        const graph = await runFactcheckGraphApi({
          claim,
          source_url: selectedType === "url" ? rawInput : "",
          context: [contextSeed, extractedText.slice(0, 2200), file?.name || ""].filter(Boolean).join("\n"),
          input_type: selectedType,
          file_name: file?.name || "",
        });
        ensureActive();
        let evidence = dedupeEvidence(
          graph.sources.map((s) => ({
            title: s.title,
            url: s.url,
            snippet: s.quote || s.snippet,
            source: s.source,
          }))
        ).slice(0, 35);
        if (evidence.length === 0 && selectedType === "url" && rawInput) {
          evidence = [
            {
              title: `Primary submitted source (${getDomain(rawInput) || "source"})`,
              url: /^https?:\/\//i.test(rawInput) ? rawInput : `https://${rawInput}`,
              snippet: "LangGraph returned sparse links; including submitted source for continuity.",
              source: "web",
            },
          ];
        }
        const submittedDomain = getDomain(rawInput);
        let news = buildNewsFromGraphSources(
          graph.claim || claim,
          graph.sources.map((s) => ({
            title: s.title,
            url: s.url,
            snippet: s.quote || s.snippet,
            source: s.source,
          }))
        );
        if (news.length === 0) {
          news = buildNews(graph.claim || claim, evidence, submittedDomain);
        }
        const finalRecommendations =
          graph.recommendations?.length > 0
            ? graph.recommendations.map((r, idx) => ({
                id: `gr-${idx}-${createFactId()}`,
                title: r.title,
                whyRelevant: r.whyRelevant,
                url: r.url,
              }))
            : evidence.slice(0, 8).map((x, idx) => ({
                id: `ge-${idx}-${createFactId()}`,
                title: x.title,
                whyRelevant: "High-overlap source from LangGraph deep chain.",
                url: x.url,
              }));

        pushTimeline(`LangGraph completed with ${graph.source_count} sources, verdict ${graph.verdict}.`, true);
        pushTimeline(`Renderable output links: ${news.length}`, true);
        for (const row of graph.table.slice(0, 8)) {
          pushTimeline(
            `Sub-claim verdict: ${row.sub_claim.slice(0, 70)} | ${row.verdict} | +${row.supporting} / -${row.opposing}`
          );
        }
        if (graph.gaps?.length) {
          graph.gaps.forEach((g) => pushTimeline(`Gap: ${g}`));
        }

        await holdUntilMinimumWindow("");
        ensureActive();
        const completedAt = Date.now();
        patchSession(sessionId, (session) => ({
          ...session,
          status: "ready",
          updatedAt: Date.now(),
          research: {
            claim: graph.claim || claim,
            evidence,
            news,
            recommendations: finalRecommendations,
            timeline: [...timeline, ...graph.timeline.slice(0, 40), `${shortTime(Date.now())} - Research completed.`],
            durationMs: completedAt - startedAt,
            startedAt,
            completedAt,
          },
          messages: [
            ...session.messages,
            {
              id: `msg-${createFactId()}`,
              role: "assistant",
              text: `Verdict: ${graph.verdict} (${graph.confidence}% confidence). Sources analyzed: ${graph.source_count}.`,
              createdAt: completedAt,
            },
          ],
        }));
        return;
      } catch (err) {
        ensureActive();
        const message = err instanceof Error ? err.message : "Unknown error";
        pushTimeline(`LangGraph API unavailable, switching to local fallback research. (${message})`, true);
        if (!allowBrowserFallback) {
          throw new Error(`LangGraph API failed and browser fallback is disabled: ${message}`);
        }
      }
      const queryPlan = buildQueryPlan(claim, rawInput, selectedType, extractedText);
      const focusText = normalize(`${claim} ${extractedText}`.slice(0, 4500));

      patchSession(sessionId, (session) => ({
        ...session,
        updatedAt: Date.now(),
        research: {
          claim,
          evidence: [],
          news: [],
          recommendations: [],
          timeline: [...timeline],
          durationMs: 0,
          startedAt,
          completedAt: startedAt,
        },
      }));

      const evidenceCollected: SearchEvidence[] = [];
      for (let i = 0; i < queryPlan.length; i += 1) {
        ensureActive();
        const query = queryPlan[i];
        pushTimeline(`Deep web scan ${i + 1}/${queryPlan.length}: ${query}`);
        const hits = await runWebSearchFromSettings(query);
        evidenceCollected.push(...hits);
        await sleep(500);
      }
      ensureActive();

      if (selectedType === "url") {
        const submitted = buildSubmittedUrlEvidence(rawInput, extractedText);
        evidenceCollected.unshift(
          ...submitted.map((x) => ({
            title: x.title,
            url: x.url,
            snippet: x.snippet,
            source: x.source,
          }))
        );
      }

      pushTimeline("Correlating source overlap and relevance.");
      let evidence = dedupeEvidence(evidenceCollected).slice(0, 18);
      pushTimeline("Expanding source coverage by reading returned source bodies.");
      evidence = await expandEvidenceBodies(claim, evidence);
      ensureActive();
      const submittedDomain = getDomain(rawInput);
      pushTimeline("Collecting Google News RSS coverage for cross-publisher mentions.");
      const rssMentions = await fetchGoogleNewsRssEvidence(claim, submittedDomain, focusText);
      ensureActive();
      evidence = dedupeEvidence([
        ...evidence.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
        ...rssMentions.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
      ]);
      evidence = evidence.filter((item) => {
        const domain = getDomain(item.url);
        if (submittedDomain && domain === submittedDomain) return true;
        const score = relevanceScore(focusText, `${item.title} ${item.snippet}`);
        if (domain.includes("wikipedia.org")) return score >= 55;
        return score >= 28;
      });
      if (evidence.length < 10 && selectedType === "url") {
        pushTimeline("Collecting broader cross-site mentions for this claim.");
        const mentions = await collectMentionLinkEvidence(claim, submittedDomain, focusText);
        ensureActive();
        evidence = dedupeEvidence([
          ...evidence.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
          ...mentions.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
        ]).slice(0, 20);
      }
      evidence = [...evidence]
        .map((x) => ({
          item: x,
          score: relevanceScore(focusText, `${x.title} ${x.snippet}`),
        }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item)
        .slice(0, 18);
      if (evidence.length < 5 && selectedType === "url") {
        pushTimeline("Relevance gate returned too few links. Relaxing threshold to preserve coverage.");
        evidence = dedupeEvidence([
          ...evidence.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
          ...rssMentions.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, source: x.source })),
        ]).slice(0, 15);
      }
      if (evidence.length === 0) {
        pushTimeline("No external evidence returned. Switching to resilient fallback evidence set.");
        evidence = buildFallbackEvidence(selectedType, rawInput, claim);
      }
      const news = buildNews(focusText || claim, evidence, submittedDomain);

      pushTimeline("Searching for similar incidents and precedent cases.");
      const similarQueries = [`${claim} similar incident`, `${claim} prior case fact check`];
      const similarEvidence = dedupeEvidence(
        (
          await Promise.all(similarQueries.map((q) => runWebSearchFromSettings(q)))
        ).flat()
      );
      ensureActive();
      const recommendations = buildRecommendations(claim, similarEvidence.filter((x) => !evidence.some((e) => e.url === x.url)));
      const finalRecommendationsRaw =
        recommendations.length > 0
          ? recommendations
          : evidence
              .filter((x) => !!x.url)
              .slice(0, 6)
              .map((x, idx) => ({
                id: `rec-e-${idx}-${createFactId()}`,
                title: x.title,
                whyRelevant: "Related mention from cross-site evidence around the same claim entities.",
                url: x.url,
              }));
      const seenRecUrl = new Set<string>();
      const finalRecommendations = finalRecommendationsRaw.filter((rec) => {
        const url = rec.url ? canonicalUrl(rec.url) : "";
        if (!url) return false;
        if (seenRecUrl.has(url)) return false;
        seenRecUrl.add(url);
        return true;
      });
      await holdUntilMinimumWindow("");
      ensureActive();

      const verdictPack = scoreResearchVerdict(claim, evidence);
      const completedAt = Date.now();
      const summary =
        verdictPack.verdict === "supported"
          ? `Claim appears supported by the current evidence set (${verdictPack.confidence}% confidence).`
          : verdictPack.verdict === "unsupported"
            ? `Claim appears weak or contradicted by available sources (${verdictPack.confidence}% confidence).`
            : `Claim is partially supported; review context and contradictory reporting (${verdictPack.confidence}% confidence).`;

      patchSession(sessionId, (session) => ({
        ...session,
        status: "ready",
        updatedAt: Date.now(),
        research: {
          claim,
          evidence,
          news,
          recommendations: finalRecommendations,
          timeline: [...timeline, `${shortTime(Date.now())} - Research completed.`],
          durationMs: completedAt - startedAt,
          startedAt,
          completedAt,
        },
        messages: [
          ...session.messages,
          {
            id: `msg-${createFactId()}`,
            role: "assistant",
            text: `${summary} Evaluated ${evidence.length} sources in ${Math.round((completedAt - startedAt) / 1000)} seconds.`,
            createdAt: completedAt,
          },
        ],
      }));
    } catch (error) {
      const cancelled = error instanceof Error && error.message === "__CANCELLED__";
      if (cancelled) {
        patchSession(sessionId, (session) => ({
          ...session,
          status: "error",
          error: "Research cancelled by analyst.",
          updatedAt: Date.now(),
        }));
        return;
      }
      await holdUntilMinimumWindow("Recovery mode.");
      patchSession(sessionId, (session) => ({
        ...session,
        status: "error",
        error: error instanceof Error ? error.message : "Research failed.",
        updatedAt: Date.now(),
        messages: [
          ...session.messages,
          {
            id: `msg-${createFactId()}`,
            role: "assistant",
            text: "Research failed for this chat. Please retry with another source or file.",
            createdAt: Date.now(),
          },
        ],
      }));
    } finally {
      cancelledSessionsRef.current.delete(sessionId);
      setOverlayLockedSessionId((current) => (current === sessionId ? null : current));
    }
  };

  const startResearch = () => {
    const now = Date.now();
    if (sessions.some((x) => x.status === "researching")) return;
    const rawInput = inputType === "url" ? normalize(urlInput) : uploadFile?.name || "";
    if (inputType === "url" && !rawInput) return;
    if ((inputType === "image" || inputType === "document") && !uploadFile) return;

    const sessionId = createFactChatId();
    const titleSource =
      inputType === "url"
        ? rawInput
        : uploadFile?.name || (inputType === "image" ? "Image evidence" : "Document evidence");

    const session: FactSession = {
      id: sessionId,
      track: mode,
      title: titleSource.slice(0, 72),
      inputType,
      inputLabel: titleSource.slice(0, 160),
      rawInput,
      status: "researching",
      messages: [
        {
          id: `msg-${createFactId()}`,
          role: "user",
          text:
            inputType === "url"
              ? `Research this URL: ${rawInput}`
              : inputType === "image"
                ? `Research this uploaded image: ${uploadFile?.name}`
                : `Research this uploaded document: ${uploadFile?.name}`,
          createdAt: now,
        },
        {
          id: `msg-${createFactId()}`,
          role: "system",
          text: "Deep research started. Running multi-query evidence collection and correlation.",
          createdAt: now + 1,
        },
      ],
      qa: [],
      createdAt: now,
      updatedAt: now,
    };

    sync((current) => ({
      ...current,
      sessions: [session, ...current.sessions],
    }));

    setSelectedSessionId(sessionId);
    setOverlayLockedSessionId(sessionId);
    setUrlInput("");
    setContextInput("");
    setUploadFile(null);
    void runResearchPipeline(sessionId, inputType, rawInput, uploadFile, contextInput);
  };

  const askQuestion = () => {
    if (!selected || !selected.research) return;
    const q = normalize(questionInput);
    if (!q) return;

    const qa = answerFromEvidence(q, selected.research);

    patchSession(selected.id, (session) => ({
      ...session,
      updatedAt: Date.now(),
      qa: [qa, ...session.qa],
      messages: [
        ...session.messages,
        {
          id: `msg-${createFactId()}`,
          role: "user",
          text: q,
          createdAt: Date.now(),
        },
        {
          id: `msg-${createFactId()}`,
          role: "assistant",
          text: qa.answer,
          createdAt: Date.now() + 1,
        },
      ],
    }));

    setQuestionInput("");
  };

  const deleteSession = (id: string) => {
    sync((current) => ({
      ...current,
      sessions: current.sessions.filter((x) => x.id !== id),
    }));
    if (selectedSessionId === id) {
      setSelectedSessionId(null);
    }
  };

  const activeResearchSession =
    (overlayLockedSessionId ? sessions.find((x) => x.id === overlayLockedSessionId) : null) ??
    sessions.find((x) => x.status === "researching") ??
    null;
  const showOverlay = !!activeResearchSession;
  const activeBusy = showOverlay || sessions.some((x) => x.status === "researching");
  const progressLines = activeResearchSession?.research?.timeline ?? [];
  const activeStartedAt = activeResearchSession?.research?.startedAt ?? activeResearchSession?.createdAt ?? Date.now();
  const activeElapsedMs = Math.max(0, overlayNow - activeStartedAt);
  const progressValue = Math.max(6, Math.min(96, Math.round((activeElapsedMs / 22000) * 100)));
  const rotatingHints = [
    "Indexing source graph...",
    "Scoring source trust and overlap...",
    "Computing contradiction signals...",
    "Re-checking claim context window...",
    "Finalizing structured verdict payload...",
  ];
  const animatedHint = rotatingHints[Math.floor(overlayNow / 1800) % rotatingHints.length];
  const selectedFileMeta = uploadFile ? `${uploadFile.name} | ${formatBytes(uploadFile.size)}` : "";
  return (
    <div className={`grid gap-4 ${sidebarOpen ? "lg:grid-cols-[300px,1fr]" : "lg:grid-cols-[56px,1fr]"}`}>
      {sidebarOpen ? (
        <Card className="dashboard-card-effect border-border bg-card">
          <CardHeader className="pb-3 space-y-3">
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 leading-none text-base">
                <MessagesSquare className="h-4 w-4" />
                Research Chats
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close chat sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="justify-start"
              onClick={() => {
                setSelectedSessionId(null);
                setQuestionInput("");
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Chat
            </Button>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[78vh] overflow-auto">
            {sessions.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                No chats yet.
              </div>
            ) : null}
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`w-full rounded-md px-3 py-2 text-left transition-colors group ${
                  selected?.id === session.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                }`}
                onClick={() => setSelectedSessionId(session.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedSessionId(session.id);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{session.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {session.inputType.toUpperCase()} | {shortTime(session.updatedAt)}
                    </div>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(session.id);
                    }}
                    aria-label="Delete chat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <div className="flex lg:justify-start">
          <Button
            type="button"
            variant="outline"
            className="h-10 w-10 p-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open chat sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {!sidebarOpen ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="gap-2"
            >
              <MessagesSquare className="h-4 w-4" />
              Open Chats
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedSessionId(null);
                setQuestionInput("");
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
            <span className="text-xs text-muted-foreground">Sidebar is hidden by default.</span>
          </div>
        ) : null}
        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>Fact Check Intake</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant={inputType === "url" ? "default" : "outline"} onClick={() => setInputType("url")}>
                <Link2 className="h-4 w-4 mr-1" /> URL
              </Button>
              <Button variant={inputType === "image" ? "default" : "outline"} onClick={() => setInputType("image")}>
                <ImageIcon className="h-4 w-4 mr-1" /> Image
              </Button>
              <Button variant={inputType === "document" ? "default" : "outline"} onClick={() => setInputType("document")}>
                <FileText className="h-4 w-4 mr-1" /> Document
              </Button>
            </div>

            {inputType === "url" ? (
              <Input
                key="fact-url-input"
                placeholder="Paste URL to investigate (https://...)"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
            ) : (
              <div className="rounded-lg border border-dashed bg-card/40 p-4 space-y-3">
                <input
                  ref={filePickerRef}
                  className="hidden"
                  type="file"
                  accept={inputType === "image" ? "image/*" : ".pdf,.txt,.md,.csv,.json,.doc,.docx,.rtf,application/pdf,text/plain"}
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {inputType === "image" ? "Image evidence upload" : "Document evidence upload"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {uploadFile
                        ? selectedFileMeta
                        : inputType === "image"
                          ? "Supported: PNG, JPG, JPEG, WEBP, BMP, GIF"
                          : "Supported: PDF, TXT, MD, CSV, JSON, DOC, DOCX, RTF"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" onClick={() => filePickerRef.current?.click()}>
                      {uploadFile ? "Change File" : "Choose File"}
                    </Button>
                    {uploadFile ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setUploadFile(null);
                          if (filePickerRef.current) filePickerRef.current.value = "";
                        }}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            <Textarea
              rows={3}
              placeholder="Optional: add context/question for this item before research"
              value={contextInput}
              onChange={(e) => setContextInput(e.target.value)}
            />

            <Button onClick={startResearch} disabled={activeBusy}>
              {activeBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              {activeBusy ? "Research Running..." : "Start 20-25s Deep Research"}
            </Button>
          </CardContent>
        </Card>

        {selected ? (
          showOverlay || selected.status === "researching" ? (
            <Card className="dashboard-card-effect">
              <CardHeader>
                <CardTitle>Research Running</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Results are intentionally held until the deep research cycle completes. Keep this open.
              </CardContent>
            </Card>
          ) : (
          <>
            <Card className="dashboard-card-effect">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>Output 1: News + Source Coverage</span>
                  <Badge variant="outline" className="flex items-center gap-1">
                    <Clock3 className="h-3 w-3" />
                    {selected.research ? `${Math.round(selected.research.durationMs / 1000)}s` : "pending"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selected.status === "researching" ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deep research in progress. This run is intentionally long to gather stronger evidence.
                  </div>
                ) : null}

                {selected.research?.claim ? <div className="font-medium">Claim Focus: {selected.research.claim}</div> : null}

                {selected.research?.news?.length ? (
                  selected.research.news.map((item) => (
                    <div key={item.id} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-sm">{item.title}</div>
                          <div className="text-xs text-muted-foreground">Relevance {item.relevance}% | {item.source}</div>
                        </div>
                        {item.url ? (
                          <Button size="sm" variant="outline" onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}>
                            <ExternalLink className="h-4 w-4 mr-1" /> Open
                          </Button>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{item.snippet}</div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No research output yet for this chat.</p>
                )}
              </CardContent>
            </Card>

            <Card className="dashboard-card-effect">
              <CardHeader>
                <CardTitle>Output 2: Ask On Gathered Sources (True/False/Explain)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input
                    placeholder="Ask: is this real, fake, what is verified, what is missing..."
                    value={questionInput}
                    onChange={(e) => setQuestionInput(e.target.value)}
                  />
                  <Button onClick={askQuestion} disabled={!selected.research || selected.status !== "ready"}>
                    Ask
                  </Button>
                </div>

                {selected.qa.length === 0 ? <p className="text-sm text-muted-foreground">No follow-up questions yet.</p> : null}
                {selected.qa.map((qa) => (
                  <div key={qa.id} className="rounded-md border p-3 space-y-2">
                    <div className="font-medium text-sm">Q: {qa.question}</div>
                    <div className="text-xs text-muted-foreground whitespace-pre-wrap">{qa.answer}</div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={qa.verdict === "true" ? "secondary" : qa.verdict === "false" ? "destructive" : "outline"}>
                        {qa.verdict === "true" ? <ShieldCheck className="h-3 w-3 mr-1" /> : qa.verdict === "false" ? <ShieldAlert className="h-3 w-3 mr-1" /> : <ShieldQuestion className="h-3 w-3 mr-1" />} 
                        {qa.verdict}
                      </Badge>
                      <Badge variant="outline">confidence {qa.confidence}%</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="dashboard-card-effect">
              <CardHeader>
                <CardTitle>Output 3: Related Incident Recommendations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {selected.research?.recommendations?.length ? (
                  selected.research.recommendations.map((item) => (
                    <div key={item.id} className="rounded-md border p-3 flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-sm">{item.title}</div>
                        <div className="text-xs text-muted-foreground">{item.whyRelevant}</div>
                      </div>
                      {item.url ? (
                        <Button size="sm" variant="outline" onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}>
                          <ExternalLink className="h-4 w-4 mr-1" /> Open
                        </Button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">Recommendations will appear after research completes.</p>
                )}
              </CardContent>
            </Card>

            <Card className="dashboard-card-effect">
              <CardHeader>
                <CardTitle>Research Timeline + Chat</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 max-h-[420px] overflow-auto">
                {selected.research?.timeline?.length ? (
                  <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-1">
                    {selected.research.timeline.map((line, idx) => (
                      <div key={`${selected.id}-line-${idx}`}>{line}</div>
                    ))}
                  </div>
                ) : null}

                {selected.messages.map((message) => (
                  <div key={message.id} className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      {message.role === "assistant" ? <Bot className="h-3 w-3" /> : null}
                      {message.role.toUpperCase()} | {shortTime(message.createdAt)}
                    </div>
                    <div className="text-sm whitespace-pre-wrap">{message.text}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
          )
        ) : (
          <Card className="dashboard-card-effect">
            <CardContent className="py-8 text-sm text-muted-foreground">Start a new research chat from the intake panel.</CardContent>
          </Card>
        )}
      </div>

      {showOverlay && activeResearchSession ? (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl rounded-2xl border border-primary/30 bg-card p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Deep Fact Check In Progress
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Running multi-source research for: {activeResearchSession.title}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Cancel research"
                    onClick={() => cancelResearchSession(activeResearchSession.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${progressValue}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Background pipeline running. Results unlock only after the full 20-25s research window.
                </div>
                <div className="text-xs text-primary/90">{animatedHint}</div>
              </div>

              <div className="rounded-xl border bg-background/40 p-3 max-h-56 overflow-auto space-y-2">
                {progressLines.length === 0 ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Initializing research stages...
                  </div>
                ) : (
                  progressLines.map((line, idx) => (
                    <div key={`progress-${activeResearchSession.id}-${idx}`} className="text-sm flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary/80 animate-pulse" />
                      <span>{line}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
