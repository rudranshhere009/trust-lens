import type { InsideDocumentRecord } from "@/utils/insideDocumentsData";

export type ForensicHotspot = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
};

export type ForensicMetadataFlag = {
  label: string;
  value: string;
  severity: "info" | "warning" | "critical";
};

export type ForensicBreakdown = {
  label: string;
  weight: number;
  detail: string;
};

export type ForensicSnapshot = {
  generatedAt: number;
  authenticityScore: number;
  hotspots: ForensicHotspot[];
  cloneSignals: number;
  tamperSignal: number;
  metadataFlags: ForensicMetadataFlag[];
  breakdown: ForensicBreakdown[];
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const sampleGray = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => {
  const idx = (y * width + x) * 4;
  return pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
};

export const analyzeCanvasForensics = (canvas: HTMLCanvasElement): {
  hotspots: ForensicHotspot[];
  cloneSignals: number;
  tamperSignal: number;
} => {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { hotspots: [], cloneSignals: 0, tamperSignal: 0 };
  const { width, height } = canvas;
  if (!width || !height) return { hotspots: [], cloneSignals: 0, tamperSignal: 0 };

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const cell = Math.max(18, Math.floor(Math.min(width, height) / 18));
  const cells: Array<{ x: number; y: number; w: number; h: number; score: number }> = [];

  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      const w = Math.min(cell, width - x);
      const h = Math.min(cell, height - y);
      let sum = 0;
      let sumSq = 0;
      let count = 0;
      for (let py = y; py < y + h; py += 2) {
        for (let px = x; px < x + w; px += 2) {
          const g = sampleGray(pixels, width, px, py);
          sum += g;
          sumSq += g * g;
          count += 1;
        }
      }
      if (!count) continue;
      const mean = sum / count;
      const variance = Math.max(0, sumSq / count - mean * mean);
      cells.push({ x, y, w, h, score: variance });
    }
  }

  const avg = cells.reduce((acc, c) => acc + c.score, 0) / Math.max(1, cells.length);
  const std = Math.sqrt(cells.reduce((acc, c) => acc + (c.score - avg) ** 2, 0) / Math.max(1, cells.length));
  const hotspots = cells
    .filter((c) => c.score > avg + std * 1.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 18)
    .map((c, i) => ({
      id: `hot-${i}`,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      confidence: clamp((c.score - avg) / Math.max(1, std * 3), 0.08, 0.99),
    }));

  const block = Math.max(10, Math.floor(Math.min(width, height) / 40));
  const signatures = new Map<string, Array<{ x: number; y: number }>>();
  for (let y = 0; y < height - block; y += block) {
    for (let x = 0; x < width - block; x += block) {
      let p1 = 0;
      let p2 = 0;
      let p3 = 0;
      let c = 0;
      for (let i = 0; i < 6; i += 1) {
        const sx = x + Math.floor((i / 6) * (block - 1));
        const sy = y + Math.floor(((5 - i) / 6) * (block - 1));
        const g = sampleGray(pixels, width, sx, sy);
        p1 += g;
        p2 += (g * (i + 3)) % 255;
        p3 += (g * (i + 7)) % 127;
        c += 1;
      }
      const key = `${Math.round(p1 / c / 8)}-${Math.round(p2 / c / 8)}-${Math.round(p3 / c / 8)}`;
      const arr = signatures.get(key) || [];
      arr.push({ x, y });
      signatures.set(key, arr);
    }
  }

  let cloneSignals = 0;
  signatures.forEach((arr) => {
    if (arr.length < 2 || arr.length > 8) return;
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        const dx = Math.abs(arr[i].x - arr[j].x);
        const dy = Math.abs(arr[i].y - arr[j].y);
        if (dx + dy > block * 3) cloneSignals += 1;
      }
    }
  });

  const tamperSignal = clamp(hotspots.length * 4 + cloneSignals * 6, 0, 100);
  return { hotspots, cloneSignals, tamperSignal };
};

const getSourceMime = (doc: InsideDocumentRecord) => (doc.sourceMime || doc.type || "application/octet-stream").toLowerCase();

export const readDataUrlBytes = async (dataUrl: string) => {
  if (!dataUrl) return new Uint8Array();
  const res = await fetch(dataUrl);
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
};

const sniffExifStrings = (bytes: Uint8Array) => {
  const sample = bytes.slice(0, Math.min(bytes.length, 320000));
  const text = new TextDecoder("latin1").decode(sample);
  const software = text.match(/(Adobe Photoshop|GIMP|Canva|Snapseed|Lightroom|Pixelmator|Affinity Photo)/i)?.[1] || "";
  const camera = text.match(/(Canon|Nikon|Sony|FUJIFILM|SAMSUNG|Apple|Google Pixel|OnePlus)/i)?.[1] || "";
  const datetime = text.match(/20\d{2}[:-]\d{2}[:-]\d{2}[ T]\d{2}:\d{2}:\d{2}/)?.[0] || "";
  return { software, camera, datetime };
};

const readU16 = (data: Uint8Array, offset: number, little: boolean) => {
  if (offset + 2 > data.length) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint16(offset, little);
};

const readU32 = (data: Uint8Array, offset: number, little: boolean) => {
  if (offset + 4 > data.length) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(offset, little);
};

const readAscii = (data: Uint8Array, offset: number, len: number) => {
  if (offset < 0 || offset >= data.length) return "";
  const end = Math.min(data.length, offset + len);
  let out = "";
  for (let i = offset; i < end; i += 1) {
    if (data[i] === 0) break;
    out += String.fromCharCode(data[i]);
  }
  return out.trim();
};

const typeSize = (type: number) => {
  if (type === 1 || type === 2 || type === 7) return 1;
  if (type === 3) return 2;
  if (type === 4 || type === 9) return 4;
  if (type === 5 || type === 10) return 8;
  return 1;
};

const parseRational = (data: Uint8Array, offset: number, little: boolean) => {
  const n = readU32(data, offset, little);
  const d = readU32(data, offset + 4, little);
  if (!d) return 0;
  return n / d;
};

const parseGpsCoord = (arr: number[], ref: string) => {
  if (arr.length < 3) return "";
  const value = arr[0] + arr[1] / 60 + arr[2] / 3600;
  const sign = ref === "S" || ref === "W" ? -1 : 1;
  return (value * sign).toFixed(6);
};

type ParsedImageMeta = {
  make: string;
  model: string;
  software: string;
  dateTime: string;
  dateTimeOriginal: string;
  gpsLat: string;
  gpsLon: string;
  rawTags: string[];
};

const emptyParsedImageMeta = (): ParsedImageMeta => ({
  make: "",
  model: "",
  software: "",
  dateTime: "",
  dateTimeOriginal: "",
  gpsLat: "",
  gpsLon: "",
  rawTags: [],
});

const parseTiffExif = (data: Uint8Array, tiffStart = 0): ParsedImageMeta => {
  const result = emptyParsedImageMeta();
  if (tiffStart + 8 > data.length) return result;
  const b1 = String.fromCharCode(data[tiffStart]);
  const b2 = String.fromCharCode(data[tiffStart + 1]);
  const little = b1 === "I" && b2 === "I";
  const big = b1 === "M" && b2 === "M";
  if (!little && !big) return result;
  const marker = readU16(data, tiffStart + 2, little);
  if (marker !== 0x002a) return result;
  const ifd0Offset = readU32(data, tiffStart + 4, little);

  const readTagValue = (type: number, count: number, valueOffset: number, base: number) => {
    const size = typeSize(type) * count;
    const dataOffset = size <= 4 ? base : tiffStart + valueOffset;
    if (dataOffset < 0 || dataOffset >= data.length) return "";
    if (type === 2) return readAscii(data, dataOffset, count);
    if (type === 3) return String(readU16(data, dataOffset, little));
    if (type === 4) return String(readU32(data, dataOffset, little));
    if (type === 5) return String(parseRational(data, dataOffset, little));
    return "";
  };

  const parseIfd = (offset: number) => {
    const ifdAbs = tiffStart + offset;
    if (ifdAbs + 2 > data.length) return { exifPtr: 0, gpsPtr: 0 };
    const count = readU16(data, ifdAbs, little);
    let exifPtr = 0;
    let gpsPtr = 0;
    for (let i = 0; i < count; i += 1) {
      const entry = ifdAbs + 2 + i * 12;
      if (entry + 12 > data.length) break;
      const tag = readU16(data, entry, little);
      const type = readU16(data, entry + 2, little);
      const num = readU32(data, entry + 4, little);
      const valueOffset = readU32(data, entry + 8, little);
      const value = readTagValue(type, num, valueOffset, entry + 8);
      if (value) result.rawTags.push(`0x${tag.toString(16)}=${value}`);
      if (tag === 0x010f && value) result.make = value;
      if (tag === 0x0110 && value) result.model = value;
      if (tag === 0x0131 && value) result.software = value;
      if (tag === 0x0132 && value) result.dateTime = value;
      if (tag === 0x8769) exifPtr = valueOffset;
      if (tag === 0x8825) gpsPtr = valueOffset;
    }
    return { exifPtr, gpsPtr };
  };

  const parseExifIfd = (offset: number) => {
    if (!offset) return;
    const ifdAbs = tiffStart + offset;
    if (ifdAbs + 2 > data.length) return;
    const count = readU16(data, ifdAbs, little);
    for (let i = 0; i < count; i += 1) {
      const entry = ifdAbs + 2 + i * 12;
      if (entry + 12 > data.length) break;
      const tag = readU16(data, entry, little);
      const type = readU16(data, entry + 2, little);
      const num = readU32(data, entry + 4, little);
      const valueOffset = readU32(data, entry + 8, little);
      const value = readTagValue(type, num, valueOffset, entry + 8);
      if (value) result.rawTags.push(`0x${tag.toString(16)}=${value}`);
      if (tag === 0x9003 && value) result.dateTimeOriginal = value;
      if (tag === 0x0131 && value && !result.software) result.software = value;
    }
  };

  const parseGpsIfd = (offset: number) => {
    if (!offset) return;
    const ifdAbs = tiffStart + offset;
    if (ifdAbs + 2 > data.length) return;
    const count = readU16(data, ifdAbs, little);
    let latRef = "";
    let lonRef = "";
    let latVals: number[] = [];
    let lonVals: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = ifdAbs + 2 + i * 12;
      if (entry + 12 > data.length) break;
      const tag = readU16(data, entry, little);
      const type = readU16(data, entry + 2, little);
      const num = readU32(data, entry + 4, little);
      const valueOffset = readU32(data, entry + 8, little);
      if (tag === 0x0001) latRef = readTagValue(type, num, valueOffset, entry + 8);
      if (tag === 0x0003) lonRef = readTagValue(type, num, valueOffset, entry + 8);
      if (tag === 0x0002) {
        const base = tiffStart + valueOffset;
        latVals = [parseRational(data, base, little), parseRational(data, base + 8, little), parseRational(data, base + 16, little)];
      }
      if (tag === 0x0004) {
        const base = tiffStart + valueOffset;
        lonVals = [parseRational(data, base, little), parseRational(data, base + 8, little), parseRational(data, base + 16, little)];
      }
    }
    result.gpsLat = parseGpsCoord(latVals, latRef);
    result.gpsLon = parseGpsCoord(lonVals, lonRef);
  };

  const { exifPtr, gpsPtr } = parseIfd(ifd0Offset);
  parseExifIfd(exifPtr);
  parseGpsIfd(gpsPtr);
  result.rawTags = Array.from(new Set(result.rawTags)).slice(0, 30);
  return result;
};

const parseJpegExif = (bytes: Uint8Array): ParsedImageMeta => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return emptyParsedImageMeta();
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = (bytes[i + 2] << 8) | bytes[i + 3];
    if (size < 2 || i + 2 + size > bytes.length) break;
    if (marker === 0xe1) {
      const segStart = i + 4;
      const isExif = readAscii(bytes, segStart, 6) === "Exif";
      if (isExif) return parseTiffExif(bytes, segStart + 6);
    }
    i += 2 + size;
  }
  return emptyParsedImageMeta();
};

const parseWebpExif = (bytes: Uint8Array): ParsedImageMeta => {
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") return emptyParsedImageMeta();
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const chunk = readAscii(bytes, pos, 4);
    const size = readU32(bytes, pos + 4, true);
    const dataStart = pos + 8;
    if (chunk === "EXIF" && dataStart + size <= bytes.length) {
      if (readAscii(bytes, dataStart, 6) === "Exif") return parseTiffExif(bytes, dataStart + 6);
      return parseTiffExif(bytes, dataStart);
    }
    pos = dataStart + size + (size % 2);
  }
  return emptyParsedImageMeta();
};

const parsePngTextMeta = (bytes: Uint8Array) => {
  const out: Array<{ key: string; value: string }> = [];
  if (bytes.length < 24) return out;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return out;
  }
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = readU32(bytes, pos, false);
    const type = readAscii(bytes, pos + 4, 4);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (type === "tEXt" || type === "iTXt") {
      const raw = readAscii(bytes, dataStart, length);
      const sep = raw.indexOf("\u0000");
      if (sep > 0) out.push({ key: raw.slice(0, sep), value: raw.slice(sep + 1) });
    }
    pos = dataEnd + 4;
    if (type === "IEND") break;
  }
  return out.slice(0, 20);
};

export const getDocumentMetadataFlags = async (doc: InsideDocumentRecord): Promise<ForensicMetadataFlag[]> => {
  const flags: ForensicMetadataFlag[] = [];
  const mime = getSourceMime(doc);
  const lower = doc.name.toLowerCase();

  if (lower.endsWith(".pdf") && mime !== "application/pdf") {
    flags.push({ label: "Container mismatch", value: `${lower.split(".").pop()} vs ${mime}`, severity: "critical" });
  }
  if ((lower.endsWith(".jpg") || lower.endsWith(".jpeg")) && !mime.includes("jpeg")) {
    flags.push({ label: "Extension mismatch", value: `${lower.split(".").pop()} vs ${mime}`, severity: "warning" });
  }

  if (mime.startsWith("image/") && doc.sourceDataUrl) {
    const bytes = await readDataUrlBytes(doc.sourceDataUrl);
    const parsedJpeg = mime.includes("jpeg") || mime.includes("jpg") ? parseJpegExif(bytes) : emptyParsedImageMeta();
    const parsedWebp = mime.includes("webp") ? parseWebpExif(bytes) : emptyParsedImageMeta();
    const parsed = {
      ...emptyParsedImageMeta(),
      ...parsedJpeg,
      ...parsedWebp,
      rawTags: Array.from(new Set([...(parsedJpeg.rawTags || []), ...(parsedWebp.rawTags || [])])).slice(0, 30),
    };
    const pngTextMeta = mime.includes("png") ? parsePngTextMeta(bytes) : [];
    const exif = sniffExifStrings(bytes);
    const embeddedSoftware = parsed.software || exif.software || pngTextMeta.find((x) => /software/i.test(x.key))?.value || "";
    const embeddedCamera = [parsed.make, parsed.model].filter(Boolean).join(" ").trim() || exif.camera;
    const embeddedTime = parsed.dateTimeOriginal || parsed.dateTime || exif.datetime || pngTextMeta.find((x) => /(time|date|creation)/i.test(x.key))?.value || "";
    const hasEmbedded = Boolean(embeddedSoftware || embeddedCamera || embeddedTime || parsed.gpsLat || parsed.rawTags.length);
    const strippedLikelihood = hasEmbedded ? 8 : mime.includes("jpeg") || mime.includes("heic") || mime.includes("heif") ? 88 : 52;

    flags.push({ label: "File size", value: `${Math.max(1, Math.round(doc.size / 1024))} KB`, severity: "info" });
    flags.push({ label: "Metadata source", value: hasEmbedded ? "Embedded EXIF/text" : "Filesystem-only context", severity: hasEmbedded ? "info" : "warning" });
    flags.push({ label: "Filesystem ingest time", value: new Date(doc.uploadedAt).toISOString(), severity: "info" });
    flags.push({ label: "Capture brand", value: embeddedCamera || "Unknown", severity: embeddedCamera ? "info" : "warning" });
    flags.push({ label: "Editing software", value: embeddedSoftware || "Not declared", severity: embeddedSoftware ? "warning" : "info" });
    flags.push({ label: "Embedded capture time", value: embeddedTime || "Unavailable", severity: embeddedTime ? "info" : "warning" });
    flags.push({ label: "GPS (embedded)", value: parsed.gpsLat && parsed.gpsLon ? `${parsed.gpsLat}, ${parsed.gpsLon}` : "Unavailable", severity: parsed.gpsLat && parsed.gpsLon ? "warning" : "info" });
    if (parsed.rawTags.length) {
      flags.push({ label: "Raw EXIF tag sample", value: parsed.rawTags.slice(0, 4).join(" | "), severity: "info" });
    }
    if (pngTextMeta.length) {
      flags.push({ label: "PNG text metadata", value: pngTextMeta.slice(0, 3).map((x) => `${x.key}=${x.value}`).join(" | "), severity: "info" });
    }
    flags.push({
      label: "Metadata stripped likelihood",
      value: `${strippedLikelihood}%`,
      severity: strippedLikelihood >= 75 ? "warning" : "info",
    });
    if (embeddedSoftware && embeddedCamera && /adobe|photoshop|lightroom|canva|gimp/i.test(embeddedSoftware)) {
      flags.push({ label: "Render chain jump", value: `${embeddedCamera} -> ${embeddedSoftware}`, severity: "warning" });
    }
  } else if (mime === "application/pdf" && doc.sourceDataUrl) {
    try {
      let pdfjs: { getDocument: (params: { data: Uint8Array }) => { promise: Promise<unknown> }; GlobalWorkerOptions?: { workerSrc?: string } };
      try {
        pdfjs = (await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs")) as typeof pdfjs;
      } catch {
        pdfjs = (await import(/* @vite-ignore */ "pdfjs-dist")) as typeof pdfjs;
      }
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
      } catch {
        // no-op
      }
      const bytes = await readDataUrlBytes(doc.sourceDataUrl);
      const task = pdfjs.getDocument({ data: bytes });
      const pdf = (await task.promise) as { numPages?: number; getMetadata: () => Promise<{ info?: Record<string, unknown> }> };
      const md = await pdf.getMetadata();
      const info = md?.info || {};
      flags.push({ label: "PDF pages", value: String(pdf.numPages || doc.pagesAnalyzed || 1), severity: "info" });
      flags.push({ label: "Producer", value: String(info.Producer || "Unknown"), severity: info.Producer ? "info" : "warning" });
      flags.push({ label: "Creator", value: String(info.Creator || "Unknown"), severity: info.Creator ? "info" : "warning" });
      flags.push({ label: "PDF version", value: String(info.PDFFormatVersion || "Unknown"), severity: "info" });
      if (String(info.Producer || "").match(/(Word|InDesign|Photoshop|Canva|Acrobat)/i)) {
        flags.push({ label: "Producer chain anomaly", value: String(info.Producer), severity: "warning" });
      }
    } catch {
      flags.push({ label: "Metadata parse", value: "Failed to parse PDF metadata", severity: "warning" });
    }
  } else {
    flags.push({ label: "Source type", value: mime, severity: "info" });
    flags.push({ label: "Uploaded", value: new Date(doc.uploadedAt).toISOString(), severity: "info" });
  }

  return flags;
};

export const computeAuthenticity = (input: {
  tamperSignal: number;
  cloneSignals: number;
  metadataFlags: ForensicMetadataFlag[];
  editCount: number;
}) => {
  const metadataPenalty = input.metadataFlags.reduce((acc, f) => {
    if (f.severity === "critical") return acc + 12;
    if (f.severity === "warning") return acc + 6;
    return acc + 1;
  }, 0);

  const tamperPenalty = Math.round(input.tamperSignal * 0.42);
  const clonePenalty = Math.min(28, input.cloneSignals * 7);
  const editPenalty = Math.min(16, input.editCount * 2);

  const score = clamp(100 - tamperPenalty - clonePenalty - metadataPenalty - editPenalty, 1, 99);
  const breakdown: ForensicBreakdown[] = [
    { label: "Lighting/Noise inconsistency", weight: tamperPenalty, detail: `${input.tamperSignal}% tamper signal from regional variance scan` },
    { label: "Clone/Splice probability", weight: clonePenalty, detail: `${input.cloneSignals} duplicate-block pattern matches` },
    { label: "Metadata anomalies", weight: metadataPenalty, detail: `${input.metadataFlags.filter((f) => f.severity !== "info").length} suspicious metadata flags` },
    { label: "Post-capture edits", weight: editPenalty, detail: `${input.editCount} tracked editor actions` },
  ];

  return { score, breakdown };
};

export const deriveCompareView = (source: string, mode: "normal" | "pixel" | "edge" | "frequency") => {
  if (!source || mode === "normal") return source;
  return source;
};

export const sha256Hex = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
