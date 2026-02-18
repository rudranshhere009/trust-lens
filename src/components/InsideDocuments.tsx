import { type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Eye, Trash2, FileText, Download, ShieldCheck, AlertTriangle, ShieldAlert, Skull, Fingerprint, ScanSearch, FileStack } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { analyzeDocumentFile } from "@/utils/realAnalysis";
import type { AppTrack } from "@/utils/insideData";
import { loadInsideDocuments, updateInsideDocuments, type InsideDocumentRecord } from "@/utils/insideDocumentsData";
import { SECTION_ACTION_EVENT, isSectionActionDetail } from "@/utils/sectionActionEvents";
import { analyzeCanvasForensics, computeAuthenticity, getDocumentMetadataFlags, readDataUrlBytes, sha256Hex, type ForensicBreakdown, type ForensicHotspot, type ForensicMetadataFlag } from "@/utils/forensicLab";

interface InsideDocumentsProps {
  mode: AppTrack;
}

interface DetectedLink {
  label: string;
  url: string;
  safety: "safe" | "caution" | "risky";
  reason: string;
}

type IocBundle = {
  emails: string[];
  ips: string[];
  domains: string[];
  filePaths: string[];
};

const extractIocs = (text: string): IocBundle => {
  const emails = Array.from(new Set((text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || []).slice(0, 30)));
  const ips = Array.from(new Set((text.match(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g) || []).slice(0, 30)));
  const domains = Array.from(
    new Set(
      (text.match(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|co|ai|dev|app|info|biz)\b/gi) || [])
        .filter((d) => !/^(?:com|org|net)$/i.test(d))
        .slice(0, 30)
    )
  );
  const filePaths = Array.from(
    new Set((text.match(/\b(?:[A-Za-z]:\\[^\n\r:*?"<>|]+|\/(?:etc|var|usr|tmp|home)\/[^\s\n\r]+)/g) || []).slice(0, 30))
  );
  return { emails, ips, domains, filePaths };
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const dataUrlToFile = (dataUrl: string, fallbackName: string, mime = "application/octet-stream") => {
  const [header, body] = dataUrl.split(",");
  const isBase64 = header.includes(";base64");
  const matchMime = header.match(/data:(.*?)(;|$)/);
  const detectedMime = matchMime?.[1] || mime;

  let bytes: Uint8Array;
  if (isBase64) {
    const binary = atob(body || "");
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } else {
    const decoded = decodeURIComponent(body || "");
    bytes = new TextEncoder().encode(decoded);
  }

  return new File([bytes], fallbackName, { type: detectedMime });
};

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
};

const toRelative = (ts: number) => {
  const d = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (d <= 0) return "today";
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
};

const createId = () => Math.random().toString(36).slice(2, 10);

const wrapCanvasLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const createTextPreviewImage = (title: string, text: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 600;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111111";
  ctx.font = "bold 28px Arial";
  ctx.fillText(title.slice(0, 28), 28, 54);
  ctx.font = "18px Arial";
  const lines = wrapCanvasLines(ctx, text || "No extracted text available.", canvas.width - 56);
  let y = 94;
  for (const line of lines) {
    ctx.fillText(line, 28, y);
    y += 28;
    if (y > canvas.height - 24) break;
  }
  return canvas.toDataURL("image/png");
};

const looksLikeIpHost = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

const scoreLinkSafety = (url: string): { safety: "safe" | "caution" | "risky"; reason: string } => {
  try {
    const u = new URL(url);
    let score = 55;
    const reasons: string[] = [];

    if (u.protocol === "https:") {
      score += 20;
      reasons.push("HTTPS");
    } else {
      score -= 25;
      reasons.push("Non-HTTPS");
    }

    const host = u.hostname.toLowerCase();
    if (looksLikeIpHost(host)) {
      score -= 25;
      reasons.push("IP-host");
    }
    if (host.includes("xn--")) {
      score -= 20;
      reasons.push("Punycode");
    }
    if (/(bit\.ly|tinyurl\.com|t\.co|rb\.gy|cutt\.ly)$/i.test(host)) {
      score -= 20;
      reasons.push("Shortened link");
    }
    if (/\.(zip|click|top|xyz|gq)$/i.test(host)) {
      score -= 15;
      reasons.push("High-risk TLD");
    }

    if (score >= 70) return { safety: "safe", reason: reasons.join(", ") || "Trusted signals" };
    if (score >= 45) return { safety: "caution", reason: reasons.join(", ") || "Mixed signals" };
    return { safety: "risky", reason: reasons.join(", ") || "Risky signals" };
  } catch {
    return { safety: "risky", reason: "Malformed URL" };
  }
};

const extractLinksFromText = (text: string): DetectedLink[] => {
  if (!text.trim()) return [];
  const patterns = [
    /https?:\/\/[^\s<>"')\]]+/gi,
    /www\.[^\s<>"')\]]+/gi,
    /\b(?:[a-z0-9-]+\.)+(?:com|org|net|in|io|gov|edu|co|ai|dev|app|me)(?:\/[^\s<>"')\]]*)?/gi,
  ];

  const rawMatches = new Set<string>();
  for (const p of patterns) {
    const found = text.match(p) || [];
    for (const item of found) rawMatches.add(item.replace(/[.,;:]+$/, ""));
  }

  // Recover profile links where OCR/text spacing breaks the URL token.
  const spacedGithub = [...text.matchAll(/github\.com\s*\/?\s*([a-z0-9-]{2,39})/gi)];
  for (const m of spacedGithub) {
    rawMatches.add(`https://github.com/${m[1]}`);
  }
  const spacedLinkedIn = [...text.matchAll(/linkedin\.com\s*\/\s*(in|company)\s*\/\s*([a-z0-9-_%]{2,100})/gi)];
  for (const m of spacedLinkedIn) {
    rawMatches.add(`https://linkedin.com/${m[1]}/${m[2]}`);
  }

  const result: DetectedLink[] = [];
  const seen = new Set<string>();
  for (const raw of rawMatches) {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const safety = scoreLinkSafety(normalized);
    result.push({
      label: raw,
      url: normalized,
      safety: safety.safety,
      reason: safety.reason,
    });
  }
  return result.slice(0, 40);
};

const getDisplayExtractedText = (doc: InsideDocumentRecord) => {
  const text = (doc.extractedText || "").trim();
  if (text) return text;
  return [
    "No readable OCR text was extracted from this file.",
    `Extraction method: ${doc.extractionMethod || "n/a"}`,
    `OCR confidence: ${doc.extractionConfidence ?? 0}%`,
    "Try a clearer image, increase OCR quality settings, or run extraction again.",
  ].join("\n");
};

type RiskTier = "low" | "medium" | "high" | "extreme";

const readNumericMetric = (text: string, label: string) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`${escaped}:\\s*(\\d+(?:\\.\\d+)?)`, "i"));
  return m ? Number(m[1]) : 0;
};

const computeStrictRiskScore = (doc: InsideDocumentRecord) => {
  const text = (doc.extractedText || "").trim();
  const links = extractLinksFromText(text);
  const cautionLinks = links.filter((x) => x.safety === "caution").length;
  const riskyLinks = links.filter((x) => x.safety === "risky").length;
  const piiHits = ((text.match(/\b\d{3}-\d{2}-\d{4}\b/g) || []).length + (text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || []).length);
  const phishingKeywords = (text.match(/\b(urgent|wire transfer|gift card|otp|password|verify account|bank details|crypto wallet|enable macros|invoice attached)\b/gi) || []).length;

  let score = Math.round(
    doc.risks * 18 +
      (100 - doc.trustScore) * 0.55 +
      riskyLinks * 14 +
      cautionLinks * 7 +
      piiHits * 4 +
      phishingKeywords * 6
  );

  const confidence = doc.extractionConfidence ?? 0;
  if (!text || confidence < 60) score += 8;

  if (doc.extractionMethod === "zip-static-scan") {
    const execCount = readNumericMetric(text, "Executable/Script Files");
    const macroCount = readNumericMetric(text, "Macro Files");
    const nestedCount = readNumericMetric(text, "Nested Archives");
    const traversalCount = readNumericMetric(text, "Path Traversal Patterns");
    const encryptedCount = readNumericMetric(text, "Encrypted Entries");
    const ratio = readNumericMetric(text, "Max Compression Ratio");
    const totalEntries = readNumericMetric(text, "Entries");
    const summary = (doc.summary || "").toLowerCase();

    // ZIP-specific live metrics from current scan output.
    score += execCount * 18;
    score += macroCount * 10;
    score += nestedCount * 6;
    score += traversalCount * 25;
    score += encryptedCount * 18;

    if (ratio >= 120) score += 22;
    else if (ratio >= 80) score += 14;
    if (totalEntries >= 4000) score += 18;

    // Signature failure/tampering should stay near critical.
    if (/invalid archive signature|invalid zip signature|tampered|do not extract|block extraction/i.test(summary)) {
      score = Math.max(score, 92);
    }
  }

  return Math.min(100, Math.max(0, score));
};

const getRiskTier = (doc: InsideDocumentRecord): RiskTier => {
  const strict = computeStrictRiskScore(doc);
  if (doc.extractionMethod === "zip-static-scan") {
    const text = (doc.extractedText || "").trim();
    const execCount = readNumericMetric(text, "Executable/Script Files");
    const traversalCount = readNumericMetric(text, "Path Traversal Patterns");
    const encryptedCount = readNumericMetric(text, "Encrypted Entries");
    const ratio = readNumericMetric(text, "Max Compression Ratio");
    const criticalSignals =
      (execCount > 0 ? 1 : 0) +
      (traversalCount > 0 ? 1 : 0) +
      (encryptedCount > 0 ? 1 : 0) +
      (ratio >= 120 ? 1 : 0);
    if (doc.trustScore <= 35 || criticalSignals >= 2 || strict >= 90) return "extreme";
    if (strict >= 60 || criticalSignals >= 1) return "high";
    if (strict >= 35) return "medium";
    return "low";
  }
  if (strict >= 85) return "extreme";
  if (strict >= 60) return "high";
  if (strict >= 35) return "medium";
  return "low";
};

const riskLabel = (doc: InsideDocumentRecord) => {
  const tier = getRiskTier(doc);
  if (tier === "extreme") return "Extreme Risk";
  if (tier === "high") return "High Risk";
  if (tier === "medium") return "Medium Risk";
  return "Low Risk";
};

const buildRiskReasonLines = (doc: InsideDocumentRecord) => {
  const lines: string[] = [];
  const label = riskLabel(doc);
  const confidence = doc.extractionConfidence ?? 0;
  const hasText = Boolean((doc.extractedText || "").trim());

  lines.push(`Risk Category: ${label}`);
  lines.push(`Trust Score: ${doc.trustScore}`);
  lines.push(`Detected Risk Signals: ${doc.risks}`);
  lines.push(`Document Type: ${doc.type || "unknown"}`);
  lines.push(`Extraction Method: ${doc.extractionMethod || "n/a"}`);
  lines.push(`Pages Analyzed: ${doc.pagesAnalyzed ?? 0}`);
  lines.push(`OCR Confidence: ${confidence}%`);
  lines.push(`Readable Text Extracted: ${hasText ? "Yes" : "No"}`);

  if (label === "Low Risk") {
    lines.push("Reason: No major cyber-risk indicators were detected and trust remained in safer range.");
  } else if (label === "Medium Risk") {
    lines.push("Reason: Some cyber-risk indicators were detected or trust dropped from safer range.");
  } else {
    lines.push("Reason: Multiple cyber-risk indicators and/or lower trust score indicate elevated risk.");
  }

  if (!hasText || confidence < 40) {
    lines.push("Quality Warning: OCR quality is low. Final risk may be incomplete until clearer extraction is run.");
  }

  if ((doc.extractionMethod || "").includes("ocr")) {
    lines.push("Context: This file was treated as scanned/non-editable and analyzed via OCR.");
  }

  lines.push(`Summary From Analyzer: ${doc.summary}`);
  return lines;
};

const getStatusLabel = (doc: InsideDocumentRecord): "new" | "viewed" => {
  if (doc.status === "new") return "new";
  return "viewed";
};

const buildCyberSecurityLines = (doc: InsideDocumentRecord) => {
  const text = (doc.extractedText || "").trim();
  const links = extractLinksFromText(text);
  const safeLinks = links.filter((x) => x.safety === "safe").length;
  const cautionLinks = links.filter((x) => x.safety === "caution").length;
  const riskyLinks = links.filter((x) => x.safety === "risky").length;

  const piiPatterns = [
    /\b\d{3}-\d{2}-\d{4}\b/g,
    /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b(?:\d[ -]*?){13,19}\b/g,
  ];
  const piiHits = piiPatterns.reduce((acc, p) => acc + (text.match(p) || []).length, 0);

  const phishingKeywords = (
    text.match(/\b(urgent|wire transfer|gift card|otp|password|verify account|bank details|crypto wallet|enable macros|invoice attached)\b/gi) ||
    []
  ).length;

  const confidence = doc.extractionConfidence ?? 0;
  const strictRiskScore = computeStrictRiskScore(doc);
  const level = strictRiskScore >= 85 ? "CRITICAL" : strictRiskScore >= 60 ? "HIGH" : strictRiskScore >= 35 ? "MEDIUM" : "LOW";

  return [
    `Cyber Security Risk Level: ${level}`,
    `Strict Risk Score (0-100): ${strictRiskScore}`,
    `Live Risk Model: recalculated from current scan metrics`,
    `Link Safety Scan: ${links.length} links | safe ${safeLinks} | caution ${cautionLinks} | risky ${riskyLinks}`,
    `Sensitive Data Exposure Signals: ${piiHits}`,
    `Social-Engineering Pattern Hits: ${phishingKeywords}`,
    `OCR Integrity Confidence: ${confidence}%`,
    `Scan Verification: method ${doc.extractionMethod || "n/a"} | pages ${doc.pagesAnalyzed ?? 0} | text length ${text.length}`,
  ];
};

const RiskLogo = ({ doc }: { doc: InsideDocumentRecord }) => {
  const tier = getRiskTier(doc);
  if (tier === "extreme") {
    return (
      <div className="inline-flex items-center gap-1 rounded-md border border-red-900 bg-red-700 text-white px-2 py-1 text-[11px] font-semibold">
        <Skull className="h-3.5 w-3.5" />
        EXTREME
      </div>
    );
  }
  if (tier === "high") {
    return (
      <div className="inline-flex items-center gap-1 rounded-md border border-red-400 bg-red-100 text-red-800 px-2 py-1 text-[11px] font-semibold">
        <ShieldAlert className="h-3.5 w-3.5" />
        HIGH
      </div>
    );
  }
  if (tier === "medium") {
    return (
      <div className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-100 text-amber-800 px-2 py-1 text-[11px] font-semibold">
        <AlertTriangle className="h-3.5 w-3.5" />
        MEDIUM
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-green-400 bg-green-100 text-green-800 px-2 py-1 text-[11px] font-semibold">
      <ShieldCheck className="h-3.5 w-3.5" />
      LOW
    </div>
  );
};

const isImageDataUrl = (value: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(value.trim());
const isZipByName = (name: string) => /\.zip$/i.test(name);
const isPdfByName = (name: string) => /\.pdf$/i.test(name);
const isTxtByName = (name: string) => /\.txt$/i.test(name);
const isImageByName = (name: string) => /\.(png|jpe?g|webp)$/i.test(name);
const isSupportedUploadFile = (file: File) => {
  const type = String(file.type || "").toLowerCase();
  if (
    type === "application/pdf" ||
    type === "text/plain" ||
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/jpg" ||
    type === "image/webp" ||
    type === "application/zip" ||
    type === "application/x-zip-compressed" ||
    type === "multipart/x-zip"
  ) {
    return true;
  }
  return isPdfByName(file.name) || isTxtByName(file.name) || isImageByName(file.name) || isZipByName(file.name);
};

const crc32 = (data: Uint8Array) => {
  let c = 0 ^ -1;
  for (let i = 0; i < data.length; i += 1) {
    c ^= data[i];
    for (let j = 0; j < 8; j += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ -1) >>> 0;
};

const makeZipBlob = (filename: string, content: string) => {
  const encoder = new TextEncoder();
  const name = encoder.encode(filename);
  const data = encoder.encode(content);
  const crc = crc32(data);
  const lfh = new Uint8Array(30 + name.length);
  const dv1 = new DataView(lfh.buffer);
  dv1.setUint32(0, 0x04034b50, true);
  dv1.setUint16(4, 20, true);
  dv1.setUint16(8, 0, true);
  dv1.setUint16(10, 0, true);
  dv1.setUint32(14, crc, true);
  dv1.setUint32(18, data.length, true);
  dv1.setUint32(22, data.length, true);
  dv1.setUint16(26, name.length, true);
  lfh.set(name, 30);

  const cdh = new Uint8Array(46 + name.length);
  const dv2 = new DataView(cdh.buffer);
  dv2.setUint32(0, 0x02014b50, true);
  dv2.setUint16(4, 20, true);
  dv2.setUint16(6, 20, true);
  dv2.setUint16(10, 0, true);
  dv2.setUint16(12, 0, true);
  dv2.setUint32(16, crc, true);
  dv2.setUint32(20, data.length, true);
  dv2.setUint32(24, data.length, true);
  dv2.setUint16(28, name.length, true);
  dv2.setUint32(42, 0, true);
  cdh.set(name, 46);

  const eocd = new Uint8Array(22);
  const dv3 = new DataView(eocd.buffer);
  dv3.setUint32(0, 0x06054b50, true);
  dv3.setUint16(8, 1, true);
  dv3.setUint16(10, 1, true);
  dv3.setUint32(12, cdh.length, true);
  dv3.setUint32(16, lfh.length + data.length, true);

  return new Blob([lfh, data, cdh, eocd], { type: "application/zip" });
};

const runWithConcurrency = async <T,>(items: T[], limit: number, worker: (item: T) => Promise<void>) => {
  if (items.length === 0) return;
  const size = Math.max(1, Math.min(limit, items.length));
  let index = 0;
  const runners = Array.from({ length: size }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
};

export const InsideDocuments = ({ mode }: InsideDocumentsProps) => {
  const [store, setStore] = useState(() => loadInsideDocuments());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [processingDocIds, setProcessingDocIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "risky" | "viewed">("all");
  const [sourceHits, setSourceHits] = useState<DetectedLink[]>([]);
  const [isSearchingSources, setIsSearchingSources] = useState(false);
  const [isReextracting, setIsReextracting] = useState(false);
  const [activeOcrDocId, setActiveOcrDocId] = useState<string | null>(null);
  const [riskDocId, setRiskDocId] = useState<string | null>(null);
  const [riskAnalysisLines, setRiskAnalysisLines] = useState<string[]>([]);
  const [isRunningRiskAnalysis, setIsRunningRiskAnalysis] = useState(false);
  const [activeRiskScanDocId, setActiveRiskScanDocId] = useState<string | null>(null);
  const [downloadMenuDocId, setDownloadMenuDocId] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [filterDocId, setFilterDocId] = useState<string | null>(null);
  const [selectedSlice, setSelectedSlice] = useState("");
  const [selectionDraft, setSelectionDraft] = useState("");
  const [selectedImageSliceDataUrl, setSelectedImageSliceDataUrl] = useState("");
  const [isExtractingImageRegion, setIsExtractingImageRegion] = useState(false);
  const [imageSelectionRect, setImageSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isDraggingImageSelection, setIsDraggingImageSelection] = useState(false);
  const [forensicLoading, setForensicLoading] = useState(false);
  const [forensicMetadataFlags, setForensicMetadataFlags] = useState<ForensicMetadataFlag[]>([]);
  const [forensicHash, setForensicHash] = useState("");
  const [forensicHotspots, setForensicHotspots] = useState<ForensicHotspot[]>([]);
  const [forensicCloneSignals, setForensicCloneSignals] = useState(0);
  const [forensicAuthenticity, setForensicAuthenticity] = useState(0);
  const [forensicBreakdown, setForensicBreakdown] = useState<ForensicBreakdown[]>([]);
  const [forensicIocs, setForensicIocs] = useState<IocBundle>({ emails: [], ips: [], domains: [], filePaths: [] });
  const inputRef = useRef<HTMLInputElement>(null);
  const filterImageRef = useRef<HTMLImageElement | null>(null);
  const previewForensicRef = useRef<HTMLImageElement | null>(null);
  const imageSelectionStartRef = useRef<{ x: number; y: number } | null>(null);

  const allDocsForMode = useMemo(
    () =>
      store.documents
        .filter((d) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          return d.name.toLowerCase().includes(q) || (d.summary || "").toLowerCase().includes(q);
        })
        .filter((d) => {
          if (statusFilter === "risky") return d.risks > 0;
          if (statusFilter === "viewed") return getStatusLabel(d) === "viewed";
          return true;
        })
        .sort((a, b) => b.uploadedAt - a.uploadedAt),
    [store.documents, query, statusFilter]
  );

  const selected = allDocsForMode.find((d) => d.id === selectedId) ?? null;
  const riskDoc = allDocsForMode.find((d) => d.id === riskDocId) ?? null;
  const filterDoc = allDocsForMode.find((d) => d.id === filterDocId) ?? null;

  const stats = useMemo(() => {
    const list = store.documents;
    return {
      total: list.length,
      newDocs: list.filter((x) => getStatusLabel(x) === "new").length,
      viewed: list.filter((x) => getStatusLabel(x) === "viewed").length,
      risky: list.filter((x) => x.risks > 0).length,
    };
  }, [store.documents]);

  const sync = (updater: Parameters<typeof updateInsideDocuments>[0]) => {
    const next = updateInsideDocuments(updater);
    setStore(next);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const candidates = Array.from(files).filter((file) => isSupportedUploadFile(file));
    if (candidates.length === 0) return;

    const queued = candidates.map((file) => ({
      id: createId(),
      file,
      uploadedAt: Date.now(),
    }));
    setIsAnalyzing(true);
    setAnalysisProgress({ done: 0, total: queued.length });
    setProcessingDocIds((current) => [...current, ...queued.map((x) => x.id)]);

    // Insert placeholders immediately so intake feels responsive while scans run in the background.
    sync((current) => ({
      ...current,
      documents: [
        ...queued.map(
          ({ id, file, uploadedAt }) =>
            ({
              id,
              track: mode,
              name: file.name,
              type: file.type || (isZipByName(file.name) ? "application/zip" : "application/octet-stream"),
              size: file.size,
              uploadedAt,
              status: "new",
              trustScore: 0,
              risks: 0,
              summary: "Scanning document with strict cyber risk checks...",
              extractionMethod: "fallback",
              pagesAnalyzed: 0,
              extractionConfidence: 0,
              extractedText: "",
              sourceDataUrl: "",
              sourceMime: file.type || (isZipByName(file.name) ? "application/zip" : "application/octet-stream"),
            }) as InsideDocumentRecord
        ),
        ...current.documents,
      ],
    }));

    try {
      await runWithConcurrency(queued, 2, async ({ id, file }) => {
        try {
          const [analysis, dataUrl] = await Promise.all([
            analyzeDocumentFile(file),
            fileToDataUrl(file).catch(() => ""),
          ]);
          sync((current) => ({
            ...current,
            documents: current.documents.map((d) =>
              d.id === id
                ? {
                    ...d,
                    trustScore: analysis.trustScore,
                    risks: analysis.risks,
                    summary: analysis.summary,
                    extractionMethod: analysis.extractionMethod,
                    pagesAnalyzed: analysis.pagesAnalyzed,
                    extractionConfidence: analysis.extractionConfidence,
                    extractedText: analysis.extractedText,
                    sourceDataUrl: dataUrl,
                    sourceMime: file.type || d.sourceMime,
                  }
                : d
            ),
          }));
        } catch {
          sync((current) => ({
            ...current,
            documents: current.documents.map((d) =>
              d.id === id
                ? {
                    ...d,
                    trustScore: 28,
                    risks: 2,
                    summary: "Scan failed during strict analysis. Treat as risky and re-upload or re-scan.",
                    extractionMethod: "fallback",
                    pagesAnalyzed: 0,
                    extractionConfidence: 0,
                  }
                : d
            ),
          }));
        } finally {
          setProcessingDocIds((current) => current.filter((x) => x !== id));
          setAnalysisProgress((current) => ({ ...current, done: Math.min(current.total, current.done + 1) }));
        }
      });
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress({ done: 0, total: 0 });
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const downloadTxt = (doc: InsideDocumentRecord) => {
    const text = doc.extractedText?.trim() || `${doc.name}\n${doc.summary}`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name.replace(/\.[^/.]+$/, "")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadZip = (doc: InsideDocumentRecord) => {
    const text = doc.extractedText?.trim() || `${doc.name}\n${doc.summary}`;
    const zip = makeZipBlob(`${doc.name.replace(/\.[^/.]+$/, "")}.txt`, text);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zip);
    a.download = `${doc.name.replace(/\.[^/.]+$/, "")}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const getRecommendedDownload = (doc: InsideDocumentRecord): "txt" | "pdf" | "img" | "zip" => {
    const textLength = (doc.extractedText || "").trim().length;
    const fileType = (doc.sourceMime || doc.type || "").toLowerCase();
    if (fileType.startsWith("image/")) return "img";
    if (fileType.includes("zip") || isZipByName(doc.name)) return "zip";
    if (fileType === "application/pdf" || textLength > 3200) return "pdf";
    return "txt";
  };

  const downloadPdf = async (doc: InsideDocumentRecord) => {
    try {
      const jspdf = await import(/* @vite-ignore */ "jspdf");
      const PDF = jspdf.jsPDF;
      const pdf = new PDF({ unit: "pt", format: "a4" });
      const text = doc.extractedText?.trim() || `${doc.name}\n${doc.summary}`;
      const lines = pdf.splitTextToSize(text, 520);
      pdf.setFontSize(12);
      pdf.text(lines, 40, 60);
      pdf.save(`${doc.name.replace(/\.[^/.]+$/, "")}.pdf`);
    } catch {
      downloadTxt(doc);
    }
  };

  const downloadImg = (doc: InsideDocumentRecord) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const text = doc.extractedText?.trim() || `${doc.name}\n${doc.summary}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111111";
    ctx.font = "28px Arial";
    ctx.fillText(doc.name, 60, 80);
    ctx.font = "20px Arial";
    const lines = wrapCanvasLines(ctx, text, canvas.width - 120);
    let y = 130;
    for (const line of lines) {
      ctx.fillText(line, 60, y);
      y += 30;
      if (y > canvas.height - 60) break;
    }
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name.replace(/\.[^/.]+$/, "")}.png`;
    a.click();
  };

  const searchSourcesForDoc = async (doc: InsideDocumentRecord) => {
    const sourceText = (doc.extractedText || doc.summary || doc.name).trim();
    if (!sourceText) return;
    setIsSearchingSources(true);
    try {
      const hits = extractLinksFromText(sourceText);
      setSourceHits(hits);
    } finally {
      setIsSearchingSources(false);
    }
  };

  const reExtractDoc = async (doc: InsideDocumentRecord) => {
    if (!doc.sourceDataUrl) return;
    setActiveOcrDocId(doc.id);
    setIsReextracting(true);
    try {
      const sourceFile = dataUrlToFile(doc.sourceDataUrl, doc.name, doc.sourceMime || doc.type);
      const analysis = await analyzeDocumentFile(sourceFile);
      sync((current) => ({
        ...current,
        documents: current.documents.map((d) =>
          d.id === doc.id
            ? {
                ...d,
                trustScore: analysis.trustScore,
                risks: analysis.risks,
                summary: analysis.summary,
                extractionMethod: analysis.extractionMethod,
                pagesAnalyzed: analysis.pagesAnalyzed,
                extractionConfidence: analysis.extractionConfidence,
                extractedText: analysis.extractedText,
              }
            : d
        ),
      }));
    } finally {
      setIsReextracting(false);
      setActiveOcrDocId(null);
    }
  };

  const openDocument = (docId: string) => {
    setSelectedId(docId);
    setSourceHits([]);
    sync((current) => ({
      ...current,
      documents: current.documents.map((x) => (x.id === docId ? { ...x, status: "viewed" } : x)),
    }));
  };

  const runRiskAnalysis = async (doc: InsideDocumentRecord) => {
    setRiskDocId(null);
    setActiveRiskScanDocId(doc.id);
    setIsRunningRiskAnalysis(true);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      let resolved: InsideDocumentRecord = doc;

      if (doc.sourceDataUrl) {
        const sourceFile = dataUrlToFile(doc.sourceDataUrl, doc.name, doc.sourceMime || doc.type);
        const analysis = await analyzeDocumentFile(sourceFile);
        const next = updateInsideDocuments((current) => ({
          ...current,
          documents: current.documents.map((d) =>
            d.id === doc.id
              ? {
                  ...d,
                  trustScore: analysis.trustScore,
                  risks: analysis.risks,
                  summary: analysis.summary,
                  extractionMethod: analysis.extractionMethod,
                  pagesAnalyzed: analysis.pagesAnalyzed,
                  extractionConfidence: analysis.extractionConfidence,
                  extractedText: analysis.extractedText,
                }
              : d
          ),
        }));
        setStore(next);
        resolved = next.documents.find((d) => d.id === doc.id) || doc;
      }

      const finalLines = [...buildRiskReasonLines(resolved), ...buildCyberSecurityLines(resolved)];
      setRiskAnalysisLines(finalLines);
      setRiskDocId(resolved.id);
    } finally {
      setIsRunningRiskAnalysis(false);
      setActiveRiskScanDocId(null);
    }
  };

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const toImageRelativePoint = (clientX: number, clientY: number) => {
    const image = filterImageRef.current;
    if (!image) return null;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    return { x, y, rect };
  };

  const startImageSelection = (clientX: number, clientY: number) => {
    const point = toImageRelativePoint(clientX, clientY);
    if (!point) return;
    imageSelectionStartRef.current = { x: point.x, y: point.y };
    setIsDraggingImageSelection(true);
    setImageSelectionRect({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const moveImageSelection = (clientX: number, clientY: number) => {
    if (!isDraggingImageSelection || !imageSelectionStartRef.current) return;
    const point = toImageRelativePoint(clientX, clientY);
    if (!point) return;
    const start = imageSelectionStartRef.current;
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const width = Math.abs(point.x - start.x);
    const height = Math.abs(point.y - start.y);
    setImageSelectionRect({ x, y, width, height });
  };

  const stopImageSelection = () => {
    setIsDraggingImageSelection(false);
    imageSelectionStartRef.current = null;
  };

  const selectImageRegion = async () => {
    const image = filterImageRef.current;
    const rect = imageSelectionRect;
    if (!image || !rect || rect.width < 4 || rect.height < 4) return;
    const displayRect = image.getBoundingClientRect();
    const naturalWidth = image.naturalWidth || 0;
    const naturalHeight = image.naturalHeight || 0;
    if (!displayRect.width || !displayRect.height || !naturalWidth || !naturalHeight) return;

    const sx = Math.floor((rect.x / displayRect.width) * naturalWidth);
    const sy = Math.floor((rect.y / displayRect.height) * naturalHeight);
    const sw = Math.max(1, Math.floor((rect.width / displayRect.width) * naturalWidth));
    const sh = Math.max(1, Math.floor((rect.height / displayRect.height) * naturalHeight));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
    const cropDataUrl = canvas.toDataURL("image/png");
    setSelectedImageSliceDataUrl(cropDataUrl);
    // For image crop workflow, keep region as image selection (no auto text paste).
    setSelectionDraft("");
    setSelectedSlice("");
    setIsExtractingImageRegion(false);
  };

  const copySelectedSlice = async () => {
    if (!selectedSlice.trim()) return;
    try {
      await navigator.clipboard.writeText(selectedSlice);
    } catch {
      // ignore clipboard failures
    }
  };

  const extractTextFromImagePayload = async (payload: string | File) => {
    try {
      const imageFile = typeof payload === "string" ? dataUrlToFile(payload, "selection-image.png", "image/png") : payload;
      const analysis = await analyzeDocumentFile(imageFile);
      const text = (analysis.extractedText || "").trim();
      if (text) return text;
      return "Image detected, but no readable text could be extracted. Please copy text directly from the document.";
    } catch {
      return "Image payload detected, but text extraction failed. Please paste or copy text instead of image data.";
    }
  };

  const setSelectionFromUnknownInput = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setSelectedImageSliceDataUrl("");
    if (!isImageDataUrl(value)) {
      setSelectionDraft(raw);
      setSelectedSlice(raw);
      return;
    }
    setSelectionDraft("Extracting text from dropped/pasted image...");
    setSelectedSlice("");
    const extracted = await extractTextFromImagePayload(value);
    setSelectionDraft(extracted);
    setSelectedSlice(extracted);
  };

  const loadCopiedTextAsSelection = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) await setSelectionFromUnknownInput(text);
    } catch {
      // Clipboard read may be blocked by browser permissions.
    }
  };

  const getSelectionForExport = async () => {
    const text = selectedSlice.trim();
    if (!text) return "";
    if (!isImageDataUrl(text)) return selectedSlice;
    const extracted = await extractTextFromImagePayload(text);
    setSelectionDraft(extracted);
    setSelectedSlice(extracted);
    return extracted;
  };

  const exportSliceTxt = async () => {
    if ((!selectedSlice.trim() && !selectedImageSliceDataUrl) || !filterDoc) return;
    const text = selectedSlice.trim() ? await getSelectionForExport() : await extractTextFromImagePayload(selectedImageSliceDataUrl);
    if (!text.trim()) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filterDoc.name.replace(/\.[^/.]+$/, "")}-selection.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSlicePdf = async () => {
    if ((!selectedSlice.trim() && !selectedImageSliceDataUrl) || !filterDoc) return;
    try {
      const jspdf = await import(/* @vite-ignore */ "jspdf");
      const PDF = jspdf.jsPDF;
      const pdf = new PDF({ unit: "pt", format: "a4" });
      if (selectedImageSliceDataUrl) {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to load selection image"));
          img.src = selectedImageSliceDataUrl;
        });
        const maxW = 515;
        const maxH = 760;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        pdf.addImage(selectedImageSliceDataUrl, "PNG", 40, 40, w, h);
      } else {
        const text = await getSelectionForExport();
        if (!text.trim()) return;
        const lines = pdf.splitTextToSize(text, 520);
        pdf.setFontSize(12);
        pdf.text(lines, 40, 60);
      }
      pdf.save(`${filterDoc.name.replace(/\.[^/.]+$/, "")}-selection.pdf`);
    } catch {
      await exportSliceTxt();
    }
  };

  const exportSliceImg = async () => {
    if ((!selectedSlice.trim() && !selectedImageSliceDataUrl) || !filterDoc) return;
    if (selectedImageSliceDataUrl) {
      const a = document.createElement("a");
      a.href = selectedImageSliceDataUrl;
      a.download = `${filterDoc.name.replace(/\.[^/.]+$/, "")}-selection.png`;
      a.click();
      return;
    }
    const text = await getSelectionForExport();
    if (!text.trim()) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111111";
    ctx.font = "28px Arial";
    ctx.fillText(`${filterDoc.name} (selection)`, 60, 80);
    ctx.font = "20px Arial";
    const lines = wrapCanvasLines(ctx, text, canvas.width - 120);
    let y = 130;
    for (const line of lines) {
      ctx.fillText(line, 60, y);
      y += 30;
      if (y > canvas.height - 60) break;
    }
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filterDoc.name.replace(/\.[^/.]+$/, "")}-selection.png`;
    a.click();
  };

  const exportForensicEvidence = async (doc: InsideDocumentRecord) => {
    const report = {
      id: doc.id,
      name: doc.name,
      generatedAt: new Date().toISOString(),
      riskTier: riskLabel(doc),
      trustScore: doc.trustScore,
      risks: doc.risks,
      authenticityScore: forensicAuthenticity,
      breakdown: forensicBreakdown,
      metadataFlags: forensicMetadataFlags,
      hotspots: forensicHotspots,
      cloneSignals: forensicCloneSignals,
      iocs: forensicIocs,
    };
    const sourceBytes = doc.sourceDataUrl ? await readDataUrlBytes(doc.sourceDataUrl) : new Uint8Array();
    const sourceHash = sourceBytes.length ? await sha256Hex(sourceBytes) : "n/a";
    const summary = `${doc.summary}\n\nSource SHA256: ${sourceHash}\n`;
    const zip = makeZipBlob(`${doc.name.replace(/\.[^/.]+$/, "")}-forensic-report.json`, JSON.stringify(report, null, 2));
    const summaryBlob = new Blob([summary], { type: "text/plain;charset=utf-8" });
    const a1 = document.createElement("a");
    a1.href = URL.createObjectURL(zip);
    a1.download = `${doc.name.replace(/\.[^/.]+$/, "")}-forensic-report.zip`;
    a1.click();
    URL.revokeObjectURL(a1.href);
    const a2 = document.createElement("a");
    a2.href = URL.createObjectURL(summaryBlob);
    a2.download = `${doc.name.replace(/\.[^/.]+$/, "")}-integrity.txt`;
    a2.click();
    URL.revokeObjectURL(a2.href);
  };

  const handleSelectionPaste = async (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    setSelectedImageSliceDataUrl("");
    const text = e.clipboardData?.getData("text/plain") || "";
    if (isImageDataUrl(text)) {
      e.preventDefault();
      await setSelectionFromUnknownInput(text);
      return;
    }
    const imageItem = Array.from(e.clipboardData?.items || []).find((item) => String(item?.type || "").startsWith("image/"));
    const imageFile = imageItem?.getAsFile?.();
    if (imageFile) {
      e.preventDefault();
      setSelectionDraft("Extracting text from pasted image...");
      setSelectedSlice("");
      const extracted = await extractTextFromImagePayload(imageFile);
      setSelectionDraft(extracted);
      setSelectedSlice(extracted);
    }
  };

  const handleSelectionDrop = async (e: ReactDragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const droppedFile = Array.from(e.dataTransfer?.files || []).find((f) => String(f?.type || "").startsWith("image/"));
    if (droppedFile) {
      setSelectedImageSliceDataUrl("");
      setSelectionDraft("Extracting text from dropped image...");
      setSelectedSlice("");
      const extracted = await extractTextFromImagePayload(droppedFile);
      setSelectionDraft(extracted);
      setSelectedSlice(extracted);
      return;
    }
    const text = e.dataTransfer?.getData("text/plain") || "";
    if (text.trim()) await setSelectionFromUnknownInput(text);
  };

  const renderOriginalDocumentViewer = (doc: InsideDocumentRecord) => {
    const mime = (doc.sourceMime || doc.type || "").toLowerCase();
    const source = doc.sourceDataUrl || "";
    if (!source) {
      return <div className="text-xs text-muted-foreground">No original source file stored for this document.</div>;
    }

    if (mime === "application/pdf") {
      return (
        <iframe
          title={`${doc.name} original pdf`}
          src={source}
          className="w-full h-[520px] border rounded-md bg-white"
        />
      );
    }

    if (mime.startsWith("image/")) {
      return (
        <div className="border rounded-md p-2 bg-muted/20">
          <div
            className="relative inline-block mx-auto"
            onMouseDown={(e) => startImageSelection(e.clientX, e.clientY)}
            onMouseMove={(e) => moveImageSelection(e.clientX, e.clientY)}
            onMouseUp={stopImageSelection}
            onMouseLeave={stopImageSelection}
          >
            <img ref={filterImageRef} src={source} alt={doc.name} className="max-h-[520px] w-auto object-contain select-none" draggable={false} />
            {imageSelectionRect ? (
              <div
                className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none"
                style={{
                  left: `${imageSelectionRect.x}px`,
                  top: `${imageSelectionRect.y}px`,
                  width: `${imageSelectionRect.width}px`,
                  height: `${imageSelectionRect.height}px`,
                }}
              />
            ) : null}
          </div>
        </div>
      );
    }

    if (mime === "text/plain") {
      return (
        <div className="border rounded-md p-3 bg-muted/10 max-h-[520px] overflow-auto">
          <pre className="text-xs whitespace-pre-wrap">
            {doc.extractedText || doc.summary || "No readable text available in this file."}
          </pre>
        </div>
      );
    }

    return (
      <div className="text-xs text-muted-foreground border rounded-md p-3">
        Viewer fallback: unsupported preview type ({mime || "unknown"}). Use exports below.
      </div>
    );
  };

  const hasSelectionForExport = Boolean(selectedSlice.trim() || selectedImageSliceDataUrl);

  useEffect(() => {
    setSelectedImageSliceDataUrl("");
    setImageSelectionRect(null);
    setIsDraggingImageSelection(false);
    imageSelectionStartRef.current = null;
  }, [filterDocId]);

  useEffect(() => {
    let cancelled = false;
    const loadPreview = async () => {
      if (!selected) {
        setPreviewDataUrl("");
        return;
      }

      setIsPreviewLoading(true);
      try {
        if (selected.sourceDataUrl && (selected.sourceMime || selected.type || "").startsWith("image/")) {
          if (!cancelled) setPreviewDataUrl(selected.sourceDataUrl);
          return;
        }

        if (selected.sourceDataUrl && (selected.sourceMime || selected.type) === "application/pdf") {
          let pdfjs: { getDocument: (params: { data: ArrayBuffer }) => { promise: Promise<unknown> }; GlobalWorkerOptions?: { workerSrc?: string } };
          try {
            pdfjs = (await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs")) as typeof pdfjs;
          } catch {
            pdfjs = (await import(/* @vite-ignore */ "pdfjs-dist")) as typeof pdfjs;
          }
          try {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
          } catch {
            // Worker path fallback.
          }
          const bytes = await (await fetch(selected.sourceDataUrl)).arrayBuffer();
          const task = pdfjs.getDocument({ data: bytes });
          const pdf = (await task.promise) as {
            getPage: (page: number) => Promise<{
              getViewport: (opts: { scale: number }) => { width: number; height: number };
              render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
            }>;
          };
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 0.8 });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("No canvas context");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (!cancelled) setPreviewDataUrl(canvas.toDataURL("image/png"));
          return;
        }

        const fallback = createTextPreviewImage(selected.name, (selected.extractedText || selected.summary || "").slice(0, 1200));
        if (!cancelled) setPreviewDataUrl(fallback);
      } catch {
        const fallback = createTextPreviewImage(selected.name, (selected.extractedText || selected.summary || "").slice(0, 1200));
        if (!cancelled) setPreviewDataUrl(fallback);
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    };

    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) {
      setForensicMetadataFlags([]);
      setForensicHash("");
      setForensicHotspots([]);
      setForensicCloneSignals(0);
      setForensicAuthenticity(0);
      setForensicBreakdown([]);
      setForensicIocs({ emails: [], ips: [], domains: [], filePaths: [] });
      return;
    }
    let cancelled = false;
    const runForensics = async () => {
      setForensicLoading(true);
      try {
        const [flags, bytes] = await Promise.all([
          getDocumentMetadataFlags(selected),
          selected.sourceDataUrl ? readDataUrlBytes(selected.sourceDataUrl) : Promise.resolve(new Uint8Array()),
        ]);
        if (cancelled) return;
        const hash = bytes.length ? await sha256Hex(bytes) : "";
        if (cancelled) return;
        const iocs = extractIocs((selected.extractedText || selected.summary || "").trim());
        const auth = computeAuthenticity({
          tamperSignal: Math.min(100, forensicHotspots.length * 4 + forensicCloneSignals * 6),
          cloneSignals: forensicCloneSignals,
          metadataFlags: flags,
          editCount: 0,
        });
        setForensicMetadataFlags(flags);
        setForensicHash(hash);
        setForensicIocs(iocs);
        setForensicAuthenticity(auth.score);
        setForensicBreakdown(auth.breakdown);
      } finally {
        if (!cancelled) setForensicLoading(false);
      }
    };
    void runForensics();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, forensicHotspots.length, forensicCloneSignals]);

  useEffect(() => {
    const image = previewForensicRef.current;
    if (!image || !previewDataUrl) return;
    const run = () => {
      const canvas = document.createElement("canvas");
      const w = image.naturalWidth || image.width;
      const h = image.naturalHeight || image.height;
      if (!w || !h) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, w, h);
      const scan = analyzeCanvasForensics(canvas);
      setForensicHotspots(scan.hotspots);
      setForensicCloneSignals(scan.cloneSignals);
    };
    if (image.complete) run();
    else image.onload = run;
  }, [previewDataUrl, selected?.id]);

  useEffect(() => {
    const onSectionAction = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isSectionActionDetail(detail) || detail.tab !== "documents" || detail.mode !== mode) return;

      if (detail.action === "OCR ingestion" || detail.action === "Control mapping" || detail.action === "Source ingestion") {
        inputRef.current?.click();
      }

      if (detail.action === "Clause extraction" || detail.action === "Metadata checks") {
        const first = allDocsForMode[0];
        if (first) openDocument(first.id);
      }

      if (detail.action === "Redline compare" || detail.action === "Exception review" || detail.action === "Citation chain") {
        const target = allDocsForMode.find((d) => d.id === selectedId) ?? allDocsForMode[0];
        if (target) {
          openDocument(target.id);
          void searchSourcesForDoc(target);
        }
      }

      if (detail.action === "Risk annotations" || detail.action === "Retention tagging" || detail.action === "Manipulation flags") {
        setStatusFilter("risky");
      }
    };

    window.addEventListener(SECTION_ACTION_EVENT, onSectionAction);
    return () => window.removeEventListener(SECTION_ACTION_EVENT, onSectionAction);
  }, [allDocsForMode, mode, selectedId]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Total Documents" value={stats.total} />
        <Stat title="New" value={stats.newDocs} />
        <Stat title="Viewed" value={stats.viewed} />
        <Stat title="Risky Docs" value={stats.risky} />
      </div>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Document Intake</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                inputRef.current?.click();
              }}
              disabled={isAnalyzing}
            >
              <Upload className="h-4 w-4 mr-1" />
              {isAnalyzing
                ? `Scanning ${analysisProgress.done}/${analysisProgress.total}...`
                : "Upload & Analyze"}
            </Button>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents..." className="max-w-xs" />
            <Button size="sm" variant={statusFilter === "all" ? "default" : "outline"} onClick={() => setStatusFilter("all")}>All</Button>
            <Button size="sm" variant={statusFilter === "viewed" ? "default" : "outline"} onClick={() => setStatusFilter("viewed")}>Viewed</Button>
            <Button size="sm" variant={statusFilter === "risky" ? "default" : "outline"} onClick={() => setStatusFilter("risky")}>Risky</Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.zip,application/zip,application/x-zip-compressed"
            onChange={(e) => {
              void handleUpload(e.target.files);
              e.currentTarget.value = "";
            }}
          />
          <p className="text-xs text-muted-foreground">Supports TXT, PDF, PNG, JPG, WEBP, ZIP. ZIP files are scanned with strict pre-extraction cyber checks.</p>
        </CardContent>
      </Card>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Document Registry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {allDocsForMode.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents in registry yet.</p>
          ) : (
            allDocsForMode.map((doc) => (
              <div key={doc.id} className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <RiskLogo doc={doc} />
                      <div className="font-medium">{doc.name}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatSize(doc.size)} | {toRelative(doc.uploadedAt)} | score {doc.trustScore} | risks {doc.risks} | track {doc.track}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {processingDocIds.includes(doc.id) ? (
                      <Badge variant="outline">scanning...</Badge>
                    ) : null}
                    <Badge variant={getStatusLabel(doc) === "viewed" ? "secondary" : "outline"}>
                      {getStatusLabel(doc)}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openDocument(doc.id)}
                      disabled={processingDocIds.includes(doc.id)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void runRiskAnalysis(doc)}
                      disabled={processingDocIds.includes(doc.id) || (isRunningRiskAnalysis && activeRiskScanDocId === doc.id)}
                    >
                      {isRunningRiskAnalysis && activeRiskScanDocId === doc.id ? "Scanning..." : "Risk Analysis"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDownloadMenuDocId((current) => (current === doc.id ? null : doc.id))}>
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        sync((current) => ({
                          ...current,
                          documents: current.documents.filter((x) => x.id !== doc.id),
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {downloadMenuDocId === doc.id ? (
                  <div className="rounded-md border p-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground mr-1">
                      Recommended: {getRecommendedDownload(doc).toUpperCase()}
                    </span>
                    <Button size="sm" variant={getRecommendedDownload(doc) === "txt" ? "default" : "outline"} onClick={() => downloadTxt(doc)}>
                      TXT
                    </Button>
                    <Button size="sm" variant={getRecommendedDownload(doc) === "zip" ? "default" : "outline"} onClick={() => downloadZip(doc)}>
                      ZIP
                    </Button>
                    <Button size="sm" variant={getRecommendedDownload(doc) === "pdf" ? "default" : "outline"} onClick={() => void downloadPdf(doc)}>
                      PDF
                    </Button>
                    <Button size="sm" variant={getRecommendedDownload(doc) === "img" ? "default" : "outline"} onClick={() => downloadImg(doc)}>
                      IMG
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" showClose={false} className="w-[92vw] sm:max-w-4xl overflow-y-auto">
          {selected ? (
            <div className="space-y-4">
              <div className="sticky top-0 z-10 bg-background pb-2">
                <div className="flex items-start justify-between gap-3">
                  <SheetHeader className="space-y-1">
                    <SheetTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      {selected.name}
                    </SheetTitle>
                    <SheetDescription>Document actions and support links</SheetDescription>
                  </SheetHeader>
                  <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>
                    Close
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Document Preview</div>
                <div className="relative w-64 aspect-square rounded-md border overflow-hidden bg-muted/20 flex items-center justify-center">
                  {isPreviewLoading ? (
                    <div className="text-xs text-muted-foreground">Rendering preview...</div>
                  ) : previewDataUrl ? (
                    <img ref={previewForensicRef} src={previewDataUrl} alt={`${selected.name} preview`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-xs text-muted-foreground">No preview available</div>
                  )}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">{selected.summary}</div>
              <div className="text-xs text-muted-foreground">
                method: {selected.extractionMethod || "n/a"} | pages: {selected.pagesAnalyzed ?? 0} | confidence: {selected.extractionConfidence ?? 0}%
              </div>
              {false ? (
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium flex items-center gap-2"><Fingerprint className="h-4 w-4" />Open Forensic Lab</div>
                  <Badge variant={forensicAuthenticity < 55 ? "destructive" : forensicAuthenticity < 75 ? "outline" : "secondary"}>
                    authenticity {forensicAuthenticity}/100
                  </Badge>
                </div>
                {forensicLoading ? <div className="text-xs text-muted-foreground">Running forensic checks...</div> : null}
                {forensicHash ? (
                  <div className="text-xs">
                    <div className="font-medium">SHA-256</div>
                    <div className="break-all text-muted-foreground">{forensicHash}</div>
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded border p-2 text-xs">
                    <div className="font-medium flex items-center gap-1"><ScanSearch className="h-3.5 w-3.5" />Metadata Fingerprint</div>
                    <div className="max-h-24 overflow-auto space-y-1 mt-1">
                      {forensicMetadataFlags.slice(0, 8).map((flag, idx) => (
                        <div key={`${flag.label}-${idx}`} className="flex items-center justify-between gap-2">
                          <span>{flag.label}</span>
                          <Badge variant={flag.severity === "critical" ? "destructive" : flag.severity === "warning" ? "outline" : "secondary"}>
                            {flag.value}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded border p-2 text-xs">
                    <div className="font-medium">Tamper + Clone Signals</div>
                    <div className="text-muted-foreground mt-1">Hotspots: {forensicHotspots.length}</div>
                    <div className="text-muted-foreground">Clone matches: {forensicCloneSignals}</div>
                    {forensicBreakdown.slice(0, 2).map((part) => (
                      <div key={part.label} className="text-muted-foreground">{part.label}: {part.weight}%</div>
                    ))}
                  </div>
                </div>
                <div className="rounded border p-2 text-xs">
                  <div className="font-medium">IOC Extractor</div>
                  <div className="text-muted-foreground mt-1">
                    emails {forensicIocs.emails.length} | ips {forensicIocs.ips.length} | domains {forensicIocs.domains.length} | paths {forensicIocs.filePaths.length}
                  </div>
                  <div className="max-h-20 overflow-auto mt-1 space-y-1 text-muted-foreground">
                    {[...forensicIocs.emails, ...forensicIocs.ips, ...forensicIocs.domains, ...forensicIocs.filePaths].slice(0, 10).map((ioc, idx) => (
                      <div key={`${ioc}-${idx}`} className="break-all">{ioc}</div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void searchSourcesForDoc(selected)}>Rescan Links</Button>
                  <Button size="sm" variant="outline" onClick={() => void runRiskAnalysis(selected)}>Run Deep Risk</Button>
                  <Button size="sm" onClick={() => void exportForensicEvidence(selected)}><FileStack className="h-4 w-4 mr-1" />Export Evidence</Button>
                </div>
              </div>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void reExtractDoc(selected)} disabled={isReextracting}>
                  {isReextracting ? "Re-running OCR..." : "Re-run OCR"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void searchSourcesForDoc(selected)} disabled={isSearchingSources}>
                  {isSearchingSources ? "Scanning..." : "External Support"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFilterDocId(selected.id);
                    setSelectedSlice("");
                  }}
                >
                  Filter
                </Button>
              </div>
              <Textarea value={getDisplayExtractedText(selected)} readOnly rows={12} className="font-mono text-xs" />
              <div className="space-y-2">
                <div className="text-sm font-medium">Supporting Sources</div>
                {sourceHits.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No links found yet. Use "External Support" to scan document text for links.</div>
                ) : (
                  sourceHits.map((hit, i) => (
                    <div key={`${hit.url}-${i}`} className="rounded-md border p-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <div
                          className={`h-6 w-1 rounded ${
                            hit.safety === "safe" ? "bg-green-500" : hit.safety === "caution" ? "bg-amber-500" : "bg-red-500"
                          }`}
                        />
                        <div className="text-sm font-medium break-all">{hit.label}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {hit.safety.toUpperCase()} | {hit.reason}
                      </div>
                      <div className="text-xs break-all">{hit.url}</div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => window.open(hit.url, "_blank", "noopener,noreferrer")}>
                          Open Source
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(hit.url);
                            } catch {
                              // ignore clipboard errors
                            }
                          }}
                        >
                          Copy Link
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(isAnalyzing && analysisProgress.total > 0)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Uploading & Strict Scanning</DialogTitle>
            <DialogDescription>
              Uploading files and running high-standard cyber checks. Please wait until processing finishes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-center py-2">
              <div className="relative h-20 w-20">
                <div className="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping" />
                <div className="absolute inset-2 rounded-full bg-cyan-400/25 animate-pulse" />
                <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400 animate-bounce" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.max(
                      6,
                      Math.min(100, Math.round((analysisProgress.done / Math.max(1, analysisProgress.total)) * 100))
                    )}%`,
                  }}
                />
              </div>
              <div className="text-sm text-muted-foreground text-center">
                Uploading... {analysisProgress.done}/{analysisProgress.total} file(s) complete
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(isReextracting && activeOcrDocId)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Running OCR Extraction</DialogTitle>
            <DialogDescription>
              {allDocsForMode.find((d) => d.id === activeOcrDocId)?.name || "Document"} is being reprocessed with OCR.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/2 bg-primary animate-pulse" />
            </div>
            <div className="text-sm text-muted-foreground">
              Please wait. Updated extraction results will appear automatically when OCR is complete.
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(isRunningRiskAnalysis && activeRiskScanDocId)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Running Strict Risk Scan</DialogTitle>
            <DialogDescription>
              {allDocsForMode.find((d) => d.id === activeRiskScanDocId)?.name || "Document"} is being scanned with full cyber checks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/2 bg-primary animate-pulse" />
            </div>
            <div className="text-sm text-muted-foreground">
              Please wait. The report will open automatically when all strict scan stages are complete.
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(riskDoc)} onOpenChange={(open) => !open && setRiskDocId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader className="space-y-2">
            <DialogTitle>Risk Analysis Report</DialogTitle>
            <DialogDescription>{riskDoc?.name || "Document"}</DialogDescription>
          </DialogHeader>
          {riskDoc ? (
            <div className="space-y-3 min-h-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    getRiskTier(riskDoc) === "extreme" || getRiskTier(riskDoc) === "high"
                      ? "destructive"
                      : getRiskTier(riskDoc) === "medium"
                        ? "outline"
                        : "secondary"
                  }
                >
                  {riskLabel(riskDoc)}
                </Badge>
                <Badge variant="outline">Type: {riskDoc.type || "unknown"}</Badge>
                <Badge variant="outline">Status: {getStatusLabel(riskDoc)}</Badge>
              </div>
              <div className="rounded-md border p-3 space-y-2 text-sm max-h-[62vh] overflow-y-auto pr-2 break-words">
                {riskAnalysisLines.map((line, idx) => (
                  <p key={idx} className="leading-relaxed break-words">{line}</p>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(filterDoc)} onOpenChange={(open) => !open && setFilterDocId(null)}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Document Filter Viewer</DialogTitle>
            <DialogDescription>
              Original document viewer + selected text export workflow.
            </DialogDescription>
          </DialogHeader>
          {filterDoc ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="text-sm font-medium">Original Document</div>
                <div className="max-h-[60vh] overflow-auto overscroll-contain" onWheel={(e) => e.stopPropagation()}>
                  {renderOriginalDocumentViewer(filterDoc)}
                </div>
                {(filterDoc.sourceMime || filterDoc.type || "").toLowerCase().startsWith("image/") ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void selectImageRegion()}
                      disabled={!imageSelectionRect || imageSelectionRect.width < 4 || imageSelectionRect.height < 4 || isExtractingImageRegion}
                    >
                      {isExtractingImageRegion ? "Selecting..." : "Select Region"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setImageSelectionRect(null);
                        setSelectedImageSliceDataUrl("");
                      }}
                      disabled={!imageSelectionRect && !selectedImageSliceDataUrl}
                    >
                      Clear Region
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedImageSliceDataUrl
                  ? "Selection: image region selected"
                  : `Selection length: ${selectedSlice.length} character(s)`}
              </div>
              <div className="text-xs text-muted-foreground">
                Select from main document, copy it, then use "Use Copied Text" or paste below.
              </div>
              <Textarea
                value={selectionDraft}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedImageSliceDataUrl("");
                  setSelectionDraft(value);
                  setSelectedSlice(value);
                }}
                onPaste={(e) => void handleSelectionPaste(e)}
                onDrop={(e) => void handleSelectionDrop(e)}
                rows={4}
                className="font-mono text-xs"
                placeholder="Paste selected text here (Ctrl+V). This will be used for copy/export actions."
              />
              <div className="rounded-md border p-2 text-xs text-muted-foreground max-h-24 overflow-auto">
                {selectedImageSliceDataUrl
                  ? "Cropped image region is ready. Use Export IMG/PDF to download it, or Export TXT to OCR this region."
                  : selectedSlice
                    ? selectedSlice
                    : "No selection yet. Copy from document and paste/use copied text."}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void copySelectedSlice()} disabled={!selectedSlice.trim()}>
                  Copy Selection
                </Button>
                <Button size="sm" variant="outline" onClick={() => void loadCopiedTextAsSelection()}>
                  Use Copied Text
                </Button>
                <Button size="sm" variant="outline" onClick={() => void exportSliceTxt()} disabled={!hasSelectionForExport}>
                  Export TXT
                </Button>
                <Button size="sm" variant="outline" onClick={() => void exportSlicePdf()} disabled={!hasSelectionForExport}>
                  Export PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => void exportSliceImg()} disabled={!hasSelectionForExport}>
                  Export IMG
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Stat = ({ title, value }: { title: string; value: number }) => (
  <Card className="dashboard-card-effect">
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
    </CardContent>
  </Card>
);

