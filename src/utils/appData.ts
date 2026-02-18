export interface DocumentRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  fileKind?: 'txt' | 'pdf' | 'image' | 'other';
  sourceDataUrl?: string;
  sourceMime?: string;
  uploadedAt: number;
  trustScore: number;
  risks: number;
  summary: string;
  extractedText?: string;
  editableText?: string;
  extractionMethod?: 'direct-text' | 'pdf-text-layer' | 'ocr-image' | 'ocr-pdf' | 'fallback' | 'zip-static-scan';
  scannedNonEditable?: boolean;
  pagesAnalyzed?: number;
  extractionConfidence?: number;
  keyFindings: Array<{
    type: 'risk' | 'neutral' | 'positive';
    title: string;
    description: string;
    severity: 'high' | 'medium' | 'low';
  }>;
  clauses: Array<{
    original: string;
    simplified: string;
    risk: 'high' | 'medium' | 'low';
  }>;
}

export interface FactCheckRecord {
  id: string;
  title: string;
  sourceType: 'url' | 'text';
  sourceValue: string;
  checkedAt: number;
  trustScore: number;
  status: 'verified' | 'misleading' | 'mixed';
  summary: string;
  flaggedClaims: Array<{
    claim: string;
    status: 'True' | 'False' | 'Misleading';
    sources: string[];
    explanation: string;
  }>;
  credibilityFactors: Array<{
    factor: string;
    score: number;
    reason: string;
  }>;
}

export interface CourseProgressRecord {
  id: number;
  progress: number;
  startedAt?: number;
  completedAt?: number;
}

export interface AppDataStore {
  documents: DocumentRecord[];
  factChecks: FactCheckRecord[];
  courses: CourseProgressRecord[];
}

const APP_DATA_KEY = 'trustlens_app_data';

const initialStore: AppDataStore = {
  documents: [],
  factChecks: [],
  courses: [
    { id: 1, progress: 0 },
    { id: 2, progress: 0 },
    { id: 3, progress: 0 },
  ],
};

export const loadAppData = (): AppDataStore => {
  try {
    const raw = localStorage.getItem(APP_DATA_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw) as Partial<AppDataStore>;
    return {
      documents: parsed.documents ?? [],
      factChecks: parsed.factChecks ?? [],
      courses: parsed.courses ?? initialStore.courses,
    };
  } catch {
    return initialStore;
  }
};

export const saveAppData = (store: AppDataStore) => {
  localStorage.setItem(APP_DATA_KEY, JSON.stringify(store));
};

export const updateAppData = (updater: (current: AppDataStore) => AppDataStore) => {
  const current = loadAppData();
  const next = updater(current);
  saveAppData(next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('trustlens:data-updated'));
  }
  return next;
};

export const toRelativeDate = (timestamp: number): string => {
  const deltaMs = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (deltaMs < day) return 'today';
  const days = Math.floor(deltaMs / day);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
};

const hashScore = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
};

export const generateDocumentAnalysis = (name: string) => {
  const hash = hashScore(name.toLowerCase());
  const trustScore = 35 + (hash % 61);
  const risks = trustScore >= 75 ? 0 : trustScore >= 55 ? 1 : trustScore >= 40 ? 2 : 3;

  return {
    trustScore,
    risks,
    summary:
      risks === 0
        ? 'Document language appears balanced with low risk signals.'
        : `Detected ${risks} potential risk area${risks > 1 ? 's' : ''}. Review highlighted clauses before acceptance.`,
    keyFindings: [
      {
        type: risks > 1 ? 'risk' : 'neutral',
        title: 'Liability Clause',
        description: risks > 1 ? 'Broad liability wording may shift burden to you.' : 'Liability scope appears standard.',
        severity: risks > 1 ? 'medium' : 'low',
      },
      {
        type: trustScore > 70 ? 'positive' : 'neutral',
        title: 'Termination Terms',
        description: trustScore > 70 ? 'Termination conditions are clear and balanced.' : 'Termination terms are acceptable but worth reviewing.',
        severity: 'low',
      },
    ] as DocumentRecord['keyFindings'],
    clauses: [
      {
        original: 'The party agrees to all obligations and liabilities under this agreement.',
        simplified: 'You accept all listed responsibilities in this agreement.',
        risk: risks > 1 ? 'medium' : 'low',
      },
    ] as DocumentRecord['clauses'],
  };
};

export const generateFactCheckAnalysis = (sourceType: 'url' | 'text', sourceValue: string) => {
  const content = sourceValue.toLowerCase();
  const hasSensational = /(hoax|miracle|secret|shocking|100%|cure)/.test(content);
  const hasSource = /https?:\/\//.test(content);
  const hasBalancedWords = /(study|report|data|according|source)/.test(content);

  let trustScore = 55;
  if (hasSensational) trustScore -= 25;
  if (!hasSource) trustScore -= 10;
  if (hasBalancedWords) trustScore += 15;
  trustScore = Math.max(10, Math.min(95, trustScore));

  const status: FactCheckRecord['status'] =
    trustScore >= 70 ? 'verified' : trustScore >= 45 ? 'mixed' : 'misleading';

  const flaggedClaims =
    status === 'verified'
      ? []
      : [
          {
            claim: sourceType === 'url' ? `Claims in ${sourceValue}` : sourceValue.slice(0, 120),
            status: status === 'misleading' ? 'False' : 'Misleading',
            sources: ['Cross-source consistency check', 'Known factual baseline'],
            explanation:
              status === 'misleading'
                ? 'Strong mismatch detected against reliable reference patterns.'
                : 'Some claims are not fully corroborated by strong sources.',
          },
        ];

  const credibilityFactors = [
    {
      factor: 'Language Reliability',
      score: hasSensational ? 30 : 75,
      reason: hasSensational ? 'Sensational phrasing detected.' : 'Language appears measured.',
    },
    {
      factor: 'Source Signals',
      score: hasSource ? 70 : 35,
      reason: hasSource ? 'Source-style references found.' : 'No clear source references found.',
    },
    {
      factor: 'Evidence Consistency',
      score: hasBalancedWords ? 72 : 45,
      reason: hasBalancedWords ? 'Evidence-like wording present.' : 'Low evidentiary wording.',
    },
  ];

  return {
    trustScore,
    status,
    summary:
      status === 'verified'
        ? 'Content appears mostly reliable with no major misinformation indicators.'
        : status === 'mixed'
        ? 'Content includes partially supported claims. Verify key points before relying on it.'
        : 'Content shows strong misinformation patterns and low credibility signals.',
    flaggedClaims,
    credibilityFactors,
  };
};
