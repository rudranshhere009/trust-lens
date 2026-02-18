export interface ProfileActivity {
  id: string;
  label: string;
  detail: string;
  at: number;
}

export interface InsideProfileStore {
  name: string;
  email: string;
  title: string;
  department: string;
  timezone: string;
  language: "en" | "hi";
  phone: string;
  bio: string;
  photoUrl: string;
  faceVerified: boolean;
  lastLoginAt: number;
  activity: ProfileActivity[];
}

export const PROFILE_UPDATED_EVENT = "trustlens:user-profile-updated";
const STORAGE_KEY = "trustlens_inside_profile_store";

const loadUserProfileSeed = () => {
  try {
    const raw = localStorage.getItem("userProfile");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<InsideProfileStore>;
    return parsed;
  } catch {
    return null;
  }
};

const seed = loadUserProfileSeed();

const initialStore: InsideProfileStore = {
  name: seed?.name?.trim() || "User",
  email: seed?.email || "",
  title: "Investigation Analyst",
  department: "Legal Operations",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  language: "en",
  phone: "",
  bio: "",
  photoUrl: seed?.photoUrl || "",
  faceVerified: Boolean(seed?.faceVerified),
  lastLoginAt: Date.now(),
  activity: [
    {
      id: "act-1",
      label: "Session started",
      detail: "Signed in to TrustLens workspace.",
      at: Date.now(),
    },
  ],
};

export const loadInsideProfileStore = (): InsideProfileStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw) as Partial<InsideProfileStore>;
    return {
      ...initialStore,
      ...parsed,
      activity: parsed.activity ?? initialStore.activity,
    };
  } catch {
    return initialStore;
  }
};

export const saveInsideProfileStore = (store: InsideProfileStore) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

export const updateInsideProfileStore = (updater: (current: InsideProfileStore) => InsideProfileStore) => {
  const current = loadInsideProfileStore();
  const next = updater(current);
  saveInsideProfileStore(next);
  return next;
};

export const mirrorToUserProfile = (store: InsideProfileStore) => {
  localStorage.setItem(
    "userProfile",
    JSON.stringify({
      name: store.name,
      email: store.email,
      photoUrl: store.photoUrl,
      faceVerified: store.faceVerified,
    }),
  );
};

export const emitProfileUpdated = () => {
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
};

export const createProfileActivity = () => `act-${Math.random().toString(36).slice(2, 9)}`;
