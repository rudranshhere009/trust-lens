import type { AppTrack } from "@/utils/insideData";

export type FactVerdict = "queued" | "reviewing" | "supported" | "partial" | "unsupported";

export interface FactEvidence {
  title: string;
  url: string;
  snippet: string;
  source: "wikipedia" | "duckduckgo" | "web";
}

export interface FactRecord {
  id: string;
  track: AppTrack;
  inputType: "text" | "url";
  inputValue: string;
  claim: string;
  verdict: FactVerdict;
  confidence: number;
  score: number;
  rationale: string;
  evidence: FactEvidence[];
  createdAt: number;
}

export type FactInputType = "url" | "image" | "document";

export interface FactChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: number;
}

export interface FactNewsItem {
  id: string;
  title: string;
  snippet: string;
  url: string;
  source: FactEvidence["source"];
  relevance: number;
}

export interface FactRecommendationItem {
  id: string;
  title: string;
  whyRelevant: string;
  url?: string;
}

export interface FactQaItem {
  id: string;
  question: string;
  answer: string;
  verdict: "true" | "false" | "uncertain";
  confidence: number;
  supportingSourceUrls: string[];
  createdAt: number;
}

export interface FactResearchResult {
  claim: string;
  evidence: FactEvidence[];
  news: FactNewsItem[];
  recommendations: FactRecommendationItem[];
  timeline: string[];
  durationMs: number;
  startedAt: number;
  completedAt: number;
}

export interface FactSession {
  id: string;
  track: AppTrack;
  title: string;
  inputType: FactInputType;
  inputLabel: string;
  rawInput: string;
  status: "idle" | "researching" | "ready" | "error";
  messages: FactChatMessage[];
  qa: FactQaItem[];
  research?: FactResearchResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface InsideFactStore {
  records: FactRecord[];
  sessions: FactSession[];
}

const STORAGE_KEY = "trustlens_inside_factcheck_store_v4";

const initialStore: InsideFactStore = {
  records: [],
  sessions: [],
};

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const toSessionFromLegacyRecord = (record: FactRecord): FactSession => {
  const now = Date.now();
  return {
    id: `chat-${record.id}`,
    track: record.track,
    title: record.claim.slice(0, 64) || "Legacy fact check",
    inputType: record.inputType === "url" ? "url" : "document",
    inputLabel: record.inputValue.slice(0, 120) || record.inputType,
    rawInput: record.inputValue,
    status: "ready",
    messages: [
      {
        id: `msg-${record.id}-u`,
        role: "user",
        text: `Legacy check imported: ${record.claim}`,
        createdAt: record.createdAt,
      },
      {
        id: `msg-${record.id}-a`,
        role: "assistant",
        text: `${record.rationale} (score ${record.score}, confidence ${record.confidence}%)`,
        createdAt: record.createdAt + 1,
      },
    ],
    qa: [],
    research: {
      claim: record.claim,
      evidence: record.evidence,
      news: record.evidence.map((e, idx) => ({
        id: `legacy-news-${record.id}-${idx}`,
        title: e.title,
        snippet: e.snippet,
        url: e.url,
        source: e.source,
        relevance: Math.max(40, Math.min(95, 70 - idx * 5)),
      })),
      recommendations: [],
      timeline: ["Imported from legacy fact-check store"],
      durationMs: 0,
      startedAt: record.createdAt,
      completedAt: record.createdAt,
    },
    createdAt: record.createdAt,
    updatedAt: now,
  };
};

const normalizeStore = (raw: Partial<InsideFactStore>): InsideFactStore => {
  const records = asArray<FactRecord>(raw.records);
  const sessions = asArray<FactSession>(raw.sessions);
  if (sessions.length > 0) {
    return { records, sessions };
  }
  if (records.length > 0) {
    return {
      records,
      sessions: records.map(toSessionFromLegacyRecord),
    };
  }
  return initialStore;
};

export const loadInsideFactStore = (): InsideFactStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw) as Partial<InsideFactStore>;
    return normalizeStore(parsed);
  } catch {
    return initialStore;
  }
};

export const saveInsideFactStore = (store: InsideFactStore) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

export const updateInsideFactStore = (updater: (current: InsideFactStore) => InsideFactStore) => {
  const current = loadInsideFactStore();
  const next = updater(current);
  saveInsideFactStore(next);
  return next;
};

export const createFactId = () => `fr-${Math.random().toString(36).slice(2, 10)}`;
export const createFactChatId = () => `fc-${Math.random().toString(36).slice(2, 10)}`;
