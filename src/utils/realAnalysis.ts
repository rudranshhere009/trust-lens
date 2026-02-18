import type { DocumentRecord, FactCheckRecord } from "@/utils/appData";
import { runOcrFromSettings } from "@/utils/externalServices";

interface WebEvidence {
  title: string;
  url: string;
  snippet: string;
  source: "wikipedia" | "duckduckgo" | "web";
}

const SENSATIONAL_PATTERNS = [
  /\b(100%|guaranteed|secret|miracle|shocking|cure)\b/i,
  /\b(always|never|everyone|nobody)\b/i,
  /\b(breaking|exposed|truth they hide)\b/i,
];

const LEGAL_RISK_RULES: Array<{
  title: string;
  pattern: RegExp;
  severity: "high" | "medium" | "low";
  description: string;
  simplified: string;
}> = [
  {
    title: "Unlimited Liability",
    pattern: /\b(unlimited liability|indemnify.*all losses|liable for any and all)\b/i,
    severity: "high",
    description: "The text may transfer broad liability to one party.",
    simplified: "One side can be forced to pay for nearly every loss, even indirect ones.",
  },
  {
    title: "Unilateral Termination",
    pattern: /\b(terminate at any time|without notice|sole discretion)\b/i,
    severity: "medium",
    description: "One-sided termination language detected.",
    simplified: "The other party can end the agreement whenever they want.",
  },
  {
    title: "Auto Renewal",
    pattern: /\b(automatically renew|auto.?renew|renews unless canceled)\b/i,
    severity: "medium",
    description: "Automatic renewal terms appear in the text.",
    simplified: "The contract keeps renewing unless you cancel in time.",
  },
  {
    title: "Arbitration / Dispute Restriction",
    pattern: /\b(binding arbitration|waive.*class action|exclusive jurisdiction)\b/i,
    severity: "medium",
    description: "Dispute resolution terms may limit legal options.",
    simplified: "You may lose the right to sue in normal court.",
  },
  {
    title: "Data Sharing",
    pattern: /\b(share.*third parties|sell.*data|process personal data)\b/i,
    severity: "low",
    description: "Data sharing language is present.",
    simplified: "Your data may be shared with other companies.",
  },
];

const FINANCIAL_PATTERNS = [
  /\b(payment|invoice|fee|charges?|penalt(y|ies)|interest)\b/i,
  /\b(refund|non-refundable|late fee|escalation)\b/i,
];

const DATE_PATTERNS = [
  /\b(effective date|commencement|termination date|renewal date)\b/i,
  /\b(within \d+ days|notice period|calendar days|business days)\b/i,
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const timeoutSignal = (ms: number) => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
};

const safeFetchJson = async <T>(url: string, timeoutMs = 7000): Promise<T | null> => {
  try {
    const res = await fetch(url, { signal: timeoutSignal(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

const safeFetchText = async (url: string, timeoutMs = 10000): Promise<string> => {
  try {
    const res = await fetch(url, { signal: timeoutSignal(timeoutMs) });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
};

const extractReadableText = (input: string) =>
  input
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();

const truncate = (value: string, max = 240) => (value.length <= max ? value : `${value.slice(0, max)}...`);

const readBlobAsText = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

const roughPdfTextFromBytes = async (file: File) => {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let raw = "";
    for (let i = 0; i < bytes.length; i += 1) {
      raw += String.fromCharCode(bytes[i]);
    }

    const parenMatches = Array.from(raw.matchAll(/\(([^()]{2,220})\)\s*Tj/g)).map((m) => m[1]);
    const tjArrayMatches = Array.from(raw.matchAll(/\[(.*?)\]\s*TJ/gs)).map((m) => m[1]);
    const flattenedTJ = tjArrayMatches
      .flatMap((segment) => Array.from(segment.matchAll(/\(([^()]{2,220})\)/g)).map((m) => m[1]));

    const text = extractReadableText([...parenMatches, ...flattenedTJ].join(" ")).slice(0, 50000);
    return text;
  } catch {
    return "";
  }
};

const getFileKind = (file: File): DocumentRecord["fileKind"] => {
  if (file.type === "text/plain") return "txt";
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  return "other";
};

const isZipLikeFile = (file: File) =>
  /(^application\/zip$|^application\/x-zip-compressed$|^multipart\/x-zip$)/i.test(file.type) || /\.zip$/i.test(file.name);

const HIGH_RISK_ARCHIVE_EXT = new Set([
  "exe",
  "dll",
  "msi",
  "bat",
  "cmd",
  "ps1",
  "vbs",
  "js",
  "jse",
  "jar",
  "scr",
  "com",
  "chm",
  "hta",
  "wsf",
  "vbe",
  "lnk",
  "reg",
  "apk",
]);

const MACRO_EXT = new Set(["docm", "xlsm", "pptm", "xlam", "ppam", "dotm"]);
const NESTED_ARCHIVE_EXT = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "cab", "iso", "img"]);

const readU16 = (bytes: Uint8Array, off: number) => bytes[off] | (bytes[off + 1] << 8);
const readU32 = (bytes: Uint8Array, off: number) =>
  (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;

const decodeZipName = (bytes: Uint8Array, utf8: boolean) => {
  if (bytes.length === 0) return "";
  if (utf8) {
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      // fallback below
    }
  }
  return Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
};

type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  encrypted: boolean;
};

const parseZipEntries = (bytes: Uint8Array): { validZip: boolean; entries: ZipEntry[] } => {
  const entries: ZipEntry[] = [];
  const len = bytes.length;
  if (len < 4) return { validZip: false, entries };

  const startsWithZipSig =
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x07 && bytes[3] === 0x08);

  let eocd = -1;
  const min = Math.max(0, len - 0x10000 - 22);
  for (let i = len - 22; i >= min; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }

  if (eocd >= 0 && eocd + 22 <= len) {
    const total = readU16(bytes, eocd + 10);
    const cdOffset = readU32(bytes, eocd + 16);
    let p = cdOffset;
    let seen = 0;
    while (p + 46 <= len && seen < total) {
      if (!(bytes[p] === 0x50 && bytes[p + 1] === 0x4b && bytes[p + 2] === 0x01 && bytes[p + 3] === 0x02)) break;
      const flags = readU16(bytes, p + 8);
      const compSize = readU32(bytes, p + 20);
      const uncompSize = readU32(bytes, p + 24);
      const nameLen = readU16(bytes, p + 28);
      const extraLen = readU16(bytes, p + 30);
      const commentLen = readU16(bytes, p + 32);
      const nameStart = p + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > len) break;
      const name = decodeZipName(bytes.slice(nameStart, nameEnd), (flags & 0x800) !== 0);
      entries.push({
        name,
        compressedSize: compSize,
        uncompressedSize: uncompSize,
        encrypted: (flags & 0x1) !== 0,
      });
      p = nameEnd + extraLen + commentLen;
      seen += 1;
    }
    if (entries.length > 0) return { validZip: true, entries };
  }

  // Fallback: scan local file headers when central directory is unavailable.
  for (let p = 0; p + 30 <= len; p += 1) {
    if (!(bytes[p] === 0x50 && bytes[p + 1] === 0x4b && bytes[p + 2] === 0x03 && bytes[p + 3] === 0x04)) continue;
    const flags = readU16(bytes, p + 6);
    const compSize = readU32(bytes, p + 18);
    const uncompSize = readU32(bytes, p + 22);
    const nameLen = readU16(bytes, p + 26);
    const extraLen = readU16(bytes, p + 28);
    const nameStart = p + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > len) break;
    const name = decodeZipName(bytes.slice(nameStart, nameEnd), (flags & 0x800) !== 0);
    entries.push({
      name,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      encrypted: (flags & 0x1) !== 0,
    });
    p = nameEnd + extraLen + compSize - 1;
  }

  return { validZip: startsWithZipSig, entries };
};

const analyzeZipArchive = async (
  file: File
): Promise<
  Pick<
    DocumentRecord,
    | "trustScore"
    | "risks"
    | "summary"
    | "keyFindings"
    | "clauses"
    | "extractedText"
    | "editableText"
    | "fileKind"
    | "extractionMethod"
    | "scannedNonEditable"
    | "pagesAnalyzed"
    | "extractionConfidence"
  >
> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseZipEntries(bytes);
  const entries = parsed.entries;

  if (!parsed.validZip) {
    return {
      trustScore: 12,
      risks: 7,
      summary: "Archive failed ZIP signature validation. Treat as high-risk and do not extract.",
      keyFindings: [
        {
          type: "risk",
          title: "Invalid ZIP Signature",
          description: "The file does not match expected ZIP structure.",
          severity: "high",
        },
      ],
      clauses: [
        {
          original: file.name,
          simplified: "This archive may be tampered or mislabeled. Block extraction.",
          risk: "high",
        },
      ],
      extractedText: "ZIP security scan failed: invalid archive signature.",
      editableText: "ZIP security scan failed: invalid archive signature.",
      fileKind: "other",
      extractionMethod: "zip-static-scan",
      scannedNonEditable: true,
      pagesAnalyzed: 0,
      extractionConfidence: 100,
    };
  }

  const normalized = entries
    .map((e) => e.name.replace(/\\/g, "/").trim())
    .filter(Boolean);
  const fileEntries = normalized.filter((n) => !n.endsWith("/"));
  const encrypted = entries.filter((e) => e.encrypted).length;
  const traversal = normalized.filter((n) => /(^\/|^[a-z]:\/|(^|\/)\.\.(\/|$))/i.test(n)).length;
  const doubleExt = normalized.filter((n) => /\.(pdf|doc|docx|txt|png|jpg|jpeg|xls|xlsx)\.(exe|scr|bat|cmd|js|vbs|ps1|com)$/i.test(n)).length;

  let highRiskFiles = 0;
  let macroFiles = 0;
  let nestedArchives = 0;
  let scriptFiles = 0;
  const suspiciousNames: string[] = [];
  for (const name of fileEntries) {
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    if (HIGH_RISK_ARCHIVE_EXT.has(ext)) {
      highRiskFiles += 1;
      if (suspiciousNames.length < 6) suspiciousNames.push(name);
    }
    if (MACRO_EXT.has(ext)) {
      macroFiles += 1;
      if (suspiciousNames.length < 6) suspiciousNames.push(name);
    }
    if (NESTED_ARCHIVE_EXT.has(ext)) nestedArchives += 1;
    if (["js", "vbs", "ps1", "bat", "cmd", "wsf"].includes(ext)) scriptFiles += 1;
  }

  const totalCompressed = entries.reduce((sum, e) => sum + e.compressedSize, 0);
  const totalUncompressed = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  const maxRatio = entries.reduce((max, e) => {
    if (e.compressedSize <= 0 || e.uncompressedSize <= 0) return max;
    return Math.max(max, e.uncompressedSize / Math.max(1, e.compressedSize));
  }, 0);
  const possibleZipBomb =
    entries.length > 4000 || totalUncompressed > 1024 * 1024 * 1024 || maxRatio > 140 || (totalCompressed < 2_000_000 && totalUncompressed > 250_000_000);

  const findings: DocumentRecord["keyFindings"] = [
    {
      type: "neutral",
      title: "ZIP Pre-Extraction Security Scan",
      description: `Scanned ${entries.length} archive entr${entries.length === 1 ? "y" : "ies"} using strict static checks before extraction.`,
      severity: "low",
    },
  ];

  let trustScore = 92;
  const riskNotes: string[] = [];

  if (encrypted > 0) {
    trustScore -= 26;
    riskNotes.push(`${encrypted} encrypted entr${encrypted === 1 ? "y is" : "ies are"} not inspectable`);
    findings.push({
      type: "risk",
      title: "Encrypted Archive Content",
      description: "Encrypted files prevent full content inspection and can hide malware.",
      severity: "high",
    });
  }
  if (traversal > 0) {
    trustScore -= 30;
    riskNotes.push(`${traversal} path traversal pattern(s)`);
    findings.push({
      type: "risk",
      title: "Path Traversal Indicators",
      description: "Potential zip-slip paths detected (`../` or absolute path style).",
      severity: "high",
    });
  }
  if (highRiskFiles > 0) {
    trustScore -= Math.min(34, 12 + highRiskFiles * 4);
    riskNotes.push(`${highRiskFiles} executable/script payload(s)`);
    findings.push({
      type: "risk",
      title: "Executable Payloads in Archive",
      description: "Archive contains directly executable or scriptable file types.",
      severity: "high",
    });
  }
  if (doubleExt > 0) {
    trustScore -= 16;
    riskNotes.push(`${doubleExt} deceptive double-extension filename(s)`);
    findings.push({
      type: "risk",
      title: "Deceptive File Naming",
      description: "Double extensions can disguise executable content as documents or media.",
      severity: "medium",
    });
  }
  if (macroFiles > 0) {
    trustScore -= Math.min(18, 6 + macroFiles * 3);
    riskNotes.push(`${macroFiles} macro-enabled office file(s)`);
    findings.push({
      type: "risk",
      title: "Macro-Enabled Office Content",
      description: "Macro-capable documents may execute malicious automation when opened.",
      severity: "medium",
    });
  }
  if (nestedArchives > 0) {
    trustScore -= Math.min(14, 4 + nestedArchives * 2);
    riskNotes.push(`${nestedArchives} nested archive(s)`);
    findings.push({
      type: "risk",
      title: "Nested Archive Layers",
      description: "Nested archives are often used to evade first-pass scanning.",
      severity: "medium",
    });
  }
  if (scriptFiles > 0) {
    trustScore -= Math.min(12, 4 + scriptFiles * 2);
    findings.push({
      type: "risk",
      title: "Script Presence",
      description: "Shell/script files detected. Review before execution.",
      severity: "medium",
    });
  }
  if (possibleZipBomb) {
    trustScore -= 28;
    riskNotes.push("zip-bomb-like compression profile");
    findings.push({
      type: "risk",
      title: "Archive Bomb Indicators",
      description: "Uncompressed size and/or compression ratio suggests potential decompression bomb risk.",
      severity: "high",
    });
  }

  trustScore = clamp(trustScore, 10, 96);
  const totalRisks = findings.filter((f) => f.type === "risk").length;
  const summary =
    totalRisks === 0
      ? "ZIP archive passed strict pre-extraction static checks with no high-risk indicators."
      : `ZIP archive flagged ${totalRisks} high-standard cyber risk signal(s): ${riskNotes.join(", ")}.`;

  const lines = [
    `ZIP Static Security Scan`,
    `Entries: ${entries.length}`,
    `Compressed Size: ${Math.round(totalCompressed / 1024)} KB`,
    `Uncompressed Size: ${Math.round(totalUncompressed / 1024)} KB`,
    `Max Compression Ratio: ${maxRatio ? maxRatio.toFixed(2) : "n/a"}`,
    `Encrypted Entries: ${encrypted}`,
    `Executable/Script Files: ${highRiskFiles}`,
    `Macro Files: ${macroFiles}`,
    `Nested Archives: ${nestedArchives}`,
    `Path Traversal Patterns: ${traversal}`,
    `Double Extensions: ${doubleExt}`,
    suspiciousNames.length ? `Suspicious Names: ${suspiciousNames.join(" | ")}` : "Suspicious Names: none",
  ];

  const clauses: DocumentRecord["clauses"] = suspiciousNames.length
    ? suspiciousNames.slice(0, 6).map((name) => ({
        original: name,
        simplified: "Review this archive member before extraction/opening.",
        risk: "high",
      }))
    : [
        {
          original: `${entries.length} archive entr${entries.length === 1 ? "y" : "ies"} scanned`,
          simplified: "No suspicious executable naming pattern was detected in listed entries.",
          risk: totalRisks > 0 ? "medium" : "low",
        },
      ];

  return {
    trustScore,
    risks: totalRisks,
    summary,
    keyFindings: findings.slice(0, 8),
    clauses,
    extractedText: lines.join("\n"),
    editableText: lines.join("\n"),
    fileKind: "other",
    extractionMethod: "zip-static-scan",
    scannedNonEditable: true,
    pagesAnalyzed: entries.length,
    extractionConfidence: 100,
  };
};

const buildClaimCandidates = (text: string) => {
  const sentences = text
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 35)
    .slice(0, 3);

  if (sentences.length > 0) return sentences;
  return [text.slice(0, 200)].filter(Boolean);
};

const hostnameLabel = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const fetchWikipediaEvidence = async (query: string): Promise<WebEvidence[]> => {
  const encoded = encodeURIComponent(query);
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&utf8=&format=json&origin=*`;
  const search = await safeFetchJson<{
    query?: { search?: Array<{ pageid: number; title: string; snippet: string }> };
  }>(searchUrl);

  const pages = search?.query?.search?.slice(0, 2) ?? [];
  if (pages.length === 0) return [];

  const evidence: WebEvidence[] = [];
  await Promise.all(
    pages.map(async (page) => {
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.title)}`;
      const summary = await safeFetchJson<{ extract?: string; content_urls?: { desktop?: { page?: string } } }>(summaryUrl);
      evidence.push({
        title: page.title,
        url: summary?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        snippet: truncate(
          extractReadableText(summary?.extract || page.snippet.replace(/<[^>]+>/g, " ") || "Wikipedia result"),
          220
        ),
        source: "wikipedia",
      });
    })
  );

  return evidence;
};

const fetchDuckDuckGoEvidence = async (query: string): Promise<WebEvidence[]> => {
  const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const data = await safeFetchJson<{
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
    Heading?: string;
  }>(apiUrl);

  if (!data) return [];

  const evidence: WebEvidence[] = [];
  if (data.AbstractText && data.AbstractURL) {
    evidence.push({
      title: data.Heading || hostnameLabel(data.AbstractURL),
      url: data.AbstractURL,
      snippet: truncate(data.AbstractText, 220),
      source: "duckduckgo",
    });
  }

  const related = (data.RelatedTopics ?? [])
    .flatMap((item) => ("Topics" in item ? item.Topics ?? [] : [item]))
    .filter((item) => item.FirstURL && item.Text)
    .slice(0, 2);

  for (const item of related) {
    evidence.push({
      title: hostnameLabel(item.FirstURL!),
      url: item.FirstURL!,
      snippet: truncate(item.Text!, 180),
      source: "duckduckgo",
    });
  }

  return evidence;
};

const fetchUrlBody = async (rawUrl: string): Promise<string> => {
  const normalized = rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : `https://${rawUrl}`;
  const viaReader = `https://r.jina.ai/http://${normalized.replace(/^https?:\/\//, "")}`;
  const text = await safeFetchText(viaReader, 12000);
  if (!text) return "";
  return extractReadableText(text).slice(0, 5000);
};

export const analyzeMisinformation = async (
  sourceType: "url" | "text",
  sourceValue: string
): Promise<Pick<FactCheckRecord, "trustScore" | "status" | "summary" | "flaggedClaims" | "credibilityFactors">> => {
  const baseText =
    sourceType === "url" ? await fetchUrlBody(sourceValue) : extractReadableText(sourceValue).slice(0, 2500);

  const evaluationText = baseText || sourceValue;
  const claims = buildClaimCandidates(evaluationText);

  const evidenceByClaim = await Promise.all(
    claims.map(async (claim) => {
      const [wiki, ddg] = await Promise.all([fetchWikipediaEvidence(claim), fetchDuckDuckGoEvidence(claim)]);
      return [...wiki, ...ddg].slice(0, 4);
    })
  );

  let trustScore = 58;
  const sensationalHits = SENSATIONAL_PATTERNS.reduce((sum, pattern) => sum + (pattern.test(evaluationText) ? 1 : 0), 0);
  trustScore -= sensationalHits * 12;

  const totalEvidence = evidenceByClaim.flat().length;
  trustScore += clamp(totalEvidence * 5, 0, 22);
  if (sourceType === "url" && /https?:\/\//i.test(sourceValue)) trustScore += 5;
  trustScore = clamp(trustScore, 10, 96);

  const status: FactCheckRecord["status"] =
    trustScore >= 72 ? "verified" : trustScore >= 45 ? "mixed" : "misleading";

  const flaggedClaims: FactCheckRecord["flaggedClaims"] = claims.map((claim, index) => {
    const evidence = evidenceByClaim[index];
    const claimRisk = SENSATIONAL_PATTERNS.some((p) => p.test(claim)) ? 1 : 0;
    const verdictScore = clamp(60 + evidence.length * 10 - claimRisk * 25, 10, 95);
    const verdict: "True" | "False" | "Misleading" =
      verdictScore >= 72 ? "True" : verdictScore >= 45 ? "Misleading" : "False";

    return {
      claim: truncate(claim, 180),
      status: verdict,
      sources: evidence.length ? evidence.map((item) => `${item.title} | ${item.url}`) : ["No strong external evidence found"],
      explanation:
        verdict === "True"
          ? "Matched with multiple external references."
          : verdict === "Misleading"
            ? "Partially supported. Context or certainty appears overstated."
            : "Insufficient supporting evidence or contradictory cues detected.",
    };
  });

  const credibilityFactors: FactCheckRecord["credibilityFactors"] = [
    {
      factor: "Evidence Coverage",
      score: clamp(35 + totalEvidence * 12, 20, 95),
      reason: totalEvidence > 0 ? `Found ${totalEvidence} external evidence link(s).` : "No strong external references found.",
    },
    {
      factor: "Language Risk",
      score: clamp(85 - sensationalHits * 22, 10, 90),
      reason: sensationalHits > 0 ? "Sensational or absolute wording detected." : "Language appears measured.",
    },
    {
      factor: "Source Quality",
      score: sourceType === "url" ? 72 : 58,
      reason: sourceType === "url" ? "Direct source URL provided." : "Plain text input without original source URL.",
    },
  ];

  const summary =
    status === "verified"
      ? "Most claims appear supported by external references."
      : status === "mixed"
        ? "Some claims are supported, while others need manual verification."
        : "High misinformation risk detected due to weak evidence and/or risky language.";

  return {
    trustScore,
    status,
    summary,
    flaggedClaims,
    credibilityFactors,
  };
};

const ocrImage = async (blob: Blob): Promise<{ text: string; confidence: number } | null> => {
  try {
    const result = await runOcrFromSettings(blob);
    if (!result.text) return null;
    return {
      text: extractReadableText(result.text).slice(0, 50000),
      confidence: result.confidence,
    };
  } catch {
    return null;
  }
};

const extractPdfTextLayer = async (file: File) => {
  let pdfjs: any;
  try {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist");
  }
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  } catch {
    // Keep running even if worker URL resolution fails in non-standard runtimes.
  }

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = extractReadableText(
      content.items
        .map((item: { str?: string }) => item.str || "")
        .join(" ")
        .trim()
    );
    if (text) pageTexts.push(text);
  }

  return {
    pdf,
    pageTexts,
    text: extractReadableText(pageTexts.join("\n")).slice(0, 50000),
  };
};

const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));

const renderPdfPageToBlob = async (page: any, scale: number) => {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return await canvasBlob(canvas);
};

const extractPdfViaOcr = async (
  pdf: { numPages: number; getPage: (n: number) => Promise<any> },
  maxPages = 5
) => {
  const limit = Math.min(maxPages, pdf.numPages);
  const texts: string[] = [];
  let confidenceSum = 0;
  let confidenceCount = 0;
  const scales = [2.4, 2.0, 1.6];

  for (let i = 1; i <= limit; i += 1) {
    const page = await pdf.getPage(i);
    let bestText = "";
    let bestConfidence = 0;

    for (const scale of scales) {
      const blob = await renderPdfPageToBlob(page, scale);
      if (!blob) continue;
      const ocr = await ocrImage(blob);
      if (!ocr?.text) continue;
      const score = ocr.confidence + Math.min(10, ocr.text.length / 300);
      const bestScore = bestConfidence + Math.min(10, bestText.length / 300);
      if (score > bestScore) {
        bestText = ocr.text;
        bestConfidence = ocr.confidence;
      }
      if (ocr.confidence >= 70 && ocr.text.length > 120) break;
    }

    if (!bestText) continue;
    texts.push(`\n[Page ${i}]\n${bestText}`);
    confidenceSum += bestConfidence;
    confidenceCount += 1;
  }

  return {
    text: extractReadableText(texts.join("\n")).slice(0, 160000),
    pagesAnalyzed: limit,
    confidence: confidenceCount ? confidenceSum / confidenceCount : 0,
  };
};

const extractTextFromFile = async (file: File) => {
  if (file.type === "text/plain") {
    const text = extractReadableText(await file.text()).slice(0, 50000);
    return {
      text,
      extractionMethod: "direct-text" as const,
      scannedNonEditable: false,
      pagesAnalyzed: 1,
      extractionConfidence: 100,
    };
  }

  if (file.type.startsWith("image/")) {
    const ocr = await ocrImage(file);
    return {
      text: ocr?.text ?? "",
      extractionMethod: "ocr-image" as const,
      scannedNonEditable: true,
      pagesAnalyzed: 1,
      extractionConfidence: ocr?.confidence ?? 0,
    };
  }

  if (file.type === "application/pdf") {
    try {
      const pdfExtraction = await extractPdfTextLayer(file);
      const textLayerText = pdfExtraction.text;
      const scannedLikely = textLayerText.length < 400;

      if (!scannedLikely) {
        return {
          text: textLayerText,
          extractionMethod: "pdf-text-layer" as const,
          scannedNonEditable: false,
          pagesAnalyzed: pdfExtraction.pdf.numPages,
          extractionConfidence: 95,
        };
      }

      const ocrPdf = await extractPdfViaOcr(pdfExtraction.pdf, Math.min(pdfExtraction.pdf.numPages, 50));
      const roughText = ocrPdf.text ? "" : await roughPdfTextFromBytes(file);
      const merged = ocrPdf.text || roughText || textLayerText;
      return {
        text: merged,
        extractionMethod: ocrPdf.text ? ("ocr-pdf" as const) : roughText ? ("fallback" as const) : ("pdf-text-layer" as const),
        scannedNonEditable: true,
        pagesAnalyzed: ocrPdf.pagesAnalyzed || pdfExtraction.pdf.numPages,
        extractionConfidence: ocrPdf.confidence || (roughText ? 45 : 55),
      };
    } catch {
      const rough = await roughPdfTextFromBytes(file);
      return {
        text: rough,
        extractionMethod: "fallback" as const,
        scannedNonEditable: true,
        pagesAnalyzed: rough ? 1 : 0,
        extractionConfidence: rough ? 35 : 0,
      };
    }
  }

  try {
    const fallback = extractReadableText(await readBlobAsText(file)).slice(0, 20000);
    return {
      text: fallback,
      extractionMethod: "fallback" as const,
      scannedNonEditable: false,
      pagesAnalyzed: 1,
      extractionConfidence: fallback ? 45 : 0,
    };
  } catch {
    return {
      text: "",
      extractionMethod: "fallback" as const,
      scannedNonEditable: false,
      pagesAnalyzed: 0,
      extractionConfidence: 0,
    };
  }
};

export const analyzeDocumentFile = async (
  file: File
): Promise<
  Pick<
    DocumentRecord,
    | "trustScore"
    | "risks"
    | "summary"
    | "keyFindings"
    | "clauses"
    | "extractedText"
    | "editableText"
    | "fileKind"
    | "extractionMethod"
    | "scannedNonEditable"
    | "pagesAnalyzed"
    | "extractionConfidence"
  >
> => {
  if (isZipLikeFile(file)) {
    return await analyzeZipArchive(file);
  }

  const extracted = await extractTextFromFile(file);
  const text = extracted.text || file.name;
  const extractedText = extracted.text || "";

  const findings: DocumentRecord["keyFindings"] = [];
  const clauses: DocumentRecord["clauses"] = [];

  for (const rule of LEGAL_RISK_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    findings.push({
      type: rule.severity === "low" ? "neutral" : "risk",
      title: rule.title,
      description: rule.description,
      severity: rule.severity,
    });
    clauses.push({
      original: truncate(match[0], 160),
      simplified: rule.simplified,
      risk: rule.severity,
    });
  }

  const wordCount = extractedText.split(/\s+/).filter(Boolean).length;
  const sentenceCount = extractedText.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).length;
  const hasFinancialTerms = FINANCIAL_PATTERNS.some((pattern) => pattern.test(text));
  const hasDateTerms = DATE_PATTERNS.some((pattern) => pattern.test(text));
  const highRisks = findings.filter((f) => f.severity === "high").length;
  const mediumRisks = findings.filter((f) => f.severity === "medium").length;
  const lowRisks = findings.filter((f) => f.severity === "low").length;
  const totalRisks = highRisks + mediumRisks + lowRisks;

  let trustScore = 84;
  trustScore -= highRisks * 22 + mediumRisks * 12 + lowRisks * 5;
  if (wordCount < 40) trustScore -= 8;
  if (sentenceCount < 3) trustScore -= 5;
  if (!hasFinancialTerms) trustScore -= 3;
  if (!hasDateTerms) trustScore -= 3;
  if (!extracted.text && !file.type.startsWith("text/")) trustScore -= 8;
  if (extracted.scannedNonEditable && extracted.extractionConfidence < 60) trustScore -= 6;
  trustScore = clamp(trustScore, 12, 96);

  findings.unshift({
    type: "neutral",
    title: "Document Extraction",
    description: `Mode: ${extracted.extractionMethod}. Pages analyzed: ${extracted.pagesAnalyzed}. OCR confidence: ${Math.round(
      extracted.extractionConfidence
    )}%`,
    severity: "low",
  });

  if (extracted.scannedNonEditable) {
    findings.push({
      type: "neutral",
      title: "Scanned / Non-Editable Source",
      description:
        "This file behaves like a scan. Editable text is generated using OCR and should be reviewed before use.",
      severity: "medium",
    });
  }

  if (findings.length === 0) {
    findings.push({
      type: "positive",
      title: "No obvious high-risk phrases",
      description: "No high-risk legal patterns matched in extracted text.",
      severity: "low",
    });
  }

  if (clauses.length === 0) {
    clauses.push({
      original: truncate(text, 140),
      simplified: extracted.text
        ? "The document appears readable. Review payment, termination, and liability sections manually."
        : "Text extraction was limited for this file type. For scanned files, OCR package support is required.",
      risk: totalRisks > 0 ? "medium" : "low",
    });
  }

  const summaryParts: string[] = [];
  summaryParts.push(
    totalRisks === 0
      ? "No major risk clauses were detected from extracted content."
      : `Detected ${totalRisks} risk signal(s) from contract language patterns.`
  );
  if (!extractedText) {
    summaryParts.push(`No readable text was extracted using ${extracted.extractionMethod}.`);
  } else {
    summaryParts.push(`Extracted ${wordCount} words across ${Math.max(1, sentenceCount)} sentence(s) using ${extracted.extractionMethod}.`);
  }
  if (extracted.scannedNonEditable) {
    summaryParts.push("Source appears scanned/non-editable; OCR-generated editable text is available.");
  }

  return {
    trustScore,
    risks: totalRisks,
    summary: summaryParts.join(" "),
    keyFindings: findings.slice(0, 6),
    clauses: clauses.slice(0, 6),
    extractedText: extracted.text,
    editableText: extracted.text,
    fileKind: getFileKind(file),
    extractionMethod: extracted.extractionMethod,
    scannedNonEditable: extracted.scannedNonEditable,
    pagesAnalyzed: extracted.pagesAnalyzed,
    extractionConfidence: Math.round(extracted.extractionConfidence),
  };
};
