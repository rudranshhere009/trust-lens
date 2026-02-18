import type { AppTrack } from "@/utils/insideData";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface ChatThread {
  id: string;
  track: AppTrack;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface InsideChatStore {
  threads: ChatThread[];
}

const STORAGE_KEY = "trustlens_inside_chat_store";

const initialStore: InsideChatStore = {
  threads: [],
};

export const loadInsideChatStore = (): InsideChatStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw) as Partial<InsideChatStore>;
    return {
      threads: parsed.threads ?? [],
    };
  } catch {
    return initialStore;
  }
};

export const saveInsideChatStore = (store: InsideChatStore) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

export const updateInsideChatStore = (updater: (current: InsideChatStore) => InsideChatStore) => {
  const current = loadInsideChatStore();
  const next = updater(current);
  saveInsideChatStore(next);
  return next;
};

export const createThreadId = () => `th-${Math.random().toString(36).slice(2, 10)}`;
export const createMessageId = () => `msg-${Math.random().toString(36).slice(2, 10)}`;
