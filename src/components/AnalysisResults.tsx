import { AlertTriangle, CheckCircle, Info, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrustScore } from "./TrustScore";
import { cn } from "@/lib/utils";
import type { DocumentRecord, FactCheckRecord } from "@/utils/appData";

interface AnalysisResultsProps {
  type: "legal" | "misinformation";
  data: DocumentRecord | FactCheckRecord | null;
}

const parseSource = (raw: string) => {
  if (raw.includes(" | http")) {
    const [label, url] = raw.split(" | ");
    return { label, url };
  }

  const urlMatch = raw.match(/https?:\/\/\S+/i);
  if (urlMatch) {
    const url = urlMatch[0];
    try {
      return { label: new URL(url).hostname.replace(/^www\./, ""), url };
    } catch {
      return { label: raw, url };
    }
  }

  return { label: raw, url: "" };
};

export const AnalysisResults = ({ type, data }: AnalysisResultsProps) => {
  if (!data) {
    return (
      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>No Analysis Data</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Run an analysis to view results.</p>
        </CardContent>
      </Card>
    );
  }

  const analysis = data;

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "high":
        return "text-destructive";
      case "medium":
        return "text-warning";
      case "low":
        return "text-muted-foreground";
      default:
        return "text-muted-foreground";
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "high":
        return AlertTriangle;
      case "medium":
        return Info;
      case "low":
        return CheckCircle;
      default:
        return Info;
    }
  };

  return (
    <div className="space-y-6">
      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Analysis Complete
            <TrustScore score={analysis.trustScore} size="sm" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{analysis.summary}</p>
        </CardContent>
      </Card>

      {type === "legal" && (
        <>
          <Card className="dashboard-card-effect">
            <CardHeader>
              <CardTitle>Key Findings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(analysis as DocumentRecord).keyFindings.map((finding, index) => {
                const Icon = getSeverityIcon(finding.severity);
                return (
                  <div key={index} className="flex space-x-3">
                    <Icon className={cn("h-5 w-5 mt-0.5", getSeverityColor(finding.severity))} />
                    <div className="flex-1">
                      <h4 className="font-medium">{finding.title}</h4>
                      <p className="text-sm text-muted-foreground">{finding.description}</p>
                    </div>
                    <Badge variant={finding.severity === "high" ? "destructive" : "secondary"}>{finding.severity}</Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="dashboard-card-effect">
            <CardHeader>
              <CardTitle>Why This Verdict</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {(analysis as DocumentRecord).risks === 0 ? (
                <>
                  <p>No high-risk contract patterns were matched in extracted text.</p>
                  <p className="text-muted-foreground">
                    Trust score remains high because extraction quality and clause language looked stable.
                  </p>
                </>
              ) : (
                <>
                  <p>Risk score increased because matched clauses indicate one-sided or unclear obligations.</p>
                  <p className="text-muted-foreground">
                    Highest impact comes from high and medium severity findings in liability, termination, arbitration, and renewal areas.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="dashboard-card-effect">
            <CardHeader>
              <CardTitle>Detected Clauses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(analysis as DocumentRecord).clauses.map((clause, idx) => (
                <div key={idx} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Original clause</span>
                    <Badge variant={clause.risk === "high" ? "destructive" : "secondary"}>{clause.risk}</Badge>
                  </div>
                  <p className="text-sm">{clause.original}</p>
                  <p className="text-sm text-muted-foreground">Simplified: {clause.simplified}</p>
                </div>
              ))}
            </CardContent>
          </Card>

        </>
      )}

      {type === "misinformation" && (
        <>
          <Card className="dashboard-card-effect">
            <CardHeader>
              <CardTitle>Flagged Claims</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(analysis as FactCheckRecord).flaggedClaims.length === 0 ? (
                <p className="text-sm text-muted-foreground">No risky claims were flagged in this check.</p>
              ) : (
                (analysis as FactCheckRecord).flaggedClaims.map((claim, index) => (
                  <div key={index} className="space-y-3 p-4 border rounded-lg">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-medium text-sm">{claim.claim}</h4>
                      <Badge variant={claim.status === "True" ? "secondary" : "destructive"}>{claim.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{claim.explanation}</p>
                    <div className="flex flex-wrap gap-2">
                      {claim.sources.map((source, idx) => {
                        const parsed = parseSource(source);
                        return (
                          <Button
                            key={idx}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              if (parsed.url) {
                                window.open(parsed.url, "_blank", "noopener,noreferrer");
                              }
                            }}
                            disabled={!parsed.url}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            {parsed.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="dashboard-card-effect">
            <CardHeader>
              <CardTitle>Credibility Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(analysis as FactCheckRecord).credibilityFactors.map((factor, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{factor.factor}</p>
                    <p className="text-sm text-muted-foreground">{factor.reason}</p>
                  </div>
                  <TrustScore score={factor.score} size="sm" showLabel={false} />
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};
