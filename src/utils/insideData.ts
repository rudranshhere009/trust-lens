export type AppTrack = "legal" | "compliance" | "truthdesk";

export interface LegalCase {
  id: string;
  title: string;
  owner: string;
  priority: "low" | "medium" | "high";
  status: "new" | "reviewing" | "flagged" | "resolved";
  riskScore: number;
  dueDate: string;
  createdAt: number;
}

export interface ComplianceControl {
  id: string;
  name: string;
  owner: string;
  status: "healthy" | "warning" | "critical";
  vendor: string;
  nextAuditDate: string;
  createdAt: number;
}

export interface TruthClaim {
  id: string;
  claim: string;
  source: string;
  impact: "low" | "medium" | "high";
  verdict: "queued" | "reviewing" | "supported" | "partial" | "unsupported";
  createdAt: number;
}

export interface DashboardStore {
  legalCases: LegalCase[];
  complianceControls: ComplianceControl[];
  truthClaims: TruthClaim[];
}

const STORAGE_KEY = "trustlens_inside_dashboard_store";

const nowIso = () => new Date().toISOString().slice(0, 10);

const initialStore: DashboardStore = {
  legalCases: [
    {
      id: "lc-1",
      title: "Vendor Contract - Liability Review",
      owner: "Analyst A",
      priority: "high",
      status: "reviewing",
      riskScore: 78,
      dueDate: nowIso(),
      createdAt: Date.now(),
    },
  ],
  complianceControls: [
    {
      id: "cc-1",
      name: "Data Retention Policy Control",
      owner: "Compliance Lead",
      status: "warning",
      vendor: "CloudArchive Inc.",
      nextAuditDate: nowIso(),
      createdAt: Date.now(),
    },
  ],
  truthClaims: [
    {
      id: "tc-1",
      claim: "Report states cyber attack affected 2M users.",
      source: "newswire.example",
      impact: "high",
      verdict: "queued",
      createdAt: Date.now(),
    },
  ],
};

export const loadDashboardStore = (): DashboardStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw) as Partial<DashboardStore>;
    return {
      legalCases: parsed.legalCases ?? initialStore.legalCases,
      complianceControls: parsed.complianceControls ?? initialStore.complianceControls,
      truthClaims: parsed.truthClaims ?? initialStore.truthClaims,
    };
  } catch {
    return initialStore;
  }
};

export const saveDashboardStore = (store: DashboardStore) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

export const updateDashboardStore = (updater: (current: DashboardStore) => DashboardStore) => {
  const current = loadDashboardStore();
  const next = updater(current);
  saveDashboardStore(next);
  return next;
};

export const createId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
