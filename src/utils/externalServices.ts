export interface SearchEvidence {
  title: string;
  url: string;
  snippet: string;
  source: "wikipedia" | "duckduckgo" | "web";
}

export interface IntegrationSettings {
  ocrProvider: "local" | "ocrspace" | "custom";
  ocrLanguage: string;
  ocrSpaceApiKey: string;
  ocrCustomEndpoint: string;
  ocrCustomApiKey: string;
  ocrEngineProfile: "speed" | "balanced" | "accuracy";
  ocrPreprocessImages: boolean;
  ocrUpscale: number;
  ocrRetries: number;
  ocrTimeoutMs: number;
  ocrMinConfidence: number;
  ocrCustomRequestMode: "multipart" | "json-base64";
  ocrCustomApiKeyHeader: string;
  ocrCustomExtraHeadersJson: string;
  ocrCustomTextPath: string;
  ocrCustomConfidencePath: string;
  webSearchProvider: "hybrid" | "custom";
  webSearchApiKey: string;
  webSearchCustomEndpoint: string;
}

export interface OcrResult {
  text: string;
  confidence: number;
  provider: "local" | "ocrspace" | "custom" | "none";
  durationMs?: number;
  attempts?: number;
}

const INTEGRATION_KEY = "trustlens_integration_settings";

const defaults: IntegrationSettings = {
  ocrProvider: "local",
  ocrLanguage: "eng",
  ocrSpaceApiKey: "",
  ocrCustomEndpoint: "",
  ocrCustomApiKey: "",
  ocrEngineProfile: "accuracy",
  ocrPreprocessImages: true,
  ocrUpscale: 2.2,
  ocrRetries: 4,
  ocrTimeoutMs: 60000,
  ocrMinConfidence: 45,
  ocrCustomRequestMode: "multipart",
  ocrCustomApiKeyHeader: "x-api-key",
  ocrCustomExtraHeadersJson: "",
  ocrCustomTextPath: "text",
  ocrCustomConfidencePath: "confidence",
  webSearchProvider: "hybrid",
  webSearchApiKey: "",
  webSearchCustomEndpoint: "",
};

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const timeoutSignal = (ms: number) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

const safeFetchJson = async <T,>(url: string, ms = 9000): Promise<T | null> => {
  try {
    const res = await fetch(url, { signal: timeoutSignal(ms) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
};

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

const readByPath = (source: unknown, path: string): unknown => {
  if (!path.trim()) return undefined;
  const parts = path.split(".").map((x) => x.trim()).filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
};

const normalizeIntegrationSettings = (raw: Partial<IntegrationSettings>): IntegrationSettings => ({
  ...defaults,
  ...raw,
  ocrProvider: raw.ocrProvider === "custom" || raw.ocrProvider === "ocrspace" || raw.ocrProvider === "local" ? raw.ocrProvider : defaults.ocrProvider,
  ocrEngineProfile:
    raw.ocrEngineProfile === "speed" || raw.ocrEngineProfile === "balanced" || raw.ocrEngineProfile === "accuracy"
      ? raw.ocrEngineProfile
      : defaults.ocrEngineProfile,
  ocrCustomRequestMode: raw.ocrCustomRequestMode === "json-base64" ? "json-base64" : "multipart",
  ocrUpscale: clamp(Number(raw.ocrUpscale) || defaults.ocrUpscale, 1, 3),
  ocrRetries: clamp(Math.round(Number(raw.ocrRetries) || defaults.ocrRetries), 0, 5),
  ocrTimeoutMs: clamp(Math.round(Number(raw.ocrTimeoutMs) || defaults.ocrTimeoutMs), 5000, 120000),
  ocrMinConfidence: clamp(Math.round(Number(raw.ocrMinConfidence) || defaults.ocrMinConfidence), 0, 100),
  ocrPreprocessImages: typeof raw.ocrPreprocessImages === "boolean" ? raw.ocrPreprocessImages : defaults.ocrPreprocessImages,
  ocrCustomApiKeyHeader: (raw.ocrCustomApiKeyHeader || defaults.ocrCustomApiKeyHeader).trim() || defaults.ocrCustomApiKeyHeader,
});

export const loadIntegrationSettings = (): IntegrationSettings => {
  try {
    const raw = localStorage.getItem(INTEGRATION_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<IntegrationSettings>;
    return normalizeIntegrationSettings(parsed);
  } catch {
    return defaults;
  }
};

export const saveIntegrationSettings = (settings: IntegrationSettings) => {
  localStorage.setItem(INTEGRATION_KEY, JSON.stringify(normalizeIntegrationSettings(settings)));
};

const parseHeadersJson = (json: string) => {
  if (!json.trim()) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.trim()) continue;
      if (value === null || value === undefined) continue;
      clean[key] = String(value);
    }
    return clean;
  } catch {
    return {} as Record<string, string>;
  }
};

const blobToBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
};

const loadImageElement = async (blob: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });

const preprocessImageBlob = async (
  blob: Blob,
  options: { upscale: number; profile: IntegrationSettings["ocrEngineProfile"] }
): Promise<Blob | null> => {
  try {
    const img = await loadImageElement(blob);
    const scale = clamp(options.upscale, 1, 3);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = frame.data;

    let avg = 0;
    for (let i = 0; i < data.length; i += 4) {
      avg += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const mean = avg / (data.length / 4);

    const contrast = options.profile === "accuracy" ? 1.5 : options.profile === "balanced" ? 1.25 : 1.1;
    const threshold = clamp(mean, 90, 170);

    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      let value = (gray - 128) * contrast + 128;
      if (options.profile === "accuracy") {
        value = value > threshold ? 255 : 0;
      }
      const px = clamp(Math.round(value), 0, 255);
      data[i] = px;
      data[i + 1] = px;
      data[i + 2] = px;
    }

    ctx.putImageData(frame, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png", 1));
  } catch {
    return null;
  }
};

let tesseractModulePromise: Promise<any> | null = null;

const getTesseract = async () => {
  if (!tesseractModulePromise) {
    const moduleName = "tesseract.js";
    tesseractModulePromise = import(/* @vite-ignore */ moduleName);
  }
  return await tesseractModulePromise;
};

const runSingleTesseract = async (blob: Blob, language: string) => {
  const tesseract = await getTesseract();
  const { data } = await tesseract.recognize(blob, language || "eng", {
    logger: () => {},
  });
  return {
    text: normalize(String(data?.text || "")),
    confidence: typeof data?.confidence === "number" ? data.confidence : 0,
  };
};

const localTesseractOcr = async (blob: Blob, settings: IntegrationSettings): Promise<OcrResult | null> => {
  const start = Date.now();
  try {
    const variants: Blob[] = [blob];
    if (settings.ocrPreprocessImages) {
      const tuned = await preprocessImageBlob(blob, { upscale: settings.ocrUpscale, profile: settings.ocrEngineProfile });
      if (tuned) variants.push(tuned);

      if (settings.ocrEngineProfile === "accuracy") {
        const strong = await preprocessImageBlob(blob, { upscale: clamp(settings.ocrUpscale + 0.5, 1, 3), profile: "accuracy" });
        if (strong) variants.push(strong);
        const soft = await preprocessImageBlob(blob, { upscale: clamp(settings.ocrUpscale - 0.3, 1, 3), profile: "balanced" });
        if (soft) variants.push(soft);
      }
    }

    const maxAttempts = clamp(settings.ocrRetries + 1, 1, 6);
    let bestText = "";
    let bestConfidence = 0;
    let attempts = 0;

    for (let i = 0; i < variants.length && attempts < maxAttempts; i += 1) {
      attempts += 1;
      const result = await runSingleTesseract(variants[i], settings.ocrLanguage || "eng");
      const score = result.confidence + Math.min(10, result.text.length / 300);
      const bestScore = bestConfidence + Math.min(10, bestText.length / 300);
      if (score > bestScore) {
        bestText = result.text;
        bestConfidence = result.confidence;
      }
      if (result.text.length > 20 && result.confidence >= settings.ocrMinConfidence) {
        bestText = result.text;
        bestConfidence = result.confidence;
        break;
      }
    }

    for (let i = attempts; i < maxAttempts; i += 1) {
      attempts += 1;
      const result = await runSingleTesseract(variants[variants.length - 1], settings.ocrLanguage || "eng");
      const score = result.confidence + Math.min(10, result.text.length / 300);
      const bestScore = bestConfidence + Math.min(10, bestText.length / 300);
      if (score > bestScore) {
        bestText = result.text;
        bestConfidence = result.confidence;
      }
      if (result.text.length > 20 && result.confidence >= settings.ocrMinConfidence) {
        bestText = result.text;
        bestConfidence = result.confidence;
        break;
      }
    }

    return {
      text: bestText,
      confidence: clamp(bestConfidence, 0, 100),
      provider: "local",
      durationMs: Date.now() - start,
      attempts,
    };
  } catch {
    return null;
  }
};

const ocrSpace = async (blob: Blob, settings: IntegrationSettings): Promise<OcrResult | null> => {
  if (!settings.ocrSpaceApiKey.trim()) return null;
  const start = Date.now();
  try {
    const fd = new FormData();
    fd.append("apikey", settings.ocrSpaceApiKey.trim());
    fd.append("language", settings.ocrLanguage || "eng");
    fd.append("isOverlayRequired", "false");
    fd.append("file", blob, "scan.png");

    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: fd,
      signal: timeoutSignal(settings.ocrTimeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      ParsedResults?: Array<{ ParsedText?: string }>;
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string[] | string;
      OCRExitCode?: number;
    };
    if (data.IsErroredOnProcessing) return null;

    const text = normalize((data.ParsedResults ?? []).map((x) => x.ParsedText || "").join("\n"));
    return {
      text,
      confidence: text ? 75 : 0,
      provider: "ocrspace",
      durationMs: Date.now() - start,
      attempts: 1,
    };
  } catch {
    return null;
  }
};

const extractTextFromPayload = (payload: unknown, configuredPath: string) => {
  const fromPath = readByPath(payload, configuredPath);
  if (typeof fromPath === "string" && fromPath.trim()) return normalize(fromPath);

  const candidates = [
    readByPath(payload, "text"),
    readByPath(payload, "result.text"),
    readByPath(payload, "data.text"),
    readByPath(payload, "ocr.text"),
    readByPath(payload, "results.0.text"),
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return normalize(value);
  }
  return "";
};

const extractConfidenceFromPayload = (payload: unknown, configuredPath: string) => {
  const fromPath = readByPath(payload, configuredPath);
  if (typeof fromPath === "number") return clamp(fromPath, 0, 100);
  if (typeof fromPath === "string" && fromPath.trim() && !Number.isNaN(Number(fromPath))) return clamp(Number(fromPath), 0, 100);

  const candidates = [
    readByPath(payload, "confidence"),
    readByPath(payload, "result.confidence"),
    readByPath(payload, "data.confidence"),
    readByPath(payload, "ocr.confidence"),
  ];
  for (const value of candidates) {
    if (typeof value === "number") return clamp(value, 0, 100);
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return clamp(Number(value), 0, 100);
  }
  return 70;
};

const customOcr = async (blob: Blob, settings: IntegrationSettings): Promise<OcrResult | null> => {
  const endpoint = settings.ocrCustomEndpoint.trim();
  if (!endpoint) return null;

  const start = Date.now();
  try {
    const headers: Record<string, string> = {
      ...parseHeadersJson(settings.ocrCustomExtraHeadersJson),
    };

    const apiKey = settings.ocrCustomApiKey.trim();
    if (apiKey) {
      const headerName = settings.ocrCustomApiKeyHeader.trim() || "x-api-key";
      headers[headerName] = apiKey;
    }

    let body: BodyInit;
    if (settings.ocrCustomRequestMode === "json-base64") {
      const encoded = await blobToBase64(blob);
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        image_base64: encoded,
        mime_type: blob.type || "image/png",
        language: settings.ocrLanguage || "eng",
      });
    } else {
      const fd = new FormData();
      fd.append("file", blob, "scan.png");
      fd.append("language", settings.ocrLanguage || "eng");
      body = fd;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      body,
      headers,
      signal: timeoutSignal(settings.ocrTimeoutMs),
    });
    if (!res.ok) return null;

    const payload = (await res.json()) as unknown;
    const text = extractTextFromPayload(payload, settings.ocrCustomTextPath);
    const confidence = extractConfidenceFromPayload(payload, settings.ocrCustomConfidencePath);

    return {
      text,
      confidence,
      provider: "custom",
      durationMs: Date.now() - start,
      attempts: 1,
    };
  } catch {
    return null;
  }
};

export const runOcrFromSettings = async (blob: Blob): Promise<OcrResult> => {
  const settings = loadIntegrationSettings();
  const boostedSettings: IntegrationSettings = {
    ...settings,
    ocrEngineProfile: "accuracy",
    ocrPreprocessImages: true,
    ocrUpscale: clamp(Math.max(settings.ocrUpscale, 2.2), 1, 3),
    ocrRetries: clamp(Math.max(settings.ocrRetries, 4), 0, 5),
    ocrTimeoutMs: clamp(Math.max(settings.ocrTimeoutMs, 60000), 5000, 120000),
    ocrMinConfidence: clamp(Math.min(settings.ocrMinConfidence, 55), 0, 100),
  };

  const providerOrder = [boostedSettings.ocrProvider, "local", "custom", "ocrspace"] as const;
  const seen = new Set<string>();

  for (const provider of providerOrder) {
    if (seen.has(provider)) continue;
    seen.add(provider);

    if (provider === "local") {
      const result = await localTesseractOcr(blob, boostedSettings);
      if (result?.text) return result;
      continue;
    }

    if (provider === "custom") {
      const result = await customOcr(blob, boostedSettings);
      if (result?.text && result.confidence >= boostedSettings.ocrMinConfidence - 10) return result;
      continue;
    }

    if (provider === "ocrspace") {
      const result = await ocrSpace(blob, boostedSettings);
      if (result?.text) return result;
    }
  }

  return {
    text: "",
    confidence: 0,
    provider: "none",
    attempts: 0,
  };
};

const wikiEvidence = async (query: string): Promise<SearchEvidence[]> => {
  const data = await safeFetchJson<{
    query?: { search?: Array<{ title: string; snippet: string }> };
  }>(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&origin=*`
  );
  return (data?.query?.search ?? []).slice(0, 3).map((item) => ({
    title: item.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
    snippet: normalize(item.snippet.replace(/<[^>]+>/g, " ")).slice(0, 240),
    source: "wikipedia" as const,
  }));
};

const ddgEvidence = async (query: string): Promise<SearchEvidence[]> => {
  const ddg = await safeFetchJson<{
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
  }>(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);

  const evidence: SearchEvidence[] = [];
  if (ddg?.AbstractText && ddg?.AbstractURL) {
    evidence.push({
      title: ddg.Heading || "DuckDuckGo Abstract",
      url: ddg.AbstractURL,
      snippet: normalize(ddg.AbstractText).slice(0, 240),
      source: "duckduckgo",
    });
  }
  const related = (ddg?.RelatedTopics ?? [])
    .flatMap((x) => ("Topics" in x ? x.Topics ?? [] : [x]))
    .filter((x) => x.FirstURL && x.Text)
    .slice(0, 3);

  for (const item of related) {
    evidence.push({
      title: "Related Source",
      url: item.FirstURL!,
      snippet: normalize(item.Text!).slice(0, 240),
      source: "web",
    });
  }
  return evidence;
};

const customSearch = async (query: string, settings: IntegrationSettings): Promise<SearchEvidence[]> => {
  const endpoint = settings.webSearchCustomEndpoint.trim();
  if (!endpoint) return [];
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.webSearchApiKey.trim() ? { Authorization: `Bearer ${settings.webSearchApiKey.trim()}` } : {}),
      },
      body: JSON.stringify({ query, limit: 6 }),
      signal: timeoutSignal(12000),
    });
    if (!res.ok) return [];
    const payload = (await res.json()) as { results?: Array<{ title?: string; url?: string; snippet?: string }> };
    return (payload.results ?? [])
      .filter((x) => x.url && x.title)
      .slice(0, 6)
      .map((item) => ({
        title: normalize(item.title || "Result"),
        url: item.url || "",
        snippet: normalize(item.snippet || "").slice(0, 240),
        source: "web" as const,
      }));
  } catch {
    return [];
  }
};

export const runWebSearchFromSettings = async (query: string): Promise<SearchEvidence[]> => {
  const clean = normalize(query).slice(0, 240);
  if (!clean) return [];
  const settings = loadIntegrationSettings();

  if (settings.webSearchProvider === "custom") {
    const custom = await customSearch(clean, settings);
    if (custom.length > 0) return custom;
  }

  const [wiki, ddg] = await Promise.all([wikiEvidence(clean), ddgEvidence(clean)]);
  const merged = [...wiki, ...ddg];
  const dedup = new Map<string, SearchEvidence>();
  for (const item of merged) {
    if (!dedup.has(item.url)) dedup.set(item.url, item);
  }
  return Array.from(dedup.values()).slice(0, 6);
};

export const fetchReadableUrlBody = async (url: string) => {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const proxy = `https://r.jina.ai/http://${normalized.replace(/^https?:\/\//, "")}`;
    const res = await fetch(proxy, { signal: timeoutSignal(12000) });
    if (!res.ok) return "";
    const text = await res.text();
    return normalize(text).slice(0, 7000);
  } catch {
    return "";
  }
};

