import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import { InsideDashboard } from "@/components/InsideDashboard";
import { InsideDocuments } from "@/components/InsideDocuments";
import { InsideFactCheck } from "@/components/InsideFactCheck";
import { InsideChat } from "@/components/InsideChat";
import { InsideInfantry } from "@/components/InsideInfantry";
import { InsideProfile } from "@/components/InsideProfile";
import { InsideSettings } from "@/components/InsideSettings";

type AppTrack = "legal" | "compliance" | "truthdesk";
type TabId = "dashboard" | "documents" | "misinformation" | "chat" | "infantry" | "resources";

interface InsideRebuildProps {
  activeTab: string;
}

const TRACKS: Record<AppTrack, { title: string; short: string; theme: string }> = {
  legal: {
    title: "Legal Investigation Workspace",
    short: "Case-driven legal review and evidence workflow.",
    theme: "from-emerald-500/20 to-emerald-500/5",
  },
  compliance: {
    title: "Compliance Command Center",
    short: "Policy, audit, and vendor risk operations.",
    theme: "from-blue-500/20 to-blue-500/5",
  },
  truthdesk: {
    title: "Media Truth Desk",
    short: "Claims verification and source credibility desk.",
    theme: "from-amber-500/20 to-amber-500/5",
  },
};

const SECTION_LABELS: Record<TabId, string> = {
  dashboard: "Dashboard",
  documents: "Documents",
  misinformation: "Fact Check",
  chat: "AI Assistant",
  infantry: "Infantry",
  resources: "Resources",
};

const MODE_BUTTON_LABELS: Record<TabId, Record<AppTrack, string>> = {
  dashboard: {
    legal: "?? Legal Cases",
    compliance: "??? Compliance Health",
    truthdesk: "??? Truth Signals",
  },
  documents: {
    legal: "?? Contract Review",
    compliance: "??? Evidence Control",
    truthdesk: "?? Source Forensics",
  },
  misinformation: {
    legal: "?? Legal Exposure Check",
    compliance: "?? Regulatory Claims",
    truthdesk: "? Fact Verdict Desk",
  },
  chat: {
    legal: "?? Legal Copilot",
    compliance: "??? Policy Copilot",
    truthdesk: "?? Verification Copilot",
  },
  infantry: {
    legal: "?? Legal Infantry",
    compliance: "?? Compliance Infantry",
    truthdesk: "?? TruthDesk Infantry",
  },
  resources: {
    legal: "?? Legal Resources",
    compliance: "?? Compliance Resources",
    truthdesk: "?? TruthDesk Resources",
  },
};

const SECTION_PLAN: Record<TabId, Record<AppTrack, { objective: string; blocks: string[]; dataNeeded: string[] }>> = {
  dashboard: {
    legal: {
      objective: "Case pipeline and high-risk legal signal overview.",
      blocks: ["Case queue", "Urgent risk alerts", "Pending reviews", "SLA timers"],
      dataNeeded: ["cases", "risk_events", "assignees"],
    },
    compliance: {
      objective: "Org-wide compliance health and audit readiness.",
      blocks: ["Control status", "Open non-conformities", "Vendor risk heatmap", "Audit calendar"],
      dataNeeded: ["controls", "audits", "vendors"],
    },
    truthdesk: {
      objective: "Live misinformation triage dashboard.",
      blocks: ["Claim intake", "Verification queue", "High-impact narratives", "Source trust trends"],
      dataNeeded: ["claims", "sources", "verdicts"],
    },
  },
  documents: {
    legal: {
      objective: "Contract and legal doc intelligence workspace.",
      blocks: ["OCR ingestion", "Clause extraction", "Redline compare", "Risk annotations"],
      dataNeeded: ["documents", "clauses", "versions"],
    },
    compliance: {
      objective: "Policy and evidence document control.",
      blocks: ["Control mapping", "Evidence library", "Retention tagging", "Exception review"],
      dataNeeded: ["policies", "evidence", "retention_rules"],
    },
    truthdesk: {
      objective: "Source document forensics and consistency checks.",
      blocks: ["Source ingestion", "Metadata checks", "Citation chain", "Manipulation flags"],
      dataNeeded: ["source_docs", "metadata", "citations"],
    },
  },
  misinformation: {
    legal: {
      objective: "Disputed claim legal risk assessment.",
      blocks: ["Claim extraction", "Legal exposure score", "Jurisdiction impact", "Action recommendation"],
      dataNeeded: ["claims", "jurisdiction_rules", "evidence_links"],
    },
    compliance: {
      objective: "Regulatory misinformation monitoring.",
      blocks: ["Policy breach signals", "Control impact", "Escalation path", "Audit trail"],
      dataNeeded: ["regulatory_rules", "breaches", "alerts"],
    },
    truthdesk: {
      objective: "Fact-check production pipeline.",
      blocks: ["Claim decomposition", "Evidence graph", "Cross-source scoring", "Final verdict"],
      dataNeeded: ["claims", "web_sources", "credibility_scores"],
    },
  },
  chat: {
    legal: {
      objective: "Case-aware legal copilot.",
      blocks: ["Case Q&A", "Clause explanation", "Draft review prompts", "Cited responses"],
      dataNeeded: ["case_context", "documents", "citations"],
    },
    compliance: {
      objective: "Policy copilot and control assistant.",
      blocks: ["Control Q&A", "Gap suggestions", "Remediation prompts", "Audit prep help"],
      dataNeeded: ["controls", "policies", "findings"],
    },
    truthdesk: {
      objective: "Verification copilot for journalists/analysts.",
      blocks: ["Claim Q&A", "Source challenge prompts", "Narrative bias checks", "Evidence summary"],
      dataNeeded: ["claims", "sources", "verdict_history"],
    },
  },
  infantry: {
    legal: {
      objective: "Operational repair lane for high-risk legal documents.",
      blocks: ["High-risk queue", "Fix workflow", "Mitigation downloads", "Registry update controls"],
      dataNeeded: ["documents", "risk_signals", "fix_history"],
    },
    compliance: {
      objective: "Operational remediation lane for high-risk compliance evidence.",
      blocks: ["Flagged evidence queue", "Fix workflow", "Mitigation exports", "Registry update controls"],
      dataNeeded: ["evidence_docs", "risk_signals", "fix_history"],
    },
    truthdesk: {
      objective: "Operational remediation lane for risky source artifacts.",
      blocks: ["Flagged source queue", "Fix workflow", "Mitigation exports", "Registry update controls"],
      dataNeeded: ["source_docs", "risk_signals", "fix_history"],
    },
  },
  resources: {
    legal: {
      objective: "Unified resource center for profile, permissions, integrations, and legal workspace policies.",
      blocks: ["Identity + Profile", "Access + Security Preferences", "Integrations + OCR/Search Controls", "Policy + Data Retention"],
      dataNeeded: ["user", "roles", "integrations", "org_settings"],
    },
    compliance: {
      objective: "Unified resource center for analyst profile, governance controls, and compliance settings.",
      blocks: ["Identity + Profile", "Control Framework Settings", "Audit + Notification Policies", "Integration Controls"],
      dataNeeded: ["user", "frameworks", "audit_policies", "integrations"],
    },
    truthdesk: {
      objective: "Unified resource center for verifier profile, editorial controls, and integration settings.",
      blocks: ["Identity + Profile", "Verdict Rubric Controls", "Source Rule Configuration", "Workflow + Integrations"],
      dataNeeded: ["user", "rubrics", "source_rules", "integrations"],
    },
  },
};

const STORAGE_KEY = "trustlens_inside_mode";

export const InsideRebuild = ({ activeTab }: InsideRebuildProps) => {
  const mode = ((localStorage.getItem(STORAGE_KEY) as AppTrack) || "legal") as AppTrack;

  const safeTab: TabId = (SECTION_PLAN[activeTab as TabId] ? activeTab : "dashboard") as TabId;
  const current = useMemo(() => SECTION_PLAN[safeTab][mode], [safeTab, mode]);
  const sectionLabel = SECTION_LABELS[safeTab];


  return (
    <div className="space-y-6">
      <Card className="overflow-hidden dashboard-card-effect">
        <div className={`bg-gradient-to-r ${TRACKS[mode].theme} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">{sectionLabel} · {TRACKS[mode].title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{current.objective}</p>
            </div>
            <Badge variant="secondary">{TRACKS[mode].short}</Badge>
          </div>
        </div>
      </Card>

      {safeTab === "dashboard" ? <InsideDashboard mode={mode} /> : null}
      {safeTab === "documents" ? <InsideDocuments mode={mode} /> : null}
      {safeTab === "misinformation" ? <InsideFactCheck mode={mode} /> : null}
      {safeTab === "chat" ? <InsideChat mode={mode} /> : null}
      {safeTab === "infantry" ? <InsideInfantry mode={mode} /> : null}
      {safeTab === "resources" ? (
        <div className="space-y-6">
          <InsideProfile mode={mode} />
          <InsideSettings />
        </div>
      ) : null}

      {safeTab !== "dashboard" &&
      safeTab !== "documents" &&
      safeTab !== "misinformation" &&
      safeTab !== "chat" &&
      safeTab !== "infantry" &&
      safeTab !== "resources" ? (
        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>{safeTab.toUpperCase()} Blueprint</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Objective</p>
              <p className="font-medium">{current.objective}</p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">What This Section Should Contain</p>
              <div className="grid gap-2 md:grid-cols-2">
                {current.blocks.map((item) => (
                  <div key={item} className="rounded-md border p-3 text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground mb-2">Data Contracts To Build Next</p>
              <div className="flex flex-wrap gap-2">
                {current.dataNeeded.map((item) => (
                  <Badge key={item} variant="outline">{item}</Badge>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              Current inner features are intentionally removed. This tab is now a clean scaffold for section-by-section implementation.
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};



