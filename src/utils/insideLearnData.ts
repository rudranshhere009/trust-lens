import type { AppTrack } from "@/utils/insideData";

export interface LearnLesson {
  id: string;
  title: string;
  minutes: number;
}

export interface LearnCourse {
  id: string;
  track: AppTrack;
  title: string;
  level: "beginner" | "intermediate" | "advanced";
  description: string;
  lessons: LearnLesson[];
}

export interface CourseProgress {
  courseId: string;
  track: AppTrack;
  progress: number;
  completed: boolean;
  lastLessonId?: string;
  updatedAt: number;
}

export interface LearnQuizAttempt {
  id: string;
  track: AppTrack;
  question: string;
  answer: string;
  correct: boolean;
  createdAt: number;
}

export interface InsideLearnStore {
  progress: CourseProgress[];
  attempts: LearnQuizAttempt[];
}

const STORAGE_KEY = "trustlens_inside_learn_store";

const initialStore: InsideLearnStore = {
  progress: [],
  attempts: [],
};

export const COURSES: LearnCourse[] = [
  {
    id: "legal-101",
    track: "legal",
    title: "Legal Investigation Foundations",
    level: "beginner",
    description: "Core workflow for case intake, risk triage, and legal evidence hygiene.",
    lessons: [
      { id: "li-1", title: "Case Intake Checklist", minutes: 8 },
      { id: "li-2", title: "Risk Scoring Basics", minutes: 11 },
      { id: "li-3", title: "Evidence Logging Standards", minutes: 10 },
    ],
  },
  {
    id: "legal-201",
    track: "legal",
    title: "Clause Risk Deep Dive",
    level: "intermediate",
    description: "Advanced clause interpretation, redline strategy, and review notes.",
    lessons: [
      { id: "cr-1", title: "Liability Clauses", minutes: 13 },
      { id: "cr-2", title: "Termination & Remedies", minutes: 12 },
      { id: "cr-3", title: "Negotiation Notes", minutes: 9 },
    ],
  },
  {
    id: "comp-101",
    track: "compliance",
    title: "Compliance Ops Essentials",
    level: "beginner",
    description: "Control lifecycle, audit readiness, and policy alignment.",
    lessons: [
      { id: "co-1", title: "Control Mapping", minutes: 10 },
      { id: "co-2", title: "Audit Evidence Packs", minutes: 12 },
      { id: "co-3", title: "Exception Handling", minutes: 9 },
    ],
  },
  {
    id: "comp-201",
    track: "compliance",
    title: "Vendor Risk Monitoring",
    level: "intermediate",
    description: "Vendor profiling, risk signals, and remediation workflow.",
    lessons: [
      { id: "vr-1", title: "Vendor Tiering", minutes: 8 },
      { id: "vr-2", title: "Critical Signal Detection", minutes: 10 },
      { id: "vr-3", title: "Corrective Action Plans", minutes: 11 },
    ],
  },
  {
    id: "truth-101",
    track: "truthdesk",
    title: "Fact-Check Method Foundations",
    level: "beginner",
    description: "Claim framing, source quality, and evidence triangulation.",
    lessons: [
      { id: "fc-1", title: "Claim Decomposition", minutes: 8 },
      { id: "fc-2", title: "Source Vetting", minutes: 12 },
      { id: "fc-3", title: "Verdict Rubric", minutes: 9 },
    ],
  },
  {
    id: "truth-201",
    track: "truthdesk",
    title: "Narrative Integrity Lab",
    level: "advanced",
    description: "Bias checks, timeline consistency, and misinformation patterning.",
    lessons: [
      { id: "ni-1", title: "Narrative Mapping", minutes: 10 },
      { id: "ni-2", title: "Contradiction Detection", minutes: 11 },
      { id: "ni-3", title: "Editorial Safeguards", minutes: 9 },
    ],
  },
];

export const QUIZ_BANK: Record<AppTrack, Array<{ question: string; correct: string; options: string[] }>> = {
  legal: [
    {
      question: "Which clause usually needs immediate legal escalation?",
      correct: "Unlimited liability with no cap",
      options: [
        "Unlimited liability with no cap",
        "Defined payment term",
        "Standard notice period",
      ],
    },
    {
      question: "Best first step after case intake?",
      correct: "Assign owner and risk triage status",
      options: [
        "Assign owner and risk triage status",
        "Close case immediately",
        "Skip document review",
      ],
    },
  ],
  compliance: [
    {
      question: "What is key for audit readiness?",
      correct: "Evidence mapped to controls",
      options: [
        "Evidence mapped to controls",
        "No documentation",
        "Untracked exceptions",
      ],
    },
    {
      question: "Warning control should trigger what?",
      correct: "Review and remediation plan",
      options: [
        "Review and remediation plan",
        "Ignore for next quarter",
        "Delete control",
      ],
    },
  ],
  truthdesk: [
    {
      question: "Best way to improve claim confidence?",
      correct: "Triangulate across independent reliable sources",
      options: [
        "Triangulate across independent reliable sources",
        "Use only one social post",
        "Skip source checks",
      ],
    },
    {
      question: "Unsupported verdict usually means:",
      correct: "Weak or contradictory evidence",
      options: [
        "Weak or contradictory evidence",
        "Automatically true",
        "Irrelevant to verification",
      ],
    },
  ],
};

export const loadInsideLearnStore = (): InsideLearnStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw) as Partial<InsideLearnStore>;
    return {
      progress: parsed.progress ?? [],
      attempts: parsed.attempts ?? [],
    };
  } catch {
    return initialStore;
  }
};

export const saveInsideLearnStore = (store: InsideLearnStore) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

export const updateInsideLearnStore = (updater: (current: InsideLearnStore) => InsideLearnStore) => {
  const current = loadInsideLearnStore();
  const next = updater(current);
  saveInsideLearnStore(next);
  return next;
};

export const createAttemptId = () => `att-${Math.random().toString(36).slice(2, 10)}`;
