import type { AppTrack } from "@/utils/insideData";

export interface InsideDocumentRecord {
  id: string;
  track: AppTrack;
  name: string;
  type: string;
  size: number;
  uploadedAt: number;
  status: "new" | "viewed" | "reviewing" | "reviewed";
  trustScore: number;
  risks: number;
  summary: string;
  extractionMethod?: string;
  pagesAnalyzed?: number;
  extractionConfidence?: number;
  extractedText?: string;
  sourceDataUrl?: string;
  sourceMime?: string;
}

export interface InsideDocumentsStore {
  documents: InsideDocumentRecord[];
}

const STORAGE_KEY = "trustlens_inside_documents_store";

const initialStore: InsideDocumentsStore = {
  documents: [],
};

export const loadInsideDocuments = (): InsideDocumentsStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw) as Partial<InsideDocumentsStore>;
    return {
      documents: parsed.documents ?? [],
    };
  } catch {
    return initialStore;
  }
};

export const saveInsideDocuments = (store: InsideDocumentsStore) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

export const updateInsideDocuments = (updater: (current: InsideDocumentsStore) => InsideDocumentsStore) => {
  const current = loadInsideDocuments();
  const next = updater(current);
  saveInsideDocuments(next);
  return next;
};
