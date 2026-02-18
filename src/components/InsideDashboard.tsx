import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppTrack, createId, loadDashboardStore, updateDashboardStore, type ComplianceControl, type LegalCase } from "@/utils/insideData";
import { loadInsideProfileStore, PROFILE_UPDATED_EVENT } from "@/utils/insideProfileData";
import { loadInsideDocuments } from "@/utils/insideDocumentsData";
import { createFactChatId, createFactId, loadInsideFactStore, updateInsideFactStore } from "@/utils/insideFactCheckData";
import { loadInsideChatStore } from "@/utils/insideChatData";
import { SECTION_ACTION_EVENT, isSectionActionDetail } from "@/utils/sectionActionEvents";

interface InsideDashboardProps {
  mode: AppTrack;
}

const today = () => new Date().toISOString().slice(0, 10);
const trackLabel: Record<AppTrack, string> = {
  legal: "Legal",
  compliance: "Compliance",
  truthdesk: "Fact Check",
};

export const InsideDashboard = ({ mode }: InsideDashboardProps) => {
  const [store, setStore] = useState(() => loadDashboardStore());
  const [profileName, setProfileName] = useState(() => loadInsideProfileStore().name || "Analyst");
  const [realtimeNow, setRealtimeNow] = useState(Date.now());
  const [externalTick, setExternalTick] = useState(0);
  const [legalView, setLegalView] = useState<"all" | "alerts" | "pending" | "sla">("all");
  const [complianceView, setComplianceView] = useState<"all" | "nonconform" | "vendor" | "audit">("all");
  const [truthView, setTruthView] = useState<"all" | "queue" | "impact" | "source">("all");

  const [newLegalTitle, setNewLegalTitle] = useState("");
  const [newControlName, setNewControlName] = useState("");
  const [responseChecklist, setResponseChecklist] = useState({
    captureClaim: false,
    collectSources: false,
    counterEvidence: false,
    verdictDraft: false,
  });
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);
  const [lastLaunchNote, setLastLaunchNote] = useState("");

  const legalInputRef = useRef<HTMLInputElement | null>(null);
  const controlInputRef = useRef<HTMLInputElement | null>(null);

  const sync = (updater: Parameters<typeof updateDashboardStore>[0]) => {
    const next = updateDashboardStore(updater);
    setStore(next);
  };

  useEffect(() => {
    const onSectionAction = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isSectionActionDetail(detail) || detail.tab !== "dashboard" || detail.mode !== mode) return;

      if (mode === "legal") {
        if (detail.action === "Case queue") setLegalView("all");
        if (detail.action === "Urgent risk alerts") setLegalView("alerts");
        if (detail.action === "Pending reviews") setLegalView("pending");
        if (detail.action === "SLA timers") setLegalView("sla");
      }

      if (mode === "compliance") {
        if (detail.action === "Control status") setComplianceView("all");
        if (detail.action === "Open non-conformities") setComplianceView("nonconform");
        if (detail.action === "Vendor risk heatmap") setComplianceView("vendor");
        if (detail.action === "Audit calendar") setComplianceView("audit");
      }

      if (mode === "truthdesk") {
        if (detail.action === "Verification queue") setTruthView("queue");
        if (detail.action === "High-impact narratives") setTruthView("impact");
        if (detail.action === "Source trust trends") setTruthView("source");
      }
    };

    window.addEventListener(SECTION_ACTION_EVENT, onSectionAction);
    return () => window.removeEventListener(SECTION_ACTION_EVENT, onSectionAction);
  }, [mode]);

  useEffect(() => {
    const refreshName = () => setProfileName(loadInsideProfileStore().name || "Analyst");
    window.addEventListener(PROFILE_UPDATED_EVENT, refreshName);
    window.addEventListener("storage", refreshName);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, refreshName);
      window.removeEventListener("storage", refreshName);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setRealtimeNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setExternalTick((t) => t + 1), 2000);
    const onStorage = () => setExternalTick((t) => t + 1);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const legalStats = useMemo(() => {
    const list = store.legalCases;
    return {
      total: list.length,
      flagged: list.filter((x) => x.status === "flagged").length,
      open: list.filter((x) => x.status === "new" || x.status === "reviewing").length,
      resolved: list.filter((x) => x.status === "resolved").length,
    };
  }, [store.legalCases]);

  const complianceStats = useMemo(() => {
    const list = store.complianceControls;
    return {
      total: list.length,
      healthy: list.filter((x) => x.status === "healthy").length,
      warning: list.filter((x) => x.status === "warning").length,
      critical: list.filter((x) => x.status === "critical").length,
    };
  }, [store.complianceControls]);

  const visibleLegalCases = useMemo(() => {
    const list = [...store.legalCases];
    if (legalView === "alerts") return list.filter((x) => x.status === "flagged" || x.riskScore >= 70);
    if (legalView === "pending") return list.filter((x) => x.status === "new" || x.status === "reviewing");
    if (legalView === "sla") return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return list;
  }, [store.legalCases, legalView]);

  const visibleComplianceControls = useMemo(() => {
    const list = [...store.complianceControls];
    if (complianceView === "nonconform") return list.filter((x) => x.status === "critical" || x.status === "warning");
    if (complianceView === "vendor") return list.sort((a, b) => a.vendor.localeCompare(b.vendor));
    if (complianceView === "audit") return list.sort((a, b) => a.nextAuditDate.localeCompare(b.nextAuditDate));
    return list;
  }, [store.complianceControls, complianceView]);

  const trackDocuments = useMemo(
    () => loadInsideDocuments().documents.filter((d) => d.track === mode),
    [mode, externalTick]
  );
  const trackFactSessions = useMemo(
    () => loadInsideFactStore().sessions.filter((s) => s.track === mode),
    [mode, externalTick]
  );
  const trackThreads = useMemo(
    () => loadInsideChatStore().threads.filter((t) => t.track === mode),
    [mode, externalTick]
  );

  const docsUnderReview = trackDocuments.filter((d) => d.status === "reviewing").length;
  const docsRiskFlagged = trackDocuments.filter((d) => d.risks > 0 || d.trustScore < 60).length;
  const docsReviewed = trackDocuments.filter((d) => d.status === "reviewed" || d.status === "viewed").length;
  const factLive = trackFactSessions.filter((s) => s.status === "researching").length;
  const factDone = trackFactSessions.filter((s) => s.status === "ready").length;
  const factErrors = trackFactSessions.filter((s) => s.status === "error").length;
  const sourceLinksGathered = trackFactSessions.reduce((sum, s) => sum + (s.research?.news?.length || 0), 0);
  const followupQaCount = trackFactSessions.reduce((sum, s) => sum + (s.qa?.length || 0), 0);
  const totalThreadMessages = trackThreads.reduce((sum, t) => sum + t.messages.length, 0);
  const recentThreadActivity = trackThreads.filter((t) => realtimeNow - t.updatedAt < 24 * 60 * 60 * 1000).length;
  const activeSession = trackFactSessions.find((s) => s.status === "researching") || null;
  const activeRunElapsedSec = activeSession ? Math.max(0, Math.round((realtimeNow - activeSession.createdAt) / 1000)) : 0;
  const latestFactUpdatedAt = trackFactSessions.reduce((max, s) => Math.max(max, s.updatedAt), 0);
  const latestFactActivitySec = latestFactUpdatedAt ? Math.max(0, Math.round((realtimeNow - latestFactUpdatedAt) / 1000)) : 0;
  const completedRunsWithDuration = trackFactSessions.filter((s) => s.status === "ready" && s.research?.durationMs);
  const avgRunDurationSec =
    completedRunsWithDuration.length > 0
      ? Math.round(
          completedRunsWithDuration.reduce((sum, s) => sum + (s.research?.durationMs || 0), 0) /
            completedRunsWithDuration.length /
            1000
        )
      : 0;
  const successRatePct = trackFactSessions.length > 0 ? Math.round((factDone / trackFactSessions.length) * 100) : 0;
  const platformScope = useMemo(
    () => [
      {
        title: "Dashboard",
        summary: "Cross-workspace live command view.",
        detail:
          "Tracks case queues, compliance controls, and misinformation intake in one place with operational status and workflow handoff context.",
      },
      {
        title: "Documents",
        summary: "Evidence registry and forensic preview.",
        detail:
          "Open and inspect files with metadata visibility, integrity signals, and export-ready chain records for investigative review.",
      },
      {
        title: "Fact Check",
        summary: "Deep web research and claim verification.",
        detail:
          "Runs URL/image/document-based evidence collection, source corroboration, contradiction search, and structured verdict drafting.",
      },
      {
        title: "Infantry",
        summary: "Forensic operations and remediation flow.",
        detail:
          "Combines forensic controls, redaction actions, transformation timeline, and evidence packaging for formal review paths.",
      },
      {
        title: "Chat + Resources",
        summary: "Analyst copilot and guidance base.",
        detail:
          "Provides operational summaries, quick Q&A over workspace state, and procedural references for consistent analyst execution.",
      },
    ],
    []
  );

  const runbookGuides = useMemo(
    () => [
      {
        id: "captureClaim",
        title: "Capture threat claim + IOC seed",
        purpose: "Start incident verification with a precise claim statement and at least one initial indicator.",
        usage: [
          "Paste the disputed claim or source URL in Fact Check intake.",
          "Record actor alias, brand target, and attack theme.",
          "Store first IOC lead: domain, handle, hash, or screenshot artifact.",
        ],
      },
      {
        id: "collectSources",
        title: "Correlate advisories and external feeds",
        purpose: "Avoid single-source bias by collecting independent corroboration and contradiction.",
        usage: [
          "Open at least one government/CERT advisory source.",
          "Add independent media and threat-intel references.",
          "Log conflicting statements to keep the review balanced.",
        ],
      },
      {
        id: "counterEvidence",
        title: "Validate deception markers",
        purpose: "Identify spoofing and manipulation patterns before issuing verdict.",
        usage: [
          "Check lookalike domains and brand impersonation strings.",
          "Verify image/video context for replay, crop, or fake overlays.",
          "Mark any mismatch between claim text and source evidence.",
        ],
      },
      {
        id: "verdictDraft",
        title: "Publish triage verdict + containment",
        purpose: "Ship an analyst-ready verdict with clear confidence and immediate next action.",
        usage: [
          "Label outcome as true, false, or mixed.",
          "Attach confidence level and top supporting/contradicting links.",
          "Add containment note: block, monitor, notify, or escalate.",
        ],
      },
    ],
    []
  );

  const templateGuides = useMemo(
    () => [
      {
        id: "tpl-cred",
        title: "Launch: Credential abuse triage",
        purpose: "Use when account takeover or credential stuffing claims are circulating.",
        usage: [
          "Seed the claim from dashboard template.",
          "Correlate login abuse chatter with trusted advisories.",
          "Extract target domains, leaked credential references, and attack timing.",
        ],
      },
      {
        id: "tpl-deepfake",
        title: "Launch: Deepfake impersonation check",
        purpose: "Use for executive impersonation clips or manipulated media incidents.",
        usage: [
          "Seed deepfake template and collect source post links.",
          "Validate media provenance, frame context, and repost patterns.",
          "Publish authenticity verdict with recommended comms response.",
        ],
      },
      {
        id: "tpl-malware",
        title: "Launch: Malware attribution corroboration",
        purpose: "Use for attribution claims that need multi-source technical corroboration.",
        usage: [
          "Seed attribution template from dashboard.",
          "Gather campaign mentions, IOC overlap, and actor references.",
          "Flag unsupported attribution jumps and publish graded confidence.",
        ],
      },
    ],
    []
  );

  const activeGuide = useMemo(
    () => [...runbookGuides, ...templateGuides].find((x) => x.id === activeGuideId) || null,
    [activeGuideId, runbookGuides, templateGuides]
  );

  const cyberSourceHub = useMemo(
    () => [
      {
        title: "VirusTotal",
        category: "Malware / URL / File",
        url: "https://www.virustotal.com",
        detail: "Scan suspicious files, hashes, URLs, and domains across multiple engines.",
      },
      {
        title: "AbuseIPDB",
        category: "IP Reputation",
        url: "https://www.abuseipdb.com",
        detail: "Check if an IP is reported for abuse, botnet activity, or malicious scanning.",
      },
      {
        title: "URLScan",
        category: "Phishing / Web Capture",
        url: "https://urlscan.io",
        detail: "Render and inspect suspicious pages, redirects, scripts, and infrastructure links.",
      },
      {
        title: "Have I Been Pwned",
        category: "Email Breach",
        url: "https://haveibeenpwned.com",
        detail: "Verify whether an email/account appears in known breach datasets.",
      },
      {
        title: "Cisco Talos Intelligence",
        category: "Domain / IP / Email Reputation",
        url: "https://talosintelligence.com",
        detail: "Assess sender/domain/IP reputation to support spam, phish, or malware investigations.",
      },
      {
        title: "AlienVault OTX",
        category: "Threat Intel / IOC",
        url: "https://otx.alienvault.com",
        detail: "Pivot on hashes, domains, URLs, and indicators from community and curated pulses.",
      },
      {
        title: "NVD (NIST)",
        category: "Vulnerability Intelligence",
        url: "https://nvd.nist.gov",
        detail: "Reference CVEs, CVSS scoring, and vulnerability metadata for attribution checks.",
      },
      {
        title: "CISA Known Exploited Vulnerabilities",
        category: "Exploitation Priority",
        url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
        detail: "Confirm if a CVE is actively exploited and should be prioritized in triage.",
      },
    ],
    []
  );

  const modeHeadline = useMemo(() => {
    if (mode === "legal") return "Legal risk oversight and case movement in one command lane.";
    if (mode === "compliance") return "Control integrity, vendor posture, and audit readiness monitoring.";
    return "Claim verification throughput and evidence-backed misinformation review.";
  }, [mode]);

  const introSection = (
    <Card className="dashboard-card-effect overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-cyan-500/15 via-blue-500/10 to-violet-500/10">
        <CardTitle className="text-xl">Welcome back, {profileName}</CardTitle>
        <div className="text-sm text-muted-foreground">
          {trackLabel[mode]} Command Center. {modeHeadline}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {platformScope.map((item) => (
            <div key={item.title} className="rounded-lg border p-3">
              <div className="font-semibold">{item.title}</div>
              <div className="text-sm text-muted-foreground">{item.summary}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  const operationsPanelsSection = (
    <Card className="dashboard-card-effect">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Live Workspace Operations</span>
          <Badge variant="outline">Live {new Date(realtimeNow).toLocaleTimeString()}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard title="Forensic Docs Indexed" value={trackDocuments.length} />
          <MetricCard title="Fact Runs Completed" value={factDone} />
          <MetricCard title="Copilot Threads" value={trackThreads.length} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-sm font-medium">Forensic Intake Snapshot</div>
            <div className="grid gap-2 grid-cols-3 text-sm">
              <div className="rounded border p-2">New: <span className="font-semibold">{trackDocuments.filter((d) => d.status === "new").length}</span></div>
              <div className="rounded border p-2">Reviewing: <span className="font-semibold">{docsUnderReview}</span></div>
              <div className="rounded border p-2">Reviewed: <span className="font-semibold">{docsReviewed}</span></div>
            </div>
            <div className="text-xs text-muted-foreground">Risk-flagged evidence files: {docsRiskFlagged}</div>
            <div className="space-y-2 max-h-40 overflow-auto">
              {trackDocuments.slice(0, 5).map((doc) => (
                <div key={doc.id} className="rounded border px-2 py-1 text-xs">
                  {doc.name} | {doc.status} | trust {doc.trustScore}
                </div>
              ))}
              {trackDocuments.length === 0 ? <div className="text-xs text-muted-foreground">No forensic documents indexed yet.</div> : null}
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-sm font-medium">Fact Check Runtime Snapshot</div>
            <div className="grid gap-2 grid-cols-3 text-sm">
              <div className="rounded border p-2">Live runs: <span className="font-semibold">{factLive}</span></div>
              <div className="rounded border p-2">Completed: <span className="font-semibold">{factDone}</span></div>
              <div className="rounded border p-2">Errors: <span className="font-semibold">{factErrors}</span></div>
            </div>
            <div className="text-xs text-muted-foreground">Source links gathered across runs: {sourceLinksGathered}</div>
            <div className="text-xs text-muted-foreground">Follow-up Q&A generated: {followupQaCount}</div>
            <div className="space-y-2 max-h-40 overflow-auto">
              {trackFactSessions.slice(0, 5).map((session) => (
                <div key={session.id} className="rounded border px-2 py-1 text-xs">
                  {session.title} | {session.inputType.toUpperCase()} | {session.status}
                </div>
              ))}
              {trackFactSessions.length === 0 ? <div className="text-xs text-muted-foreground">No fact-check runs yet.</div> : null}
            </div>
          </div>
        </div>
        <div className="rounded-lg border p-3 space-y-3">
          <div className="text-sm font-medium">Copilot + Collaboration Snapshot</div>
          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            <div className="rounded border p-2">Threads: <span className="font-semibold">{trackThreads.length}</span></div>
            <div className="rounded border p-2">Messages: <span className="font-semibold">{totalThreadMessages}</span></div>
            <div className="rounded border p-2">Active 24h: <span className="font-semibold">{recentThreadActivity}</span></div>
          </div>
          <div className="space-y-2 max-h-40 overflow-auto">
            {trackThreads.slice(0, 6).map((thread) => (
              <div key={thread.id} className="rounded border px-2 py-1 text-xs">
                {thread.title} | updated {new Date(thread.updatedAt).toLocaleTimeString()}
              </div>
            ))}
            {trackThreads.length === 0 ? <div className="text-xs text-muted-foreground">No chat threads yet.</div> : null}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setTruthView("queue")}>Open Verification Queue</Button>
            <Button size="sm" variant="outline" onClick={() => setComplianceView("nonconform")}>Open Non-Conformities</Button>
            <Button size="sm" variant="outline" onClick={() => setLegalView("alerts")}>Open Risk Alerts</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const addLegalCase = () => {
    const title = newLegalTitle.trim();
    if (!title) return;
    const item: LegalCase = {
      id: createId("lc"),
      title,
      owner: "Analyst",
      priority: "medium",
      status: "new",
      riskScore: 55,
      dueDate: today(),
      createdAt: Date.now(),
    };
    sync((current) => ({ ...current, legalCases: [item, ...current.legalCases] }));
    setNewLegalTitle("");
  };

  const addControl = () => {
    const name = newControlName.trim();
    if (!name) return;
    const item: ComplianceControl = {
      id: createId("cc"),
      name,
      owner: "Compliance Analyst",
      status: "healthy",
      vendor: "Internal",
      nextAuditDate: today(),
      createdAt: Date.now(),
    };
    sync((current) => ({ ...current, complianceControls: [item, ...current.complianceControls] }));
    setNewControlName("");
  };

  const seedTruthClaim = (claim: string, impact: "low" | "medium" | "high") => {
    sync((current) => ({
      ...current,
      truthClaims: [
        {
          id: createId("tc"),
          claim,
          source: "dashboard-template",
          impact,
          verdict: "queued",
          createdAt: Date.now(),
        },
        ...current.truthClaims,
      ],
    }));
  };

  const launchSocTemplate = (payload: { title: string; claim: string; impact: "low" | "medium" | "high"; inputType: "url" | "image" | "document" }) => {
    const now = Date.now();
    seedTruthClaim(payload.claim, payload.impact);
    updateInsideFactStore((current) => ({
      ...current,
      sessions: [
        {
          id: createFactChatId(),
          track: mode,
          title: payload.title,
          inputType: payload.inputType,
          inputLabel: payload.claim.slice(0, 160),
          rawInput: "",
          status: "idle",
          messages: [
            {
              id: `msg-${createFactId()}`,
              role: "system",
              text: `SOC template launched from dashboard: ${payload.title}.`,
              createdAt: now,
            },
            {
              id: `msg-${createFactId()}`,
              role: "assistant",
              text: "Template created. Open Fact Check intake and start deep research to execute this run.",
              createdAt: now + 1,
            },
          ],
          qa: [],
          createdAt: now,
          updatedAt: now,
        },
        ...current.sessions,
      ],
    }));
    setExternalTick((t) => t + 1);
    setTruthView("queue");
    setLastLaunchNote(`${payload.title} launched at ${new Date(now).toLocaleTimeString()}`);
  };

  if (mode === "legal") {
    return (
      <div className="space-y-5">
        {introSection}
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard title="Case Queue Open" value={legalStats.open} />
          <MetricCard title="Evidence Docs" value={trackDocuments.length} />
          <MetricCard title="Forensic Risk Flags" value={docsRiskFlagged} />
          <MetricCard title="Copilot Threads" value={trackThreads.length} />
        </div>
        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>Case Intake</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input ref={legalInputRef} value={newLegalTitle} onChange={(e) => setNewLegalTitle(e.target.value)} placeholder="Add legal case title..." />
            <Button onClick={addLegalCase}>Add Case</Button>
          </CardContent>
        </Card>
        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>Case Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleLegalCases.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-muted-foreground">Owner: {item.owner} | Due: {item.dueDate} | Risk: {item.riskScore}</div>
                </div>
                <div className="flex gap-2">
                  <Badge variant={item.status === "flagged" ? "destructive" : "secondary"}>{item.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => sync((current) => ({
                    ...current,
                    legalCases: current.legalCases.map((x) =>
                      x.id === item.id ? { ...x, status: x.status === "flagged" ? "reviewing" : "flagged" } : x
                    ),
                  }))}>
                    Toggle Flag
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sync((current) => ({
                    ...current,
                    legalCases: current.legalCases.map((x) => (x.id === item.id ? { ...x, status: "resolved" } : x)),
                  }))}>
                    Resolve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => sync((current) => ({
                    ...current,
                    legalCases: current.legalCases.filter((x) => x.id !== item.id),
                  }))}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        {operationsPanelsSection}
      </div>
    );
  }

  if (mode === "compliance") {
    return (
      <div className="space-y-5">
        {introSection}
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard title="Control Items" value={complianceStats.total} />
          <MetricCard title="Non-Conformities" value={complianceStats.warning + complianceStats.critical} />
          <MetricCard title="Evidence Docs" value={trackDocuments.length} />
          <MetricCard title="Fact Runs Linked" value={factDone} />
        </div>
        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>Control Intake</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input ref={controlInputRef} value={newControlName} onChange={(e) => setNewControlName(e.target.value)} placeholder="Add compliance control..." />
            <Button onClick={addControl}>Add Control</Button>
          </CardContent>
        </Card>
        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>Control Status Board</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleComplianceControls.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">Owner: {item.owner} | Vendor: {item.vendor} | Audit: {item.nextAuditDate}</div>
                </div>
                <div className="flex gap-2">
                  <Badge variant={item.status === "critical" ? "destructive" : "secondary"}>{item.status}</Badge>
                  <Button size="sm" variant="outline" onClick={() => sync((current) => ({
                    ...current,
                    complianceControls: current.complianceControls.map((x) =>
                      x.id === item.id ? { ...x, status: x.status === "healthy" ? "warning" : x.status === "warning" ? "critical" : "healthy" } : x
                    ),
                  }))}>
                    Cycle Status
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => sync((current) => ({
                    ...current,
                    complianceControls: current.complianceControls.filter((x) => x.id !== item.id),
                  }))}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        {operationsPanelsSection}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {introSection}
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="dashboard-card-effect border-cyan-400/40 bg-cyan-500/10">
          <CardContent className="pt-5 space-y-2">
            <div className="text-sm font-medium">Active Threat Hunt</div>
            <div className="text-2xl font-bold">{activeSession ? `${activeRunElapsedSec}s` : "Standby"}</div>
            <Button size="sm" variant="outline" onClick={() => setTruthView("queue")}>Open Active Hunts</Button>
          </CardContent>
        </Card>
        <Card className="dashboard-card-effect border-blue-400/40 bg-blue-500/10">
          <CardContent className="pt-5 space-y-2">
            <div className="text-sm font-medium">Counter-Narrative Coverage</div>
            <div className="text-2xl font-bold">{successRatePct}%</div>
            <div className="text-xs text-muted-foreground">Avg hunt cycle {avgRunDurationSec > 0 ? `${avgRunDurationSec}s` : "n/a"}</div>
            <Button size="sm" variant="outline" onClick={() => setTruthView("source")}>Prioritize IOC-Rich Hunts</Button>
          </CardContent>
        </Card>
        <Card className="dashboard-card-effect border-violet-400/40 bg-violet-500/10">
          <CardContent className="pt-5 space-y-2">
            <div className="text-sm font-medium">IOC/Artifact Leads</div>
            <div className="text-2xl font-bold">{sourceLinksGathered}</div>
            <Button size="sm" variant="outline" onClick={() => setTruthView("impact")}>Open Priority Incidents</Button>
          </CardContent>
        </Card>
        <Card className="dashboard-card-effect border-amber-400/40 bg-amber-500/10">
          <CardContent className="pt-5 space-y-2">
            <div className="text-sm font-medium">Intel Refresh Latency</div>
            <div className="text-2xl font-bold">{latestFactUpdatedAt ? `${latestFactActivitySec}s` : "No feed"}</div>
            <div className="text-xs text-muted-foreground">Analyst challenge prompts: {followupQaCount}</div>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="dashboard-card-effect border-emerald-400/30">
          <CardHeader>
            <CardTitle>Cyber Incident Verification Runbook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {runbookGuides.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveGuideId(item.id)}
                className="w-full rounded border px-3 py-2 text-left text-sm hover:bg-accent/40"
              >
                <span className="mr-2">{responseChecklist[item.id as keyof typeof responseChecklist] ? "✓" : "○"}</span>
                {item.title}
              </button>
            ))}
          </CardContent>
        </Card>
        <Card className="dashboard-card-effect border-fuchsia-400/30">
          <CardHeader>
            <CardTitle>Rapid SOC Launch Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => setActiveGuideId("tpl-cred")}
            >
              Launch: Credential abuse triage
            </Button>
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => setActiveGuideId("tpl-deepfake")}
            >
              Launch: Deepfake impersonation check
            </Button>
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={() => setActiveGuideId("tpl-malware")}
            >
              Launch: Malware attribution corroboration
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card className="dashboard-card-effect border-sky-400/30">
        <CardHeader>
          <CardTitle>Cyber Source Hub (Operational Links)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {cyberSourceHub.map((source) => (
            <div key={source.title} className="rounded-md border p-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{source.title}</div>
                <div className="text-xs text-muted-foreground">{source.category}</div>
                <div className="text-sm text-muted-foreground mt-1">{source.detail}</div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(source.url, "_blank", "noopener,noreferrer")}
              >
                Open Source
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      {lastLaunchNote ? (
        <div className="rounded border border-primary/40 bg-primary/10 px-3 py-2 text-sm">{lastLaunchNote}</div>
      ) : null}
      <Dialog open={!!activeGuide} onOpenChange={(open) => setActiveGuideId(open ? activeGuideId : null)}>
        <DialogContent className="max-w-2xl">
          {activeGuide ? (
            <>
              <DialogHeader>
                <DialogTitle>{activeGuide.title}</DialogTitle>
                <DialogDescription>{activeGuide.purpose}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div className="font-medium">How to use</div>
                {activeGuide.usage.map((step) => (
                  <div key={step} className="rounded border px-3 py-2">{step}</div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {activeGuide.id.startsWith("tpl-") ? (
                  <Button
                    onClick={() => {
                      if (activeGuide.id === "tpl-cred") {
                        launchSocTemplate({
                          title: "Credential Abuse Triage",
                          claim: "Credential stuffing wave claim against customer portal",
                          impact: "high",
                          inputType: "url",
                        });
                      }
                      if (activeGuide.id === "tpl-deepfake") {
                        launchSocTemplate({
                          title: "Deepfake Impersonation Check",
                          claim: "Executive impersonation deepfake clip is circulating",
                          impact: "high",
                          inputType: "image",
                        });
                      }
                      if (activeGuide.id === "tpl-malware") {
                        launchSocTemplate({
                          title: "Malware Attribution Corroboration",
                          claim: "Malware campaign attribution narrative needs corroboration",
                          impact: "medium",
                          inputType: "document",
                        });
                      }
                      setActiveGuideId(null);
                    }}
                  >
                    Launch Template
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setResponseChecklist((prev) => ({
                        ...prev,
                        [activeGuide.id]: !prev[activeGuide.id as keyof typeof prev],
                      }));
                      setActiveGuideId(null);
                    }}
                  >
                    Toggle Step Complete
                  </Button>
                )}
                <Button variant="outline" onClick={() => setActiveGuideId(null)}>Close</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const MetricCard = ({ title, value }: { title: string; value: number | string }) => (
  <Card className="dashboard-card-effect">
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
    </CardContent>
  </Card>
);
