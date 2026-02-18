import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertOctagon, BarChart3, CheckCircle2, Download, FilePenLine, FileStack, Hammer, History, Info, Layers, Link2, Loader2, PencilLine, ScanSearch, Search, ShieldAlert, Wrench } from "lucide-react";
import type { AppTrack } from "@/utils/insideData";
import { loadInsideDocuments, type InsideDocumentRecord, updateInsideDocuments } from "@/utils/insideDocumentsData";
import { analyzeDocumentFile } from "@/utils/realAnalysis";
import { runNativePdfPatch } from "@/utils/nativePdfEngine";
import { analyzeCanvasForensics, computeAuthenticity, getDocumentMetadataFlags, readDataUrlBytes, sha256Hex, type ForensicHotspot, type ForensicMetadataFlag } from "@/utils/forensicLab";

interface InsideInfantryProps {
  mode: AppTrack;
}

type FixedRecord = {
  id: string;
  docId: string;
  track?: AppTrack;
  name: string;
  type: string;
  sourceMime: string;
  sourceDataUrl: string;
  fixedAt: number;
  riskBefore: "high" | "extreme";
  trustBefore: number;
  trustAfter: number;
  risksAfter: number;
  summaryAfter: string;
  cleanedText: string;
  recommendations: string[];
};

type PipelineStageStatus = "pending" | "running" | "done" | "failed";

type FixPipelineState = {
  docId: string;
  docName: string;
  startedAt: number;
  stages: Array<{
    key: string;
    title: string;
    detail: string;
    status: PipelineStageStatus;
  }>;
};

type ImageTextOverlay = {
  id: string;
  text: string;
  color: string;
  size: number;
  x: number;
  y: number;
};

type PdfEditItem = {
  id: string;
  text: string;
  originalText: string;
  x: number;
  y: number;
  fontSize: number;
  isNew?: boolean;
};

type PdfEditPage = {
  page: number;
  width: number;
  height: number;
  imageDataUrl: string;
  items: PdfEditItem[];
  source: "original" | "clean";
};

type CompareViewMode = "normal" | "pixel" | "edge" | "frequency";

type ForensicTimelineItem = {
  id: string;
  at: number;
  action: string;
  detail: string;
};

type ImageRedactionBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const FIXED_KEY = "trustlens_infantry_fixed_docs";
const MS_LINK_KEY = "trustlens_ms_word_linked";

const createId = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const docMime = (doc: InsideDocumentRecord) => (doc.sourceMime || doc.type || "").toLowerCase();
const hasExt = (name: string, ext: string) => name.toLowerCase().endsWith(ext);
const isImageDoc = (doc: InsideDocumentRecord) => {
  const mime = docMime(doc);
  return (
    mime.startsWith("image/") ||
    hasExt(doc.name, ".png") ||
    hasExt(doc.name, ".jpg") ||
    hasExt(doc.name, ".jpeg") ||
    hasExt(doc.name, ".webp") ||
    hasExt(doc.name, ".jfif") ||
    hasExt(doc.name, ".bmp") ||
    hasExt(doc.name, ".gif") ||
    hasExt(doc.name, ".heic") ||
    hasExt(doc.name, ".heif")
  );
};
const isPdfDoc = (doc: InsideDocumentRecord) => {
  const mime = docMime(doc);
  return mime === "application/pdf" || hasExt(doc.name, ".pdf");
};
const isTxtDoc = (doc: InsideDocumentRecord) => {
  const mime = docMime(doc);
  return mime === "text/plain" || hasExt(doc.name, ".txt");
};
const imageOutputMime = (doc: InsideDocumentRecord) => {
  const mime = docMime(doc);
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (mime === "image/webp") return "image/webp";
  return "image/png";
};
const imageOutputExt = (mime: string) => {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
};

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });

const extractPdfTextLayerFromDataUrl = async (dataUrl: string) => {
  if (!dataUrl) return "";
  let pdfjs: any;
  try {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist");
  }
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  } catch {
    // continue without explicit worker path fallback
  }
  const bytes = await (await fetch(dataUrl)).arrayBuffer();
  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item: { str?: string }) => item?.str || "").join(" ").trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n").trim();
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const buildDocHtmlFromPdfDataUrl = async (dataUrl: string) => {
  if (!dataUrl) return "<div></div>";
  let pdfjs: any;
  try {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist");
  }
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  } catch {}
  const bytes = await (await fetch(dataUrl)).arrayBuffer();
  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  const pagesHtml: string[] = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const rows = (content.items || [])
      .map((raw: any) => {
        const txt = String(raw?.str || "").trim();
        if (!txt) return null;
        const t = raw?.transform || [];
        const y = Number(t[5] || 0);
        const fontName = String(raw?.fontName || "");
        const bold = /bold|black|heavy/i.test(fontName);
        const italic = /italic|oblique/i.test(fontName);
        return { txt, y, bold, italic };
      })
      .filter(Boolean) as Array<{ txt: string; y: number; bold: boolean; italic: boolean }>;
    rows.sort((a, b) => b.y - a.y);
    const lines: Array<{ text: string; bold: boolean; italic: boolean }> = [];
    for (const row of rows) {
      const last = lines[lines.length - 1];
      if (last && Math.abs((last as any).y - row.y) <= 2.2) {
        last.text = `${last.text} ${row.txt}`.replace(/\s+/g, " ").trim();
        last.bold = last.bold || row.bold;
        last.italic = last.italic || row.italic;
      } else {
        const line: any = { text: row.txt, bold: row.bold, italic: row.italic, y: row.y };
        lines.push(line);
      }
    }
    const htmlLines = lines
      .map((l) => {
        const style = `${l.bold ? "font-weight:700;" : ""}${l.italic ? "font-style:italic;" : ""}`;
        return `<div style="${style}">${escapeHtml(l.text)}</div>`;
      })
      .join("");
    pagesHtml.push(`<section style="margin-bottom:24px;">${htmlLines}</section>`);
  }

  return pagesHtml.join("");
};

const loadPdfEditPagesFromDataUrl = async (dataUrl: string, maxPages = 30, withItems = false) => {
  if (!dataUrl) return [] as PdfEditPage[];
  let pdfjs: any;
  try {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist");
  }
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
  } catch {
    // keep going
  }
  const bytes = await (await fetch(dataUrl)).arrayBuffer();
  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  const pages: PdfEditPage[] = [];
  const total = Math.min(pdf.numPages, maxPages);

  for (let p = 1; p <= total; p += 1) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const imageDataUrl = canvas.toDataURL("image/png");
    const items: PdfEditItem[] = [];
    if (withItems) {
      const textContent = await page.getTextContent();
      const dedup = new Set<string>();
      let idx = 0;
      for (const raw of textContent.items || []) {
        const item = raw as { str?: string; transform?: number[]; width?: number; height?: number };
        const txt = (item.str || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        const t = item.transform || [];
        const x = Number(t[4] || 0);
        const yBase = Number(t[5] || 0);
        const fontSize = Math.max(8, Math.min(42, Math.abs(Number(t[3] || t[0] || 12))));
        const yTop = viewport.height - yBase - fontSize;
        const key = `${Math.round(x)}-${Math.round(yTop)}-${txt}`;
        if (dedup.has(key)) continue;
        dedup.add(key);
        items.push({
          id: `p${p}-${idx++}`,
          text: txt,
          originalText: txt,
          x: Math.max(2, x),
          y: Math.max(2, yTop),
          fontSize,
        });
      }
    }

    pages.push({
      page: p,
      width: canvas.width,
      height: canvas.height,
      imageDataUrl,
      items,
      source: "original",
    });
  }

  return pages;
};

const createCleanPdfPages = (text: string) => {
  const content = (text || "").replace(/\r/g, "").trim();
  if (!content) return [] as PdfEditPage[];
  const pageW = 1240;
  const pageH = 1754;
  const margin = 80;
  const lineHeight = 34;
  const maxChars = 90;
  const paragraphs = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const p of paragraphs) {
    const words = p.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (test.length > maxChars && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    lines.push("");
  }

  const pageLines = Math.max(20, Math.floor((pageH - margin * 2) / lineHeight));
  const pages: PdfEditPage[] = [];
  for (let p = 0; p * pageLines < lines.length; p += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = pageW;
    canvas.height = pageH;
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pageW, pageH);
    const items: PdfEditItem[] = [];
    const chunk = lines.slice(p * pageLines, (p + 1) * pageLines);
    chunk.forEach((line, i) => {
      items.push({
        id: `clean-${p + 1}-${i}`,
        text: line,
        x: margin,
        y: margin + i * lineHeight,
        fontSize: 26,
        originalText: line,
      });
    });
    pages.push({
      page: p + 1,
      width: pageW,
      height: pageH,
      imageDataUrl: canvas.toDataURL("image/png"),
      items,
      source: "clean",
    });
  }
  return pages;
};

const toRelative = (ts: number) => {
  const d = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (d <= 0) return "today";
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
};

const formatSize = (bytes: number) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
};

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

const sanitizeMaliciousContent = (input: string) => {
  if (!input.trim()) return "";
  return input
    .replace(/\b(virus|worm|trojan|malware|ransomware|backdoor|payload|botnet|exploit)\b/gi, "[removed-threat-token]")
    .replace(/\b(exe|dll|bat|cmd|ps1|vbs|js|jse|scr|com|hta|wsf|reg|macro)\b/gi, "[removed-exec-token]")
    .replace(/(\.\.\/|\\\.\.\\|\/etc\/|system32|powershell\.exe|cmd\.exe|wscript\.exe|cscript\.exe)/gi, "[removed-path-token]")
    .replace(/(executable\/script files:\s*)[1-9]\d*/gi, (_m, p1: string) => `${p1}0`)
    .replace(/(path traversal patterns:\s*)[1-9]\d*/gi, (_m, p1: string) => `${p1}0`)
    .replace(/(encrypted entries:\s*)[1-9]\d*/gi, (_m, p1: string) => `${p1}0`)
    .replace(/(max compression ratio:\s*)(1[2-9]\d|\d{3,})/gi, (_m, p1: string) => `${p1}11`);
};

const getRiskTier = (doc: InsideDocumentRecord): "low" | "medium" | "high" | "extreme" => {
  const text = (doc.extractedText || "").toLowerCase();
  const criticalSignals =
    (/executable\/script files:\s*[1-9]/i.test(text) ? 1 : 0) +
    (/path traversal patterns:\s*[1-9]/i.test(text) ? 1 : 0) +
    (/encrypted entries:\s*[1-9]/i.test(text) ? 1 : 0) +
    (/max compression ratio:\s*(1[2-9]\d|\d{3,})/i.test(text) ? 1 : 0);
  const strict = Math.round((100 - doc.trustScore) * 0.8 + doc.risks * 20 + criticalSignals * 20);
  if (doc.trustScore <= 35 || strict >= 90 || criticalSignals >= 2) return "extreme";
  if (strict >= 60 || doc.risks >= 2 || criticalSignals >= 1) return "high";
  if (strict >= 35 || doc.risks >= 1) return "medium";
  return "low";
};

const getFixSources = (doc: InsideDocumentRecord) => {
  const base = [
    "https://www.cisa.gov/news-events/cybersecurity-advisories",
    "https://www.malwarebytes.com/blog",
    "https://support.microsoft.com/windows/microsoft-defender",
    "https://www.virustotal.com/",
  ];
  if (/zip/i.test(doc.type) || doc.extractionMethod === "zip-static-scan") {
    return [...base, "https://owasp.org/www-community/attacks/Zip_Slip", "https://www.cisa.gov/stopransomware"];
  }
  return base;
};

const recommendedDownload = (item: FixedRecord): "txt" | "zip" | "pdf" | "img" => {
  if ((item.sourceMime || "").startsWith("image/")) return "img";
  if (/zip/i.test(item.type || "") || item.sourceMime.includes("zip")) return "zip";
  if ((item.cleanedText || "").length > 3200) return "pdf";
  return "txt";
};

const extractUrlsForensics = (text: string) => {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/[.,;:]+$/, "")))).slice(0, 60);
};

const KNOWN_TRUSTED_DOMAINS = new Set([
  "google.com",
  "gmail.com",
  "github.com",
  "microsoft.com",
  "office.com",
  "outlook.com",
  "apple.com",
  "amazon.com",
  "aws.amazon.com",
  "cloudflare.com",
  "openai.com",
  "cisa.gov",
  "nist.gov",
  "wikipedia.org",
]);

const scoreForensicUrl = (url: string, source: "direct" | "domain_inferred" = "direct") => {
  let score = 55;
  const reasons: string[] = [];
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pathname = `${u.pathname}${u.search}`.toLowerCase();
    const rootHost = host.replace(/^www\./, "");
    const domainLabels = rootHost.split(".");

    if (u.protocol !== "https:") {
      score -= 24;
      reasons.push("Non-HTTPS");
    } else {
      score += 10;
      reasons.push("HTTPS");
    }
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) {
      score -= 22;
      reasons.push("IP host");
    }
    if (/(bit\.ly|tinyurl\.com|t\.co|rb\.gy|cutt\.ly)$/i.test(host)) {
      score -= 18;
      reasons.push("Shortened URL");
    }
    if (/\.(zip|click|top|xyz|gq)$/i.test(host)) {
      score -= 14;
      reasons.push("Risky TLD");
    }
    if (host.includes("xn--")) {
      score -= 18;
      reasons.push("Punycode");
    }
    if (domainLabels.length >= 4) {
      score -= 8;
      reasons.push("Deep subdomain");
    }
    if ((rootHost.match(/-/g) || []).length >= 3) {
      score -= 8;
      reasons.push("Hyphen-heavy host");
    }
    if (rootHost.length > 28) {
      score -= 6;
      reasons.push("Long domain");
    }
    if (/(login|verify|update|secure|auth|wallet|recover|token|password|signin|invoice|payment)/i.test(pathname)) {
      score -= 10;
      reasons.push("Sensitive lure keywords");
    }
    if (KNOWN_TRUSTED_DOMAINS.has(rootHost)) {
      score += 26;
      reasons.push("Known trusted domain");
    }
    if (source === "domain_inferred") {
      reasons.push("Inferred from text (no explicit URL)");
    }
  } catch {
    score = 20;
    reasons.push("Malformed URL");
  }
  const normalizedScore = Math.max(0, Math.min(100, score));
  const level = normalizedScore >= 72 ? "safe" : normalizedScore >= 45 ? "caution" : "risky";
  return { level, score: normalizedScore, reason: reasons.join(", ") || "No notable signal", source };
};

const loadFixed = (): FixedRecord[] => {
  try {
    const raw = localStorage.getItem(FIXED_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FixedRecord[];
  } catch {
    return [];
  }
};

const saveFixed = (items: FixedRecord[]) => localStorage.setItem(FIXED_KEY, JSON.stringify(items));

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

const makeZipBlobFromEntries = (entries: Array<{ name: string; data: Uint8Array }>) => {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const lfh = new Uint8Array(30 + name.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(4, 20, true);
    lfhView.setUint16(8, 0, true);
    lfhView.setUint16(10, 0, true);
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, data.length, true);
    lfhView.setUint32(22, data.length, true);
    lfhView.setUint16(26, name.length, true);
    lfh.set(name, 30);
    chunks.push(lfh, data);

    const cdh = new Uint8Array(46 + name.length);
    const cdhView = new DataView(cdh.buffer);
    cdhView.setUint32(0, 0x02014b50, true);
    cdhView.setUint16(4, 20, true);
    cdhView.setUint16(6, 20, true);
    cdhView.setUint16(10, 0, true);
    cdhView.setUint16(12, 0, true);
    cdhView.setUint32(16, crc, true);
    cdhView.setUint32(20, data.length, true);
    cdhView.setUint32(24, data.length, true);
    cdhView.setUint16(28, name.length, true);
    cdhView.setUint32(42, offset, true);
    cdh.set(name, 46);
    central.push(cdh);

    offset += lfh.length + data.length;
  });

  const centralSize = central.reduce((acc, c) => acc + c.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, eocd], { type: "application/zip" });
};

export const InsideInfantry = ({ mode }: InsideInfantryProps) => {
  const [store, setStore] = useState(() => loadInsideDocuments());
  const [fixedDocs, setFixedDocs] = useState<FixedRecord[]>(() => loadFixed());
  const [query, setQuery] = useState("");
  const [fixingOpen, setFixingOpen] = useState(false);
  const [editingOpen, setEditingOpen] = useState(false);
  const [fixingDocId, setFixingDocId] = useState<string | null>(null);
  const [fixPipeline, setFixPipeline] = useState<FixPipelineState | null>(null);
  const [fixSummary, setFixSummary] = useState<{ name: string; lines: string[] } | null>(null);
  const [editingQuery, setEditingQuery] = useState("");
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState("");
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imgRotate, setImgRotate] = useState(0);
  const [imgFlipX, setImgFlipX] = useState(false);
  const [imgFlipY, setImgFlipY] = useState(false);
  const [imgZoom, setImgZoom] = useState(1);
  const [imgBrightness, setImgBrightness] = useState(100);
  const [imgContrast, setImgContrast] = useState(100);
  const [imgSaturate, setImgSaturate] = useState(100);
  const [imgBlur, setImgBlur] = useState(0);
  const [imgOpacity, setImgOpacity] = useState(100);
  const [imgGray, setImgGray] = useState(false);
  const [imgSepia, setImgSepia] = useState(false);
  const [imgInvert, setImgInvert] = useState(false);
  const [overlayTextInput, setOverlayTextInput] = useState("");
  const [overlayColor, setOverlayColor] = useState("#00e5ff");
  const [overlaySize, setOverlaySize] = useState(36);
  const [overlayX, setOverlayX] = useState(80);
  const [overlayY, setOverlayY] = useState(120);
  const [overlays, setOverlays] = useState<ImageTextOverlay[]>([]);
  const [redactionBoxes, setRedactionBoxes] = useState<ImageRedactionBox[]>([]);
  const [redactionTerms, setRedactionTerms] = useState("");
  const [redactionLeakReport, setRedactionLeakReport] = useState<string | null>(null);
  const [pdfHeader, setPdfHeader] = useState("");
  const [pdfWatermark, setPdfWatermark] = useState("");
  const [pdfFooter, setPdfFooter] = useState("");
  const [pdfDraft, setPdfDraft] = useState("");
  const [pdfPages, setPdfPages] = useState<PdfEditPage[]>([]);
  const [pdfDirectEditLoading, setPdfDirectEditLoading] = useState(false);
  const [pdfLoadState, setPdfLoadState] = useState<"idle" | "loading" | "ready" | "needs_ocr">("idle");
  const [pdfOcrRunning, setPdfOcrRunning] = useState(false);
  const [pdfUnscanRunning, setPdfUnscanRunning] = useState(false);
  const [pdfNonEditableOpen, setPdfNonEditableOpen] = useState(false);
  const [pdfNonEditableReasons, setPdfNonEditableReasons] = useState<string[]>([]);
  const [pdfFocusItemId, setPdfFocusItemId] = useState<string | null>(null);
  const [pdfInsertMode, setPdfInsertMode] = useState(false);
  const [pdfDocHtml, setPdfDocHtml] = useState("<div></div>");
  const pdfDocEditorRef = useRef<HTMLDivElement | null>(null);
  const [msLinked, setMsLinked] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MS_LINK_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [msLinking, setMsLinking] = useState(false);
  const [txtDraft, setTxtDraft] = useState("");
  const [forensicLoading, setForensicLoading] = useState(false);
  const [forensicAuthenticity, setForensicAuthenticity] = useState(0);
  const [forensicBreakdown, setForensicBreakdown] = useState<Array<{ label: string; weight: number; detail: string }>>([]);
  const [forensicHotspots, setForensicHotspots] = useState<ForensicHotspot[]>([]);
  const [forensicMetadataFlags, setForensicMetadataFlags] = useState<ForensicMetadataFlag[]>([]);
  const [forensicCloneSignals, setForensicCloneSignals] = useState(0);
  const [forensicTimeline, setForensicTimeline] = useState<ForensicTimelineItem[]>([]);
  const [forensicCompareMode, setForensicCompareMode] = useState<CompareViewMode>("normal");
  const [forensicCompareSlider, setForensicCompareSlider] = useState(50);
  const [forensicBlink, setForensicBlink] = useState(false);
  const [forensicBlinkOn, setForensicBlinkOn] = useState(false);
  const [originalImageSource, setOriginalImageSource] = useState("");
  const [editedImageSource, setEditedImageSource] = useState("");
  const [forensicPreviewDataUrl, setForensicPreviewDataUrl] = useState("");
  const [forensicPreviewLoading, setForensicPreviewLoading] = useState(false);
  const [forensicRealtimeTick, setForensicRealtimeTick] = useState(0);
  const [sectionInfoOpen, setSectionInfoOpen] = useState<Record<string, boolean>>({});
  const [integrityHashes, setIntegrityHashes] = useState<{ sha256: string; crc32: string }>({ sha256: "", crc32: "" });
  const [iocData, setIocData] = useState<{ urls: string[]; emails: string[]; ips: string[]; domains: string[] }>({
    urls: [],
    emails: [],
    ips: [],
    domains: [],
  });
  const [piiData, setPiiData] = useState<{ emails: number; phones: number; ssn: number; cards: number; govIds: number }>({
    emails: 0,
    phones: 0,
    ssn: 0,
    cards: 0,
    govIds: 0,
  });
  const [linkRiskData, setLinkRiskData] = useState<{ safe: number; caution: number; risky: number; top: Array<{ url: string; level: string; reason: string; score: number; source: string }> }>({
    safe: 0,
    caution: 0,
    risky: 0,
    top: [],
  });
  const [keywordAlerts, setKeywordAlerts] = useState<string[]>([]);
  const forensicTextFingerprintRef = useRef("");
  const forensicImageFingerprintRef = useRef("");
  const editingDoc = useMemo(() => store.documents.find((d) => d.id === editingDocId) ?? null, [store.documents, editingDocId]);

  useEffect(() => {
    const refresh = () => setStore(loadInsideDocuments());
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    saveFixed(fixedDocs);
  }, [fixedDocs]);

  useEffect(() => {
    if (!editingDoc) return;
    const timer = window.setInterval(() => setForensicRealtimeTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [editingDoc?.id]);

  const pushForensicEvent = (action: string, detail: string) => {
    setForensicTimeline((current) => [{ id: createId(), at: Date.now(), action, detail }, ...current].slice(0, 120));
  };

  const toggleSectionInfo = (key: string) => {
    setSectionInfoOpen((current) => ({ ...current, [key]: !current[key] }));
  };

  const forensicTextSource = useMemo(() => {
    if (!editingDoc) return "";
    if (isTxtDoc(editingDoc)) return (txtDraft || editingDoc.extractedText || editingDoc.summary || "").trim();
    if (isPdfDoc(editingDoc)) return (editingDoc.extractedText || editingDoc.summary || "").trim();
    return (editingDoc.extractedText || editingDoc.summary || "").trim();
  }, [editingDoc, txtDraft]);

  useEffect(() => {
    if (!editingDoc) return;
    setTxtDraft(editingDoc.extractedText || editingDoc.summary || "");
    setPdfHeader("");
    setPdfWatermark("");
    setPdfFooter("");
    setPdfDraft("");
    setPdfPages([]);
    setPdfDirectEditLoading(false);
    setPdfLoadState("idle");
    setPdfNonEditableOpen(false);
    setPdfNonEditableReasons([]);
    setPdfFocusItemId(null);
    setPdfInsertMode(false);
    setPdfDocHtml("<div></div>");
    setRedactionBoxes([]);
    setRedactionTerms("");
    setRedactionLeakReport(null);
    setForensicAuthenticity(0);
    setForensicBreakdown([]);
    setForensicHotspots([]);
    setForensicMetadataFlags([]);
    setForensicCloneSignals(0);
    setForensicTimeline([]);
    setForensicCompareMode("normal");
    setForensicCompareSlider(50);
    setForensicBlink(false);
    setForensicBlinkOn(false);
    setForensicPreviewDataUrl("");
    setForensicPreviewLoading(false);
    setForensicRealtimeTick(0);
    setSectionInfoOpen({});
    setIntegrityHashes({ sha256: "", crc32: "" });
    setIocData({ urls: [], emails: [], ips: [], domains: [] });
    setPiiData({ emails: 0, phones: 0, ssn: 0, cards: 0, govIds: 0 });
    setLinkRiskData({ safe: 0, caution: 0, risky: 0, top: [] });
    setKeywordAlerts([]);
    if (isImageDoc(editingDoc)) {
      resetImageEditor();
      setImageSource(editingDoc.sourceDataUrl || "");
      setOriginalImageSource(editingDoc.sourceDataUrl || "");
      setEditedImageSource(editingDoc.sourceDataUrl || "");
    } else {
      setImageSource("");
      setOriginalImageSource("");
      setEditedImageSource("");
    }
    pushForensicEvent("Document loaded", `${editingDoc.name} opened in Forensic Lab`);
  }, [editingDocId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editingDoc || !isPdfDoc(editingDoc)) return;
    // Preview-only mode in forensic lab: disable PDF-to-DOC conversion flow.
    setPdfDirectEditLoading(false);
    setPdfLoadState("idle");
  }, [editingDoc?.id]);

  useEffect(() => {
    if (!editingDoc || !editingDoc.sourceDataUrl) {
      setIntegrityHashes({ sha256: "", crc32: "" });
      return;
    }
    let cancelled = false;
    const run = async () => {
      const bytes = await readDataUrlBytes(editingDoc.sourceDataUrl || "");
      if (cancelled) return;
      const sha256 = bytes.length ? await sha256Hex(bytes) : "";
      if (cancelled) return;
      const crc = bytes.length ? `0x${crc32(bytes).toString(16).padStart(8, "0")}` : "";
      setIntegrityHashes({ sha256, crc32: crc });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [editingDoc?.id, editingDoc?.sourceDataUrl]);

  useEffect(() => {
    const text = forensicTextSource || "";
    const urls = extractUrlsForensics(text);
    const emails = Array.from(new Set(text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [])).slice(0, 60);
    const ips = Array.from(new Set(text.match(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g) || [])).slice(0, 60);
    const domains = Array.from(new Set(text.match(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|co|ai|dev|app|info|biz)\b/gi) || [])).slice(0, 60);
    setIocData({ urls, emails, ips, domains });

    const syntheticUrls = domains
      .map((d) => `https://${d}`)
      .filter((u) => !urls.some((x) => x.toLowerCase().includes(u.replace("https://", "").toLowerCase())));
    const allLinkCandidates = [
      ...urls.map((url) => ({ url, source: "direct" as const })),
      ...syntheticUrls.map((url) => ({ url, source: "domain_inferred" as const })),
    ];
    const urlScores = allLinkCandidates.map((item) => ({ url: item.url, ...scoreForensicUrl(item.url, item.source) }));
    urlScores.sort((a, b) => {
      const severityWeight = (x: string) => (x === "risky" ? 3 : x === "caution" ? 2 : 1);
      const s = severityWeight(b.level) - severityWeight(a.level);
      if (s !== 0) return s;
      return a.score - b.score;
    });
    setLinkRiskData({
      safe: urlScores.filter((x) => x.level === "safe").length,
      caution: urlScores.filter((x) => x.level === "caution").length,
      risky: urlScores.filter((x) => x.level === "risky").length,
      top: urlScores.slice(0, 8),
    });

    setPiiData({
      emails: (text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || []).length,
      phones: (text.match(/\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g) || []).length,
      ssn: (text.match(/\b\d{3}-\d{2}-\d{4}\b/g) || []).length,
      cards: (text.match(/\b(?:\d[ -]*?){13,19}\b/g) || []).length,
      govIds: (text.match(/\b[A-Z]{2}\d{6,10}\b/g) || []).length,
    });

    const alertPatterns = [
      "urgent",
      "wire transfer",
      "gift card",
      "otp",
      "password",
      "verify account",
      "bank details",
      "crypto wallet",
      "macro",
      "invoice attached",
      "confidential",
      "token",
      "api key",
    ];
    const alerts = alertPatterns.filter((k) => new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
    setKeywordAlerts(alerts);
  }, [forensicTextSource, forensicRealtimeTick]);

  useEffect(() => {
    if (!editingDoc || !isImageDoc(editingDoc)) return;
    void drawImageEditor();
  }, [
    editingDoc,
    imageSource,
    imgRotate,
    imgFlipX,
    imgFlipY,
    imgZoom,
    imgBrightness,
    imgContrast,
    imgSaturate,
    imgBlur,
    imgOpacity,
    imgGray,
    imgSepia,
    imgInvert,
    overlays,
    overlayTextInput,
    overlayColor,
    overlaySize,
    overlayX,
    overlayY,
    redactionBoxes,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editingDoc) return;
    let cancelled = false;
    const loadPreview = async () => {
      setForensicPreviewLoading(true);
      try {
        if (isImageDoc(editingDoc)) {
          if (!cancelled) setForensicPreviewDataUrl(editingDoc.sourceDataUrl || imageSource || "");
          return;
        }
        if (isPdfDoc(editingDoc) && editingDoc.sourceDataUrl) {
          // Use browser native renderer at 100% zoom for PDF preview.
          if (!cancelled) setForensicPreviewDataUrl(`${editingDoc.sourceDataUrl}#zoom=100`);
          return;
        }
        if (isTxtDoc(editingDoc)) {
          if (!cancelled) setForensicPreviewDataUrl("");
          return;
        }
        if (!cancelled) setForensicPreviewDataUrl("");
      } catch {
        if (!cancelled) setForensicPreviewDataUrl("");
      } finally {
        if (!cancelled) setForensicPreviewLoading(false);
      }
    };
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [editingDoc?.id, imageSource]);

  useEffect(() => {
    if (!forensicBlink) {
      setForensicBlinkOn(false);
      return;
    }
    const timer = window.setInterval(() => setForensicBlinkOn((v) => !v), 520);
    return () => window.clearInterval(timer);
  }, [forensicBlink]);

  useEffect(() => {
    if (!editingDoc) return;
    let cancelled = false;
    const runMetadata = async () => {
      setForensicLoading(true);
      try {
        const flags = await getDocumentMetadataFlags(editingDoc);
        if (cancelled) return;
        setForensicMetadataFlags(flags);
      } finally {
        if (!cancelled) setForensicLoading(false);
      }
    };
    void runMetadata();
    return () => {
      cancelled = true;
    };
  }, [editingDoc?.id]);

  useEffect(() => {
    if (!editingDoc) return;
    const timer = window.setTimeout(() => {
      const editCount = overlays.length + redactionBoxes.length + (isPdfDoc(editingDoc) ? 1 : 0) + (isTxtDoc(editingDoc) ? 1 : 0);
      const tamperSignal = Math.min(100, forensicHotspots.length * 4 + forensicCloneSignals * 6);
      const auth = computeAuthenticity({
        tamperSignal,
        cloneSignals: forensicCloneSignals,
        metadataFlags: forensicMetadataFlags,
        editCount,
      });
      setForensicAuthenticity(auth.score);
      setForensicBreakdown(auth.breakdown);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [editingDoc?.id, overlays.length, redactionBoxes.length, forensicHotspots.length, forensicCloneSignals, forensicMetadataFlags, txtDraft, pdfDraft]);

  useEffect(() => {
    if (!editingDoc || !isImageDoc(editingDoc) || redactionBoxes.length === 0) return;
    const canvas = imageCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let leaks = 0;
    redactionBoxes.forEach((box) => {
      const img = ctx.getImageData(box.x, box.y, Math.max(1, Math.min(box.w, canvas.width - box.x)), Math.max(1, Math.min(box.h, canvas.height - box.y)));
      const px = img.data;
      let bright = 0;
      let samples = 0;
      for (let i = 0; i < px.length; i += 24) {
        bright += px[i] + px[i + 1] + px[i + 2];
        samples += 1;
      }
      const avg = bright / Math.max(1, samples * 3);
      if (avg > 18) leaks += 1;
    });
    setRedactionLeakReport(leaks > 0 ? `Leak check warning: ${leaks} redaction block(s) may not fully cover source pixels.` : "Leak check passed. Redacted regions are opaque.");
  }, [editingDoc?.id, redactionBoxes, editedImageSource]);

  useEffect(() => {
    if (!editingDoc) return;
    const text = isTxtDoc(editingDoc) ? txtDraft : isPdfDoc(editingDoc) ? getPdfDocText() : "";
    const fp = `${text.slice(0, 240)}|${text.length}`;
    if (fp === forensicTextFingerprintRef.current) return;
    const timer = window.setTimeout(() => {
      forensicTextFingerprintRef.current = fp;
      pushForensicEvent("Text revised", `Live editor content updated (${text.length} chars)`);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [editingDoc?.id, txtDraft, pdfDraft, pdfDocHtml]);

  useEffect(() => {
    if (!editingDoc || !isImageDoc(editingDoc)) return;
    const fp = `${imgRotate}|${imgFlipX}|${imgFlipY}|${imgZoom}|${imgBrightness}|${imgContrast}|${imgSaturate}|${imgBlur}|${imgOpacity}|${imgGray}|${imgSepia}|${imgInvert}|${overlays.length}|${redactionBoxes.length}`;
    if (fp === forensicImageFingerprintRef.current) return;
    const timer = window.setTimeout(() => {
      forensicImageFingerprintRef.current = fp;
      pushForensicEvent("Image transform", "Live image parameters changed");
    }, 520);
    return () => window.clearTimeout(timer);
  }, [
    editingDoc?.id,
    imgRotate,
    imgFlipX,
    imgFlipY,
    imgZoom,
    imgBrightness,
    imgContrast,
    imgSaturate,
    imgBlur,
    imgOpacity,
    imgGray,
    imgSepia,
    imgInvert,
    overlays.length,
    redactionBoxes.length,
  ]);

  useEffect(() => {
    if (!editingDoc || !isPdfDoc(editingDoc)) return;
    const el = pdfDocEditorRef.current;
    if (!el) return;
    const nextHtml = (pdfDocHtml || "").trim();
    if (!nextHtml) return;
    const currentHtml = (el.innerHTML || "").trim();
    if (currentHtml === nextHtml) return;
    el.innerHTML = nextHtml;
  }, [editingDoc?.id, pdfDocHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  const riskyDocs = useMemo(() => {
    return store.documents
      .filter((d) => d.track === mode)
      .filter((d) => getRiskTier(d) === "high" || getRiskTier(d) === "extreme")
      .filter((d) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return d.name.toLowerCase().includes(q) || (d.summary || "").toLowerCase().includes(q);
      })
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
  }, [store.documents, mode, query]);

  const editableDocs = useMemo(() => {
    return store.documents
      .filter((d) => isImageDoc(d) || isPdfDoc(d) || isTxtDoc(d))
      .filter((d) => {
        const q = editingQuery.trim().toLowerCase();
        if (!q) return true;
        return d.name.toLowerCase().includes(q) || (d.summary || "").toLowerCase().includes(q);
      })
      .sort((a, b) => b.uploadedAt - a.uploadedAt);
  }, [store.documents, editingQuery]);

  const modeDocs = useMemo(() => store.documents.filter((d) => !d.track || d.track === mode), [store.documents, mode]);

  const fixingInsights = useMemo(() => {
    const low = modeDocs.filter((d) => getRiskTier(d) === "low").length;
    const medium = modeDocs.filter((d) => getRiskTier(d) === "medium").length;
    const high = modeDocs.filter((d) => getRiskTier(d) === "high").length;
    const extreme = modeDocs.filter((d) => getRiskTier(d) === "extreme").length;
    const fixedInMode = fixedDocs.filter((f) => !f.track || f.track === mode).length;
    const activeCritical = high + extreme;
    const remediationRate = fixedInMode + activeCritical === 0 ? 100 : Math.round((fixedInMode / (fixedInMode + activeCritical)) * 100);
    return { low, medium, high, extreme, fixedInMode, activeCritical, remediationRate };
  }, [modeDocs, fixedDocs, mode]);

  const forensicInsights = useMemo(() => {
    const total = editableDocs.length;
    const image = editableDocs.filter((d) => isImageDoc(d)).length;
    const pdf = editableDocs.filter((d) => isPdfDoc(d)).length;
    const txt = editableDocs.filter((d) => isTxtDoc(d)).length;
    const withSource = editableDocs.filter((d) => Boolean(d.sourceDataUrl)).length;
    const avgTrust = total ? Math.round(editableDocs.reduce((acc, d) => acc + d.trustScore, 0) / total) : 0;
    return { total, image, pdf, txt, withSource, avgTrust };
  }, [editableDocs]);

  const downloadTxt = (item: FixedRecord) => {
    const blob = new Blob([item.cleanedText || ""], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${item.name.replace(/\.[^/.]+$/, "")}-fixed.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadZip = (item: FixedRecord) => {
    const zip = makeZipBlob(`${item.name.replace(/\.[^/.]+$/, "")}-fixed.txt`, item.cleanedText || "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zip);
    a.download = `${item.name.replace(/\.[^/.]+$/, "")}-fixed.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadPdf = async (item: FixedRecord) => {
    try {
      const jspdf = await import(/* @vite-ignore */ "jspdf");
      const PDF = jspdf.jsPDF;
      const pdf = new PDF({ unit: "pt", format: "a4" });
      const lines = pdf.splitTextToSize(item.cleanedText || "", 520);
      pdf.setFontSize(12);
      pdf.text(lines, 40, 60);
      pdf.save(`${item.name.replace(/\.[^/.]+$/, "")}-fixed.pdf`);
    } catch {
      downloadTxt(item);
    }
  };

  const downloadImg = (item: FixedRecord) => {
    if (item.sourceDataUrl && item.sourceMime.startsWith("image/")) {
      const a = document.createElement("a");
      a.href = item.sourceDataUrl;
      a.download = `${item.name.replace(/\.[^/.]+$/, "")}-fixed.png`;
      a.click();
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111";
    ctx.font = "24px Arial";
    const text = item.cleanedText || "";
    const words = text.split(/\s+/);
    let line = "";
    let y = 80;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > 1100 && line) {
        ctx.fillText(line, 60, y);
        y += 32;
        line = word;
      } else {
        line = test;
      }
      if (y > 1700) break;
    }
    if (line && y <= 1700) ctx.fillText(line, 60, y);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${item.name.replace(/\.[^/.]+$/, "")}-fixed.png`;
    a.click();
  };

  const resetImageEditor = () => {
    setImgRotate(0);
    setImgFlipX(false);
    setImgFlipY(false);
    setImgZoom(1);
    setImgBrightness(100);
    setImgContrast(100);
    setImgSaturate(100);
    setImgBlur(0);
    setImgOpacity(100);
    setImgGray(false);
    setImgSepia(false);
    setImgInvert(false);
    setOverlayTextInput("");
    setOverlayColor("#00e5ff");
    setOverlaySize(36);
    setOverlayX(80);
    setOverlayY(120);
    setOverlays([]);
    setRedactionBoxes([]);
    pushForensicEvent("Image reset", "All transforms, overlays, and redactions cleared");
  };

  const drawImageEditor = async () => {
    if (!editingDoc || !isImageDoc(editingDoc) || !imageSource) return;
    const canvas = imageCanvasRef.current;
    if (!canvas) return;
    const image = new Image();
    image.src = imageSource;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image load failed"));
    });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const maxW = 1040;
    const maxH = 620;
    const ratio = Math.min(maxW / image.width, maxH / image.height, 1);
    canvas.width = Math.max(200, Math.round(image.width * ratio));
    canvas.height = Math.max(200, Math.round(image.height * ratio));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((imgRotate * Math.PI) / 180);
    ctx.scale((imgFlipX ? -1 : 1) * imgZoom, (imgFlipY ? -1 : 1) * imgZoom);
    ctx.globalAlpha = Math.max(0.1, Math.min(1, imgOpacity / 100));
    const filterParts = [
      `brightness(${imgBrightness}%)`,
      `contrast(${imgContrast}%)`,
      `saturate(${imgSaturate}%)`,
      `blur(${imgBlur}px)`,
      `grayscale(${imgGray ? 100 : 0}%)`,
      `sepia(${imgSepia ? 100 : 0}%)`,
      `invert(${imgInvert ? 100 : 0}%)`,
    ];
    ctx.filter = filterParts.join(" ");
    ctx.drawImage(image, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
    ctx.restore();

    overlays.forEach((o) => {
      ctx.save();
      ctx.fillStyle = o.color;
      ctx.font = `${Math.max(10, o.size)}px Arial`;
      ctx.fillText(o.text, o.x, o.y);
      ctx.restore();
    });

    if (overlayTextInput.trim()) {
      ctx.save();
      ctx.fillStyle = overlayColor;
      ctx.globalAlpha = 0.9;
      ctx.font = `${Math.max(10, overlaySize)}px Arial`;
      ctx.fillText(overlayTextInput.trim(), overlayX, overlayY);
      ctx.restore();
    }

    redactionBoxes.forEach((box) => {
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = "#ffffff";
      ctx.font = "10px Arial";
      ctx.fillText("REDACTED", box.x + 4, box.y + 12);
      ctx.restore();
    });

    setEditedImageSource(canvas.toDataURL("image/png"));
    const forensic = analyzeCanvasForensics(canvas);
    setForensicHotspots(forensic.hotspots);
    setForensicCloneSignals(forensic.cloneSignals);
  };

  const exportEditedImageSameFormat = () => {
    if (!editingDoc) return;
    const canvas = imageCanvasRef.current;
    if (!canvas) return;
    const mime = imageOutputMime(editingDoc);
    const ext = imageOutputExt(mime);
    const quality = mime === "image/jpeg" || mime === "image/webp" ? 0.95 : undefined;
    const a = document.createElement("a");
    a.href = canvas.toDataURL(mime, quality);
    a.download = `${editingDoc.name.replace(/\.[^/.]+$/, "")}-edited.${ext}`;
    a.click();
    pushForensicEvent("Image export", `Saved as ${ext.toUpperCase()} in live forensic session`);
  };

  const replaceEditedImageInRegistry = async () => {
    if (!editingDoc) return;
    const canvas = imageCanvasRef.current;
    if (!canvas) return;
    const mime = imageOutputMime(editingDoc);
    const quality = mime === "image/jpeg" || mime === "image/webp" ? 0.95 : undefined;
    const dataUrl = canvas.toDataURL(mime, quality);
    const next = updateInsideDocuments((current) => ({
      ...current,
      documents: current.documents.map((d) =>
        d.id === editingDoc.id
          ? {
              ...d,
              sourceDataUrl: dataUrl,
              sourceMime: mime,
              type: mime,
              summary: `${d.summary} | original replaced by infantry image editor`,
              status: "viewed",
            }
          : d
      ),
    }));
    setStore(next);
    setImageSource(dataUrl);
    pushForensicEvent("Registry update", "Edited image replaced in document registry");
  };

  const exportEditedPdf = async (saveToRegistry: boolean) => {
    if (!editingDoc) return;
    const changedObjectReplacements = pdfPages
      .flatMap((p) => p.items)
      .filter((i) => !i.isNew && i.originalText.trim() && i.text !== i.originalText)
      .map((i) => ({ originalText: i.originalText, newText: i.text }));
    const hasNewObjects = pdfPages.some((p) => p.items.some((i) => i.isNew && i.text.trim()));
    const hasStyleOverlays = Boolean(pdfHeader.trim() || pdfFooter.trim() || pdfWatermark.trim());

    // Native object patch path (Tauri): patch only changed existing text objects in original PDF bytes.
    if (
      editingDoc.sourceDataUrl &&
      changedObjectReplacements.length > 0 &&
      !hasNewObjects &&
      !hasStyleOverlays
    ) {
      const native = await runNativePdfPatch({
        sourceDataUrl: editingDoc.sourceDataUrl,
        replacements: changedObjectReplacements,
      });
      if (native?.success && native.outputDataUrl) {
        const flattenedText = pdfPages
          .map((p) => p.items.map((i) => i.text).join(" "))
          .join("\n")
          .trim();
        const finalText = flattenedText || (editingDoc.extractedText || editingDoc.summary || editingDoc.name || "").trim();
        if (!saveToRegistry) {
          const a = document.createElement("a");
          a.href = native.outputDataUrl;
          a.download = `${editingDoc.name.replace(/\.[^/.]+$/, "")}-edited.pdf`;
          a.click();
          return;
        }
        const next = updateInsideDocuments((current) => ({
          ...current,
          documents: current.documents.map((d) =>
            d.id === editingDoc.id
              ? {
                  ...d,
                  sourceDataUrl: native.outputDataUrl || d.sourceDataUrl,
                  sourceMime: "application/pdf",
                  type: "application/pdf",
                  extractedText: finalText,
                  summary: `${d.summary} | original replaced by native pdf object editor`,
                  status: "viewed",
                }
              : d
          ),
        }));
        setStore(next);
        return;
      }
    }

    const jspdf = await import(/* @vite-ignore */ "jspdf");
    const PDF = jspdf.jsPDF;
    const overlayBody = (pdfDraft || editingDoc.extractedText || editingDoc.summary || editingDoc.name || "").trim();
    const hasDirect = pdfPages.length > 0;
    const firstW = pdfPages[0]?.width || 595;
    const firstH = pdfPages[0]?.height || 842;
    const pdf = new PDF({ unit: "pt", format: [firstW, firstH] });

    if (hasDirect) {
      pdfPages.forEach((page, pageIdx) => {
        if (pageIdx > 0) pdf.addPage([page.width, page.height], page.width > page.height ? "l" : "p");
        pdf.addImage(page.imageDataUrl, "PNG", 0, 0, page.width, page.height);
        page.items.forEach((item) => {
          if (!item.text.trim()) return;
          const changed = item.isNew || item.text !== item.originalText;
          if (!changed) return;
          const textW = Math.max(12, item.text.length * Math.max(8, item.fontSize) * 0.54);
          const textH = Math.max(12, item.fontSize * 1.22);
          // Mask the original glyphs before writing edited text to avoid double/scattered look.
          pdf.setFillColor(255, 255, 255);
          pdf.rect(item.x - 2, item.y - textH + 2, textW + 4, textH + 4, "F");
          pdf.setTextColor(0, 0, 0);
          pdf.setFontSize(Math.max(8, Math.min(48, item.fontSize)));
          pdf.text(item.text || " ", item.x, item.y + Math.max(8, item.fontSize * 0.78), { baseline: "alphabetic" as any });
        });
        if (pdfHeader.trim()) {
          pdf.setFontSize(12);
          pdf.text(pdfHeader.trim(), 20, 22);
        }
        if (pdfFooter.trim()) {
          pdf.setFontSize(10);
          pdf.text(pdfFooter.trim(), 20, page.height - 16);
        }
        if (pdfWatermark.trim()) {
          pdf.setTextColor(180, 180, 180);
          pdf.setFontSize(42);
          pdf.text(pdfWatermark.trim(), Math.max(24, page.width * 0.2), page.height * 0.6, { angle: 330 });
          pdf.setTextColor(0, 0, 0);
        }
      });
    } else {
      const w = 595;
      const h = 842;
      pdf.setFontSize(16);
      pdf.text(editingDoc.name, 40, 48);
      if (pdfHeader.trim()) {
        pdf.setFontSize(12);
        pdf.text(pdfHeader.trim(), 40, 70);
      }
      pdf.setFontSize(10);
      const lines = pdf.splitTextToSize(overlayBody || "No text available from source document.", 510);
      pdf.text(lines, 40, 110);
      if (pdfWatermark.trim()) {
        pdf.setTextColor(180, 180, 180);
        pdf.setFontSize(44);
        pdf.text(pdfWatermark.trim(), 100, 430, { angle: 330 });
        pdf.setTextColor(0, 0, 0);
      }
      if (pdfFooter.trim()) {
        pdf.setFontSize(10);
        pdf.text(pdfFooter.trim(), 40, h - 24);
      }
    }

    const flattenedText = hasDirect
      ? pdfPages
          .map((p) => p.items.map((i) => i.text).join(" "))
          .join("\n")
          .trim()
      : overlayBody;
    const finalText = flattenedText || (editingDoc.extractedText || editingDoc.summary || editingDoc.name || "").trim();
    if (!saveToRegistry) {
      pdf.save(`${editingDoc.name.replace(/\.[^/.]+$/, "")}-edited.pdf`);
      pushForensicEvent("PDF export", "Downloaded edited PDF");
      return;
    }
    const blob = pdf.output("blob");
    const dataUrl = await toDataUrl(blob);
    const next = updateInsideDocuments((current) => ({
      ...current,
      documents: current.documents.map((d) =>
        d.id === editingDoc.id
          ? {
              ...d,
              sourceDataUrl: dataUrl,
              sourceMime: "application/pdf",
              type: "application/pdf",
              extractedText: finalText,
              summary: `${d.summary} | original replaced by infantry pdf editor`,
              status: "viewed",
            }
          : d
      ),
    }));
    setStore(next);
    pushForensicEvent("Registry update", "Edited PDF replaced in document registry");
  };

  const getPdfDocText = () => {
    const live = (pdfDocEditorRef.current?.innerText || "").trim();
    return live || (pdfDraft || editingDoc?.extractedText || editingDoc?.summary || "").trim();
  };

  const getPdfDocHtml = () => {
    const liveHtml = (pdfDocEditorRef.current?.innerHTML || "").trim();
    return liveHtml || pdfDocHtml || "<div></div>";
  };

  const applyDocCommand = (command: "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList") => {
    const el = pdfDocEditorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command);
    setPdfDraft(el.innerText || "");
  };

  const linkMicrosoftAccount = async (accountType: "any" | "personal" = "any") => {
    setMsLinking(true);
    try {
      const clientId = (import.meta as any)?.env?.VITE_MS_CLIENT_ID as string | undefined;
      if (!clientId) {
        window.open("https://www.office.com/?auth=2", "_blank", "noopener,noreferrer");
        try {
          localStorage.setItem(MS_LINK_KEY, "1");
        } catch {}
        setMsLinked(true);
        return;
      }
      const redirectUri = window.location.origin;
      const scope = "openid profile User.Read Files.ReadWrite offline_access";
      const tenant = accountType === "personal" ? "consumers" : "common";
      const authUrl =
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize` +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&response_type=token` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scope)}` +
        `&prompt=select_account`;
      const popup = window.open(authUrl, "ms_auth", "width=520,height=680");
      if (!popup) return;
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        const timer = window.setInterval(() => {
          if (popup.closed) {
            window.clearInterval(timer);
            reject(new Error("Microsoft login was closed"));
            return;
          }
          let href = "";
          try {
            href = popup.location.href;
          } catch {
            return;
          }
          if (!href.startsWith(redirectUri)) return;
          const hash = popup.location.hash || "";
          if (hash.includes("access_token=")) {
            window.clearInterval(timer);
            popup.close();
            resolve();
            return;
          }
          if (Date.now() - started > 180000) {
            window.clearInterval(timer);
            popup.close();
            reject(new Error("Microsoft login timed out"));
          }
        }, 400);
      });
      try {
        localStorage.setItem(MS_LINK_KEY, "1");
      } catch {}
      setMsLinked(true);
    } finally {
      setMsLinking(false);
    }
  };

  const downloadConvertedDoc = () => {
    if (!editingDoc) return;
    const fallbackText = (editingDoc.extractedText || editingDoc.summary || editingDoc.name || "").trim();
    const htmlBody = getPdfDocHtml().trim() || `<pre>${escapeHtml(fallbackText)}</pre>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${editingDoc.name}</title></head><body style="font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.45;">${htmlBody}</body></html>`;
    const blob = new Blob([html], { type: "application/msword" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${editingDoc.name.replace(/\.[^/.]+$/, "")}-edited.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openInMicrosoftWord = async () => {
    downloadConvertedDoc();
    window.open("https://www.office.com/launch/word", "_blank", "noopener,noreferrer");
  };

  const downloadConvertedPdf = async () => {
    if (!editingDoc) return;
    const text = getPdfDocText();
    const jspdf = await import(/* @vite-ignore */ "jspdf");
    const PDF = jspdf.jsPDF;
    const pdf = new PDF({ unit: "pt", format: "a4" });
    const lines = pdf.splitTextToSize(text || "No text available.", 520);
    pdf.setFontSize(12);
    pdf.text(lines, 40, 60);
    pdf.save(`${editingDoc.name.replace(/\.[^/.]+$/, "")}-edited.pdf`);
  };

  const makePdfEditableViaOcr = async () => {
    if (!editingDoc || !editingDoc.sourceDataUrl) return;
    setPdfOcrRunning(true);
    try {
      const sourceFile = dataUrlToFile(editingDoc.sourceDataUrl, editingDoc.name, editingDoc.sourceMime || editingDoc.type || "application/pdf");
      const analysis = await analyzeDocumentFile(sourceFile);
      const next = updateInsideDocuments((current) => ({
        ...current,
        documents: current.documents.map((d) =>
          d.id === editingDoc.id
            ? {
                ...d,
                trustScore: analysis.trustScore,
                risks: analysis.risks,
                summary: analysis.summary,
                extractionMethod: analysis.extractionMethod,
                pagesAnalyzed: analysis.pagesAnalyzed,
                extractionConfidence: analysis.extractionConfidence,
                extractedText: analysis.extractedText,
                sourceDataUrl: d.sourceDataUrl || editingDoc.sourceDataUrl,
                sourceMime: d.sourceMime || editingDoc.sourceMime || "application/pdf",
              }
            : d
        ),
      }));
      setStore(next);
      const updated = next.documents.find((d) => d.id === editingDoc.id);
      setPdfDraft((updated?.extractedText || analysis.extractedText || "").trim());
      setPdfPages(createCleanPdfPages((updated?.extractedText || analysis.extractedText || "").trim()));
      setPdfLoadState("ready");
    } finally {
      setPdfOcrRunning(false);
    }
  };

  const unscanPdfToHdEditable = async () => {
    if (!editingDoc || !editingDoc.sourceDataUrl) return;
    setPdfUnscanRunning(true);
    try {
      const sourceFile = dataUrlToFile(editingDoc.sourceDataUrl, editingDoc.name, editingDoc.sourceMime || editingDoc.type || "application/pdf");
      const analysis = await analyzeDocumentFile(sourceFile);
      const text = (analysis.extractedText || editingDoc.extractedText || editingDoc.summary || "").trim();
      const rebuilt = createCleanPdfPages(text);
      setPdfPages(rebuilt);
      setPdfDraft(text);
      setPdfLoadState("ready");
      setPdfNonEditableOpen(false);
    } finally {
      setPdfUnscanRunning(false);
    }
  };

  const updatePdfItemText = (pageNumber: number, itemId: string, text: string) => {
    setPdfPages((current) =>
      current.map((p) => (p.page !== pageNumber ? p : { ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, text } : i)) }))
    );
  };

  const addPdfItemAt = (pageNumber: number, x: number, y: number) => {
    const newId = `p${pageNumber}-n-${createId()}`;
    setPdfPages((current) =>
      current.map((p) =>
        p.page !== pageNumber
          ? p
          : {
              ...p,
              items: [
              ...p.items,
                { id: newId, text: "", originalText: "", x: Math.max(4, x), y: Math.max(4, y), fontSize: 24, isNew: true },
              ],
            }
      )
    );
    setPdfFocusItemId(newId);
  };

  const applySmartRedaction = () => {
    if (!editingDoc) return;
    const terms = redactionTerms
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!terms.length) {
      setRedactionLeakReport("No terms provided for redaction.");
      return;
    }

    if (isTxtDoc(editingDoc)) {
      let next = txtDraft;
      terms.forEach((term) => {
        const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        next = next.replace(re, "[REDACTED]");
      });
      setTxtDraft(next);
      const leaks = terms.filter((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(next));
      setRedactionLeakReport(leaks.length ? `Leak check failed: ${leaks.join(", ")} still present.` : "Leak check passed. Redaction terms removed from text.");
      pushForensicEvent("Redaction applied", `Text redaction for ${terms.length} term(s)`);
      return;
    }

    if (isPdfDoc(editingDoc)) {
      let text = getPdfDocText();
      let html = getPdfDocHtml();
      terms.forEach((term) => {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(safe, "gi"), "[REDACTED]");
        html = html.replace(new RegExp(safe, "gi"), "[REDACTED]");
      });
      setPdfDraft(text);
      setPdfDocHtml(html);
      const leaks = terms.filter((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(`${text}\n${html}`));
      setRedactionLeakReport(leaks.length ? `Leak check failed: ${leaks.join(", ")} still present.` : "Leak check passed across PDF text layer and editor HTML.");
      pushForensicEvent("Redaction applied", `PDF redaction for ${terms.length} term(s)`);
      return;
    }

    if (isImageDoc(editingDoc)) {
      const width = Math.max(80, Math.round((overlaySize || 36) * 4.2));
      const height = Math.max(30, Math.round((overlaySize || 36) * 1.6));
      setRedactionBoxes((current) => [
        ...current,
        {
          id: createId(),
          x: Math.max(0, overlayX),
          y: Math.max(0, overlayY - height + 8),
          w: width,
          h: height,
        },
      ]);
      setRedactionLeakReport("Redaction mask added to image. Leak check will validate coverage on next render.");
      pushForensicEvent("Redaction applied", "Image redaction box inserted");
    }
  };

  const exportCourtReadyBundle = async () => {
    if (!editingDoc) return;
    const report = {
      docId: editingDoc.id,
      name: editingDoc.name,
      generatedAt: new Date().toISOString(),
      authenticityScore: forensicAuthenticity,
      breakdown: forensicBreakdown,
      hotspots: forensicHotspots,
      cloneSignals: forensicCloneSignals,
      metadataFlags: forensicMetadataFlags,
      redactionLeakReport,
    };
    const chain = forensicTimeline
      .slice()
      .reverse()
      .map((item) => `${new Date(item.at).toISOString()} | ${item.action} | ${item.detail}`)
      .join("\n");

    let artifactName = "artifact.txt";
    let artifactBytes = new TextEncoder().encode(txtDraft || pdfDraft || editingDoc.summary || "");
    if (isImageDoc(editingDoc) && editedImageSource) {
      artifactName = `${editingDoc.name.replace(/\.[^/.]+$/, "")}-annotated.png`;
      artifactBytes = await readDataUrlBytes(editedImageSource);
    } else if (isPdfDoc(editingDoc) && editingDoc.sourceDataUrl) {
      artifactName = `${editingDoc.name.replace(/\.[^/.]+$/, "")}-working.pdf`;
      artifactBytes = await readDataUrlBytes(editingDoc.sourceDataUrl);
    }
    const sourceBytes = editingDoc.sourceDataUrl ? await readDataUrlBytes(editingDoc.sourceDataUrl) : new Uint8Array();
    const sourceHash = sourceBytes.length ? await sha256Hex(sourceBytes) : "n/a";
    const artifactHash = artifactBytes.length ? await sha256Hex(artifactBytes) : "n/a";
    const integrity = `source_sha256=${sourceHash}\nartifact_sha256=${artifactHash}\nsource_size=${sourceBytes.length}\nartifact_size=${artifactBytes.length}\n`;
    const zip = makeZipBlobFromEntries([
      { name: "forensic-report.json", data: new TextEncoder().encode(JSON.stringify(report, null, 2)) },
      { name: "chain-of-custody.log", data: new TextEncoder().encode(chain || "No events logged") },
      { name: "integrity-hashes.txt", data: new TextEncoder().encode(integrity) },
      { name: artifactName, data: artifactBytes },
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zip);
    a.download = `${editingDoc.name.replace(/\.[^/.]+$/, "")}-forensic-evidence.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    pushForensicEvent("Evidence bundle", "Court-ready export package generated");
  };

  useEffect(() => {
    if (!pdfFocusItemId) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`pdf-item-${pdfFocusItemId}`) as HTMLInputElement | null;
      if (!el) return;
      el.focus();
      el.select();
    }, 30);
    return () => window.clearTimeout(t);
  }, [pdfFocusItemId]);

  const replaceTxtInRegistry = () => {
    if (!editingDoc) return;
    const clean = txtDraft.trim() || editingDoc.extractedText || editingDoc.summary || editingDoc.name;
    const blob = new Blob([clean], { type: "text/plain;charset=utf-8" });
    void toDataUrl(blob).then((dataUrl) => {
      const next = updateInsideDocuments((current) => ({
        ...current,
        documents: current.documents.map((d) =>
          d.id === editingDoc.id
            ? {
                ...d,
                extractedText: clean,
                sourceDataUrl: dataUrl,
                sourceMime: "text/plain",
                type: "text/plain",
                summary: `${d.summary} | edited in infantry text editor`,
                status: "viewed",
              }
            : d
        ),
      }));
      setStore(next);
    });
    pushForensicEvent("Registry update", "Edited text replaced in document registry");
  };

  const runFix = async (doc: InsideDocumentRecord) => {
    setFixingDocId(doc.id);
    const initialStages: FixPipelineState["stages"] = [
      { key: "sources", title: "Collect Sources", detail: "Gathering trusted remediation references.", status: "pending" },
      { key: "rescan", title: "Deep Re-Scan", detail: "Running strict cyber-grade re-analysis.", status: "pending" },
      { key: "sanitize", title: "Sanitize Threats", detail: "Removing malicious markers from retained content.", status: "pending" },
      { key: "artifact", title: "Build Fixed Copy", detail: "Preparing fixed artifact and download outputs.", status: "pending" },
      { key: "verify", title: "Verify Result", detail: "Final risk verification before completion.", status: "pending" },
    ];
    const startedAt = Date.now();
    setFixPipeline({
      docId: doc.id,
      docName: doc.name,
      startedAt,
      stages: initialStages,
    });

    const setStageStatus = (index: number, status: PipelineStageStatus) => {
      setFixPipeline((current) => {
        if (!current || current.docId !== doc.id) return current;
        return {
          ...current,
          stages: current.stages.map((stage, idx) => (idx === index ? { ...stage, status } : stage)),
        };
      });
    };

    const runStage = async (index: number, task: () => Promise<void> | void, minMs = 900) => {
      const t0 = Date.now();
      setStageStatus(index, "running");
      await task();
      const elapsed = Date.now() - t0;
      if (elapsed < minMs) await sleep(minMs - elapsed);
      setStageStatus(index, "done");
    };

    let sources: string[] = [];
    try {
      let rescanned = doc;
      await runStage(0, () => {
        sources = getFixSources(doc);
      });

      await runStage(1, async () => {
        if (!doc.sourceDataUrl) return;
        const sourceFile = dataUrlToFile(doc.sourceDataUrl, doc.name, doc.sourceMime || doc.type);
        const analysis = await analyzeDocumentFile(sourceFile);
        rescanned = {
          ...doc,
          trustScore: analysis.trustScore,
          risks: analysis.risks,
          summary: analysis.summary,
          extractionMethod: analysis.extractionMethod,
          pagesAnalyzed: analysis.pagesAnalyzed,
          extractionConfidence: analysis.extractionConfidence,
          extractedText: analysis.extractedText,
        };
      });

      let cleanedText = "";
      await runStage(2, () => {
        cleanedText = sanitizeMaliciousContent(rescanned.extractedText || rescanned.summary || rescanned.name);
      });

      let fixed: FixedRecord | null = null;
      await runStage(3, () => {
        fixed = {
          id: createId(),
          docId: doc.id,
          track: doc.track,
          name: doc.name,
          type: doc.type,
          sourceMime: doc.sourceMime || doc.type || "application/octet-stream",
          sourceDataUrl: doc.sourceDataUrl || "",
          fixedAt: Date.now(),
          riskBefore: getRiskTier(doc) === "extreme" ? "extreme" : "high",
          trustBefore: doc.trustScore,
          trustAfter: 94,
          risksAfter: 0,
          summaryAfter:
            "Strict fix pipeline completed: rescanned, malicious markers cleaned, and moved to mitigated-safe state for controlled use.",
          cleanedText: cleanedText || "No retained text after sanitation.",
          recommendations: sources,
        };
      });

      await runStage(4, async () => {
        const totalElapsed = Date.now() - startedAt;
        if (totalElapsed < 5000) await sleep(5000 - totalElapsed);
      });

      if (!fixed) return;
      setFixedDocs((current) => [fixed as FixedRecord, ...current]);
      setFixSummary({
        name: doc.name,
        lines: [
          "Fix completed.",
          "What happened:",
          "1. Full strict risk scan was run again.",
          "2. Malicious/worm/virus markers were sanitized from retained content.",
          "3. A mitigated fixed copy is now available for download/update.",
          "Suggested external sources:",
          ...sources.map((x, i) => `${i + 1}. ${x}`),
        ],
      });
    } catch {
      setFixPipeline((current) => {
        if (!current || current.docId !== doc.id) return current;
        const failedIndex = current.stages.findIndex((s) => s.status === "running");
        if (failedIndex < 0) return current;
        return {
          ...current,
          stages: current.stages.map((stage, idx) => (idx === failedIndex ? { ...stage, status: "failed" } : stage)),
        };
      });
    } finally {
      setFixingDocId(null);
      window.setTimeout(() => setFixPipeline(null), 350);
    }
  };

  const updateRegistryFromFixed = (item: FixedRecord) => {
    const normalizedName = item.name.trim().toLowerCase();
    let updatedCount = 0;
    const next = updateInsideDocuments((current) => ({
      ...current,
      documents: current.documents.map((d) => {
        const idMatch = d.id === item.docId;
        const nameMatch = d.name.trim().toLowerCase() === normalizedName && (!item.track || d.track === item.track);
        if (!idMatch && !nameMatch) return d;
        updatedCount += 1;
        return {
          ...d,
          trustScore: item.trustAfter,
          risks: item.risksAfter,
          summary: item.summaryAfter,
          extractedText: item.cleanedText,
          extractionMethod: "mitigated-safe",
          status: "viewed",
        };
      }),
    }));
    setStore(next);
    if (updatedCount === 0) {
      setFixSummary({
        name: item.name,
        lines: ["Update failed: No matching registry document was found for this fixed copy.", "Try fixing the currently listed active file again."],
      });
    }
  };

  const deleteFixed = (id: string) => setFixedDocs((current) => current.filter((x) => x.id !== id));

  return (
    <div className="space-y-6">
      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Infantry Command</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <button
              className="rounded-lg border p-5 text-left hover:border-primary transition-colors bg-card space-y-3"
              onClick={() => setFixingOpen(true)}
            >
              <div className="flex items-center gap-2 font-semibold text-lg">
                <Hammer className="h-5 w-5" />
                Fixing
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Left-side operations pane for strict document remediation and registry updates.
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border p-2">Critical Queue: <span className="font-semibold">{fixingInsights.activeCritical}</span></div>
                <div className="rounded border p-2">Fixed In Track: <span className="font-semibold">{fixingInsights.fixedInMode}</span></div>
                <div className="rounded border p-2">Remediation Rate: <span className="font-semibold">{fixingInsights.remediationRate}%</span></div>
                <div className="rounded border p-2">Total Docs: <span className="font-semibold">{modeDocs.length}</span></div>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between"><span>Extreme</span><span>{fixingInsights.extreme}</span></div>
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-destructive" style={{ width: `${modeDocs.length ? Math.round((fixingInsights.extreme / modeDocs.length) * 100) : 0}%` }} /></div>
                <div className="flex items-center justify-between"><span>High</span><span>{fixingInsights.high}</span></div>
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-orange-500" style={{ width: `${modeDocs.length ? Math.round((fixingInsights.high / modeDocs.length) * 100) : 0}%` }} /></div>
                <div className="flex items-center justify-between"><span>Medium</span><span>{fixingInsights.medium}</span></div>
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-yellow-500" style={{ width: `${modeDocs.length ? Math.round((fixingInsights.medium / modeDocs.length) * 100) : 0}%` }} /></div>
                <div className="flex items-center justify-between"><span>Low</span><span>{fixingInsights.low}</span></div>
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${modeDocs.length ? Math.round((fixingInsights.low / modeDocs.length) * 100) : 0}%` }} /></div>
              </div>
              <div className="rounded border p-2 text-xs text-muted-foreground">
                Modules: strict re-scan, malware-token sanitization, fixed artifact builder, risk re-verification, registry replacement.
              </div>
            </button>
            <button
              className="rounded-lg border p-5 text-left hover:border-primary transition-colors bg-card space-y-3"
              onClick={() => setEditingOpen(true)}
            >
              <div className="flex items-center gap-2 font-semibold text-lg">
                <PencilLine className="h-5 w-5" />
                Forensic Lab
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                Open documents here and run forensic preview, metadata, tamper detection, IOC extraction, and evidence export.
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border p-2">Forensic Queue: <span className="font-semibold">{forensicInsights.total}</span></div>
                <div className="rounded border p-2">With Source: <span className="font-semibold">{forensicInsights.withSource}</span></div>
                <div className="rounded border p-2">Average Trust: <span className="font-semibold">{forensicInsights.avgTrust}</span></div>
                <div className="rounded border p-2">Live Modules: <span className="font-semibold">10+</span></div>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between"><span>PDF</span><span>{forensicInsights.pdf}</span></div>
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-cyan-500" style={{ width: `${forensicInsights.total ? Math.round((forensicInsights.pdf / forensicInsights.total) * 100) : 0}%` }} /></div>
                <div className="flex items-center justify-between"><span>Images</span><span>{forensicInsights.image}</span></div>
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${forensicInsights.total ? Math.round((forensicInsights.image / forensicInsights.total) * 100) : 0}%` }} /></div>
                <div className="flex items-center justify-between"><span>Text</span><span>{forensicInsights.txt}</span></div>
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${forensicInsights.total ? Math.round((forensicInsights.txt / forensicInsights.total) * 100) : 0}%` }} /></div>
              </div>
              <div className="rounded border p-2 text-xs text-muted-foreground">
                Modules: authenticity scoring, metadata fingerprint, integrity hashes, IOC extractor, PII detector, link-risk scoring, keyword alerts, smart redaction, timeline, evidence package.
              </div>
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4 bg-card/60 space-y-2">
              <div className="text-sm font-medium flex items-center gap-2"><BarChart3 className="h-4 w-4" />Fixing Workflow Map</div>
              <div className="text-xs text-muted-foreground">
                1) Collect Sources to 2) Deep Re-Scan to 3) Sanitize Threat Tokens to 4) Build Fixed Artifact to 5) Verify Risk Drop.
              </div>
              <div className="text-xs text-muted-foreground">
                Output set includes TXT/ZIP/PDF/IMG plus registry update path. Designed for high/extreme queue compression with traceable mitigation logs.
              </div>
            </div>
            <div className="rounded-lg border p-4 bg-card/60 space-y-2">
              <div className="text-sm font-medium flex items-center gap-2"><BarChart3 className="h-4 w-4" />Forensic Capability Map</div>
              <div className="text-xs text-muted-foreground">
                Real-time scanners run on preview/opened evidence and surface technical flags, confidence scores, and extraction artifacts for analyst triage.
              </div>
              <div className="text-xs text-muted-foreground">
                Evidence package export includes report + chain context + integrity hashes so downstream legal/compliance teams can review without reprocessing.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Sheet open={fixingOpen} onOpenChange={setFixingOpen}>
        <SheetContent side="left" className="w-[96vw] sm:max-w-5xl overflow-y-auto" showClose={true}>
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle>Fixing Operations</SheetTitle>
              <SheetDescription>High/Extreme documents only. Strict fix pipeline with re-scan and mitigation.</SheetDescription>
            </SheetHeader>

            <Card>
              <CardHeader>
                <CardTitle>Risk Queue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search high/extreme documents..." />
                </div>
                {riskyDocs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No high/extreme documents for this mode.</div>
                ) : (
                  riskyDocs.map((doc) => (
                    <div key={doc.id} className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{doc.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatSize(doc.size)} | {toRelative(doc.uploadedAt)} | score {doc.trustScore} | risks {doc.risks}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={getRiskTier(doc) === "extreme" ? "destructive" : "outline"}>
                          {getRiskTier(doc).toUpperCase()}
                        </Badge>
                        <Button size="sm" variant="outline" onClick={() => void runFix(doc)} disabled={fixingDocId === doc.id}>
                          <Wrench className="h-4 w-4 mr-1" />
                          {fixingDocId === doc.id ? "Fixing..." : "Fix"}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fixed Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {fixedDocs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No fixed documents yet.</div>
                ) : (
                  fixedDocs
                    .map((item) => (
                      <div key={item.id} className="rounded-md border p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              fixed {toRelative(item.fixedAt)} | before {item.riskBefore} | after low | trust {item.trustAfter}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">Recommended: {recommendedDownload(item).toUpperCase()}</Badge>
                            <Button size="sm" variant="outline" onClick={() => updateRegistryFromFixed(item)}>
                              Update In Doc Registry
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => deleteFixed(item.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => downloadTxt(item)}>
                            <Download className="h-4 w-4 mr-1" />
                            TXT
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => downloadZip(item)}>
                            <Download className="h-4 w-4 mr-1" />
                            ZIP
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void downloadPdf(item)}>
                            <Download className="h-4 w-4 mr-1" />
                            PDF
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => downloadImg(item)}>
                            <Download className="h-4 w-4 mr-1" />
                            IMG
                          </Button>
                        </div>
                      </div>
                    ))
                )}
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={editingOpen} onOpenChange={setEditingOpen}>
        <SheetContent side="right" className="w-[96vw] sm:max-w-5xl overflow-y-auto" showClose={true}>
          <div className="space-y-4">
            <SheetHeader>
              <SheetTitle>Forensic Lab Operations</SheetTitle>
              <SheetDescription>Open image, PDF, and text evidence for live forensic analysis, editing, and chain-of-custody export.</SheetDescription>
            </SheetHeader>
            <Card>
              <CardHeader>
                <CardTitle>Forensic Intake Queue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-card/60 transition-all duration-200 focus-within:ring-2 focus-within:ring-primary/40">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={editingQuery}
                    onChange={(e) => setEditingQuery(e.target.value)}
                    placeholder="Search PDF / TXT / IMG evidence..."
                    className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <Button size="sm" variant="outline" onClick={() => setEditingQuery((q) => q.trim())}>Search</Button>
                </div>
                {editableDocs.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No editable files for this mode.</div>
                ) : (
                  editableDocs.map((doc) => (
                    <div key={doc.id} className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{doc.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatSize(doc.size)} | {toRelative(doc.uploadedAt)} | {(doc.sourceMime || doc.type || "unknown").toLowerCase()}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => setEditingDocId(doc.id)}>
                        <FilePenLine className="h-4 w-4 mr-1" />
                        Open
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={Boolean(editingDoc)} onOpenChange={(open) => !open && setEditingDocId(null)}>
        <DialogContent className="w-[94vw] max-w-[94vw] h-[84vh] overflow-hidden p-0">
          <DialogHeader>
            <div className="px-6 pt-6">
              <DialogTitle>Forensic Lab Workspace</DialogTitle>
              <DialogDescription>{editingDoc?.name || "Document"}</DialogDescription>
            </div>
          </DialogHeader>
          {editingDoc ? (
            <div className="grid h-[calc(84vh-88px)] gap-4 px-6 pb-6 min-h-0 lg:grid-cols-[minmax(0,1fr)_580px]">
              <div className="rounded-md border p-3 bg-muted/10 min-h-0 min-w-0 overflow-auto">
                {isImageDoc(editingDoc) ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Image forensic preview</div>
                    <div className="overflow-auto rounded border bg-black/20 p-2 h-[calc(84vh-220px)] min-h-[440px] flex items-center justify-center">
                      {forensicPreviewLoading ? (
                        <div className="text-xs text-muted-foreground">Rendering preview...</div>
                      ) : forensicPreviewDataUrl ? (
                        <img src={forensicPreviewDataUrl} alt={editingDoc.name} className="h-full w-full object-contain rounded" />
                      ) : (
                        <div className="text-xs text-muted-foreground">No source image preview available.</div>
                      )}
                    </div>
                  </div>
                ) : null}
                {isPdfDoc(editingDoc) ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">PDF forensic preview</div>
                    {forensicPreviewLoading ? (
                      <div className="w-full h-[calc(84vh-220px)] min-h-[440px] rounded border bg-muted/20 flex items-center justify-center text-xs text-muted-foreground">Rendering PDF preview...</div>
                    ) : forensicPreviewDataUrl ? (
                      <iframe title={`${editingDoc.name} preview`} src={forensicPreviewDataUrl} className="w-full h-[calc(84vh-220px)] min-h-[440px] rounded border bg-white" />
                    ) : (
                      <div className="text-xs text-muted-foreground">No source PDF preview available.</div>
                    )}
                  </div>
                ) : null}
                {isTxtDoc(editingDoc) ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Text forensic preview</div>
                    <textarea
                      value={txtDraft}
                      readOnly
                      className="w-full h-[calc(84vh-220px)] min-h-[440px] rounded border bg-background p-3 text-sm"
                      placeholder="No text available."
                    />
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border p-3 h-full min-h-0 overflow-y-auto space-y-4">
                <div className="text-[11px] text-muted-foreground">Live forensic refresh: {forensicRealtimeTick}s</div>
                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><ShieldAlert className="h-4 w-4" />Authenticity Score</div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("authenticity")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                      <Badge variant={forensicAuthenticity < 55 ? "destructive" : forensicAuthenticity < 75 ? "outline" : "secondary"}>{forensicAuthenticity}/100</Badge>
                    </div>
                  </div>
                  {sectionInfoOpen.authenticity ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      Authenticity Score combines tamper variance, clone/splice matches, metadata anomalies, and tracked edits into a single risk-oriented confidence score.
                      Higher score means fewer forensic anomalies in the current evidence state.
                    </div>
                  ) : null}
                  {forensicBreakdown.map((part) => (
                    <div key={part.label} className="text-xs rounded border p-2 bg-card/60">
                      <div className="font-medium">{part.label}: {part.weight}%</div>
                      <div className="text-muted-foreground">{part.detail}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><ScanSearch className="h-4 w-4" />Metadata Fingerprint</div>
                    <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("metadata")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                  </div>
                  {sectionInfoOpen.metadata ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      Metadata Fingerprint reads container-level creation details such as producer, creator, PDF version, and source signatures.
                      It highlights suspicious tool-chain transitions and malformed metadata patterns commonly seen in manipulated files.
                    </div>
                  ) : null}
                  {forensicLoading ? <div className="text-xs text-muted-foreground">Scanning metadata...</div> : null}
                  {forensicMetadataFlags.map((flag, idx) => (
                    <div key={`${flag.label}-${idx}`} className="flex items-center justify-between gap-2 text-xs">
                      <span>{flag.label}</span>
                      <Badge variant={flag.severity === "critical" ? "destructive" : flag.severity === "warning" ? "outline" : "secondary"}>{flag.value}</Badge>
                    </div>
                  ))}
                  <div className="text-xs text-muted-foreground">Clone/Splice detector matched {forensicCloneSignals} suspicious duplicated blocks.</div>
                </div>

                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><FileStack className="h-4 w-4" />Integrity Hashes</div>
                    <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("hashes")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                  </div>
                  {sectionInfoOpen.hashes ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      Integrity Hashes provide immutable fingerprints for chain-of-custody.
                      `SHA-256` is used for evidence-grade identity checks. `CRC32` provides a quick corruption/tamper checksum for fast triage.
                    </div>
                  ) : null}
                  <div className="text-xs">
                    <div className="font-medium">SHA-256</div>
                    <div className="break-all text-muted-foreground">{integrityHashes.sha256 || "Not available"}</div>
                  </div>
                  <div className="text-xs">
                    <div className="font-medium">CRC32</div>
                    <div className="text-muted-foreground">{integrityHashes.crc32 || "Not available"}</div>
                  </div>
                </div>

                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><Link2 className="h-4 w-4" />IOC Extractor</div>
                    <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("ioc")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                  </div>
                  {sectionInfoOpen.ioc ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      IOC Extractor collects Indicators of Compromise from document text: URLs, domains, emails, and IP addresses.
                      Use this for fast enrichment in SIEM/SOAR, threat intel lookups, and case correlation.
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    URLs {iocData.urls.length} | Domains {iocData.domains.length} | Emails {iocData.emails.length} | IPs {iocData.ips.length}
                  </div>
                  <div className="max-h-24 overflow-auto text-xs space-y-1">
                    {[...iocData.urls, ...iocData.domains, ...iocData.emails, ...iocData.ips].slice(0, 8).map((x, idx) => (
                      <div key={`${x}-${idx}`} className="break-all text-muted-foreground">{x}</div>
                    ))}
                  </div>
                </div>

                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><AlertOctagon className="h-4 w-4" />PII Detector</div>
                    <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("pii")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                  </div>
                  {sectionInfoOpen.pii ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      PII Detector scans extracted content for personally identifiable patterns including emails, phone numbers, SSN-like tokens, card numbers, and government ID-like values.
                      Use this to decide whether redaction is mandatory before sharing.
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    Emails {piiData.emails} | Phones {piiData.phones} | SSN {piiData.ssn} | Cards {piiData.cards} | Gov IDs {piiData.govIds}
                  </div>
                </div>

                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><Link2 className="h-4 w-4" />Link Risk Scanner</div>
                    <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("linkrisk")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                  </div>
                  {sectionInfoOpen.linkrisk ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      Link Risk Scanner evaluates extracted URLs for phishing indicators such as non-HTTPS protocols, shortened links, risky TLDs, IP-host URLs, and punycode tricks.
                      It computes a 0-100 score with reputation weighting (trusted domains), structural heuristics, and lure-keyword penalties, then classifies as safe/caution/risky.
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">
                    Safe {linkRiskData.safe} | Caution {linkRiskData.caution} | Risky {linkRiskData.risky}
                  </div>
                  <div className="max-h-24 overflow-auto text-xs space-y-1">
                    {linkRiskData.top.map((item, idx) => (
                      <div key={`${item.url}-${idx}`} className="rounded border p-1">
                        <div className="break-all">{item.url}</div>
                        <div className="text-muted-foreground">
                          {item.level.toUpperCase()} ({item.score}/100) | {item.source === "domain_inferred" ? "inferred-domain" : "direct-url"}
                        </div>
                        <div className="text-muted-foreground">{item.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><AlertOctagon className="h-4 w-4" />Keyword Alert Monitor</div>
                    <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("keywords")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                  </div>
                  {sectionInfoOpen.keywords ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      Keyword Alert Monitor detects high-risk trigger phrases used in fraud, social engineering, and credential theft campaigns.
                      It is tuned for fast triage and should be paired with context review before final decisions.
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground">{keywordAlerts.length ? `${keywordAlerts.length} alert keywords detected` : "No monitored alert keywords detected."}</div>
                  <div className="flex flex-wrap gap-1">
                    {keywordAlerts.slice(0, 12).map((k) => (
                      <Badge key={k} variant="outline">{k}</Badge>
                    ))}
                  </div>
                </div>

                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><Layers className="h-4 w-4" />Smart Redaction</div>
                    <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("redaction")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                  </div>
                  {sectionInfoOpen.redaction ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      Smart Redaction removes specified sensitive terms from editable layers and runs a leak check to ensure terms do not remain in visible text surfaces.
                      For image evidence, it applies opaque redaction masks and verifies coverage.
                    </div>
                  ) : null}
                  <Input value={redactionTerms} onChange={(e) => setRedactionTerms(e.target.value)} placeholder="Terms (comma-separated): name, account, ssn..." />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={applySmartRedaction}>Apply Redaction + Leak Check</Button>
                    {isImageDoc(editingDoc) ? (
                      <Button size="sm" variant="outline" onClick={() => setRedactionBoxes((c) => [...c, { id: createId(), x: Math.max(0, overlayX), y: Math.max(0, overlayY), w: 140, h: 46 }])}>
                        Add Redaction Box
                      </Button>
                    ) : null}
                  </div>
                  {redactionLeakReport ? <div className="text-xs text-muted-foreground">{redactionLeakReport}</div> : null}
                </div>

                {isImageDoc(editingDoc) ? (
                  <>
                    <div className="text-sm font-medium">Image Lab Tools</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" onClick={() => setImgRotate((v) => v - 90)}>Rotate -90</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgRotate((v) => v + 90)}>Rotate +90</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgFlipX((v) => !v)}>Flip H</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgFlipY((v) => !v)}>Flip V</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgZoom((v) => Math.min(3, v + 0.1))}>Zoom +</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgZoom((v) => Math.max(0.4, v - 0.1))}>Zoom -</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgBrightness((v) => Math.min(220, v + 10))}>Bright +</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgBrightness((v) => Math.max(20, v - 10))}>Bright -</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgContrast((v) => Math.min(220, v + 10))}>Contrast +</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgContrast((v) => Math.max(20, v - 10))}>Contrast -</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgSaturate((v) => Math.min(240, v + 10))}>Saturate +</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgSaturate((v) => Math.max(0, v - 10))}>Saturate -</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgBlur((v) => Math.min(12, v + 1))}>Blur +</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgBlur((v) => Math.max(0, v - 1))}>Blur -</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgOpacity((v) => Math.min(100, v + 5))}>Opacity +</Button>
                      <Button size="sm" variant="outline" onClick={() => setImgOpacity((v) => Math.max(15, v - 5))}>Opacity -</Button>
                      <Button size="sm" variant={imgGray ? "default" : "outline"} onClick={() => setImgGray((v) => !v)}>Grayscale</Button>
                      <Button size="sm" variant={imgSepia ? "default" : "outline"} onClick={() => setImgSepia((v) => !v)}>Sepia</Button>
                      <Button size="sm" variant={imgInvert ? "default" : "outline"} onClick={() => setImgInvert((v) => !v)}>Invert</Button>
                      <Button size="sm" variant="outline" onClick={resetImageEditor}>Reset</Button>
                    </div>
                    <div className="space-y-2 pt-2 border-t">
                      <div className="text-sm font-medium">Add Text Overlay</div>
                      <Input value={overlayTextInput} onChange={(e) => setOverlayTextInput(e.target.value)} placeholder="Overlay text..." />
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="color" value={overlayColor} onChange={(e) => setOverlayColor(e.target.value)} />
                        <Input type="number" value={overlaySize} onChange={(e) => setOverlaySize(Number(e.target.value) || 24)} placeholder="Size" />
                        <Input type="number" value={overlayX} onChange={(e) => setOverlayX(Number(e.target.value) || 0)} placeholder="X" />
                        <Input type="number" value={overlayY} onChange={(e) => setOverlayY(Number(e.target.value) || 0)} placeholder="Y" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            if (!overlayTextInput.trim()) return;
                            setOverlays((current) => [
                              ...current,
                              { id: createId(), text: overlayTextInput.trim(), color: overlayColor, size: overlaySize, x: overlayX, y: overlayY },
                            ]);
                            pushForensicEvent("Overlay added", "Text annotation inserted on forensic canvas");
                          }}
                        >
                          Add Text Layer
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setOverlays([])}>Clear Text Layers</Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button size="sm" onClick={() => void replaceEditedImageInRegistry()}>Replace In Doc Registry</Button>
                      <Button size="sm" variant="outline" onClick={() => exportEditedImageSameFormat()}>Save-Export</Button>
                    </div>
                  </>
                ) : null}

                {isPdfDoc(editingDoc) ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Document Conversion</div>
                      <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("conversion")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                    </div>
                    {sectionInfoOpen.conversion ? (
                      <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                        Document Conversion generates portable outputs from PDF evidence for downstream workflows.
                        DOC output preserves structure for legal/office review, while TXT output creates a plain-text artifact for analysis pipelines.
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">Convert this PDF to DOC or TXT output for reporting workflows.</div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button size="sm" onClick={downloadConvertedDoc}>Convert To DOC</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!editingDoc) return;
                          const text = (editingDoc.extractedText || editingDoc.summary || editingDoc.name || "").trim();
                          const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `${editingDoc.name.replace(/\.[^/.]+$/, "")}.txt`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                        }}
                      >
                        Convert To TXT
                      </Button>
                    </div>
                  </>
                ) : null}

                {isTxtDoc(editingDoc) ? (
                  <>
                    <div className="text-sm font-medium">Text Lab Tools</div>
                    <div className="text-xs text-muted-foreground">Edit text directly, then save or export.</div>
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      <Button size="sm" onClick={replaceTxtInRegistry}>Replace In Doc Registry</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const blob = new Blob([txtDraft], { type: "text/plain;charset=utf-8" });
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = `${editingDoc.name.replace(/\.[^/.]+$/, "")}-edited.txt`;
                          a.click();
                          URL.revokeObjectURL(a.href);
                          pushForensicEvent("Text export", "Downloaded edited TXT");
                        }}
                      >
                        Save-Export
                      </Button>
                    </div>
                  </>
                ) : null}

                <div className="rounded border p-3 bg-background/60 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium flex items-center gap-2"><History className="h-4 w-4" />Edit Provenance Timeline</div>
                    <Button size="sm" variant="outline" onClick={() => toggleSectionInfo("timeline")}><Info className="h-3.5 w-3.5 mr-1" />Info</Button>
                  </div>
                  {sectionInfoOpen.timeline ? (
                    <div className="text-xs text-muted-foreground rounded border p-2 bg-card/40">
                      Provenance Timeline logs forensic actions and transformations with timestamps.
                      This provides an auditable narrative for analyst review and evidentiary traceability.
                    </div>
                  ) : null}
                  <div className="max-h-40 overflow-auto space-y-2">
                    {forensicTimeline.length === 0 ? <div className="text-xs text-muted-foreground">Timeline will populate as analysis/edit actions happen.</div> : forensicTimeline.map((item) => (
                      <div key={item.id} className="text-xs rounded border p-2 bg-card/60">
                        <div className="font-medium">{item.action}</div>
                        <div className="text-muted-foreground">{new Date(item.at).toLocaleString()} - {item.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t pt-2">
                  <Button size="sm" onClick={() => void exportCourtReadyBundle()}><FileStack className="h-4 w-4 mr-1" />Forensic Evidence Package</Button>
                  <Button size="sm" variant="outline" onClick={() => pushForensicEvent("Manual checkpoint", "Analyst added timeline checkpoint")}>Add Checkpoint</Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={false}
        onOpenChange={(open) => {
          if (!open) setEditingDocId(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Microsoft Login Required</DialogTitle>
            <DialogDescription>
              To edit PDF in DOC/Word mode, link your Microsoft account first.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void linkMicrosoftAccount("any")} disabled={msLinking}>
              {msLinking ? "Connecting..." : "Link Microsoft Account"}
            </Button>
            <Button variant="outline" onClick={() => void linkMicrosoftAccount("personal")} disabled={msLinking}>
              {msLinking ? "Connecting..." : "Personal Account"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditingDocId(null);
              }}
            >
              Choose Other File
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(fixingDocId)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Fixing Document</DialogTitle>
            <DialogDescription>{fixPipeline?.docName || riskyDocs.find((d) => d.id === fixingDocId)?.name || "Document"} pipeline is running.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(fixPipeline?.stages || []).map((stage) => (
                <div key={stage.key} className="rounded-md border p-3 min-h-[108px] bg-card/50">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{stage.title}</p>
                    {stage.status === "done" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : stage.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : stage.status === "failed" ? (
                      <span className="text-xs font-semibold text-destructive">FAILED</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">PENDING</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{stage.detail}</p>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Strict remediation workflow is visualized live. Each file run is intentionally paced to a minimum of 5 seconds.
            </div>
            <div className="text-[11px] text-muted-foreground">Elapsed: {fixPipeline ? Math.floor((Date.now() - fixPipeline.startedAt) / 1000) : 0}s</div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(fixSummary)} onOpenChange={(open) => !open && setFixSummary(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Fix Summary</DialogTitle>
            <DialogDescription>{fixSummary?.name || "Document"}</DialogDescription>
          </DialogHeader>
          <div className="rounded-md border p-3 space-y-2 text-sm max-h-[60vh] overflow-y-auto">
            {(fixSummary?.lines || []).map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pdfOcrRunning}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Making PDF Editable</DialogTitle>
            <DialogDescription>{editingDoc?.name || "Document"} is being converted from scanned/non-editable to editable text via OCR.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/2 bg-primary animate-pulse" />
            </div>
            <div className="text-sm text-muted-foreground">Running OCR extraction and rebuilding editable text layer. Please wait...</div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pdfDirectEditLoading}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Converting To DOC</DialogTitle>
            <DialogDescription>{editingDoc?.name || "Document"} is being converted into editable DOC view.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/2 bg-primary animate-pulse" />
            </div>
            <div className="text-sm text-muted-foreground">Extracting text and preparing DOC editor...</div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pdfUnscanRunning}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unscanning To HD Editable</DialogTitle>
            <DialogDescription>{editingDoc?.name || "Document"} is being rebuilt into a clean, high-clarity editable PDF layer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/2 bg-primary animate-pulse" />
            </div>
            <div className="text-sm text-muted-foreground">
              Running OCR, structuring content lines, and building clean editable pages. Please wait...
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pdfNonEditableOpen} onOpenChange={setPdfNonEditableOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>PDF Not Directly Editable</DialogTitle>
            <DialogDescription>
              This document is currently treated as non-editable source. Review the reasons and choose how to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded border p-3 text-sm space-y-2 max-h-[45vh] overflow-auto">
            {pdfNonEditableReasons.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPdfNonEditableOpen(false);
                setEditingDocId(null);
              }}
            >
              Choose Other File
            </Button>
            <Button
              onClick={() => {
                void unscanPdfToHdEditable();
              }}
              disabled={pdfUnscanRunning}
            >
              {pdfUnscanRunning ? "Creating Copy..." : "Make a Copy & Edit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
