export interface InsideSettingsStore {
  theme: "dark" | "light";
  language: "en" | "hi";
  notifications: {
    email: boolean;
    desktop: boolean;
    weeklySummary: boolean;
    riskAlerts: boolean;
  };
  security: {
    autoLockMinutes: number;
    requireFaceForSensitiveActions: boolean;
    sessionTimeoutMinutes: number;
  };
  accessibility: {
    reducedMotion: boolean;
    compactDensity: boolean;
  };
}

const STORAGE_KEY = "trustlens_inside_settings_store";

export const INSIDE_DATA_KEYS = [
  "trustlens_inside_dashboard_store",
  "trustlens_inside_documents_store",
  "trustlens_inside_factcheck_store",
  "trustlens_inside_chat_store",
  "trustlens_inside_learn_store",
  "trustlens_inside_profile_store",
];

const themeSeed = (localStorage.getItem("vite-ui-theme") as "dark" | "light" | null) || "dark";

const initialStore: InsideSettingsStore = {
  theme: themeSeed,
  language: "en",
  notifications: {
    email: true,
    desktop: false,
    weeklySummary: true,
    riskAlerts: true,
  },
  security: {
    autoLockMinutes: 30,
    requireFaceForSensitiveActions: true,
    sessionTimeoutMinutes: 120,
  },
  accessibility: {
    reducedMotion: false,
    compactDensity: false,
  },
};

export const loadInsideSettingsStore = (): InsideSettingsStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw) as Partial<InsideSettingsStore>;
    return {
      ...initialStore,
      ...parsed,
      notifications: {
        ...initialStore.notifications,
        ...(parsed.notifications ?? {}),
      },
      security: {
        ...initialStore.security,
        ...(parsed.security ?? {}),
      },
      accessibility: {
        ...initialStore.accessibility,
        ...(parsed.accessibility ?? {}),
      },
    };
  } catch {
    return initialStore;
  }
};

export const saveInsideSettingsStore = (store: InsideSettingsStore) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

export const updateInsideSettingsStore = (updater: (current: InsideSettingsStore) => InsideSettingsStore) => {
  const current = loadInsideSettingsStore();
  const next = updater(current);
  saveInsideSettingsStore(next);
  return next;
};

export const resetInsideSettingsStore = () => {
  saveInsideSettingsStore(initialStore);
  return initialStore;
};
