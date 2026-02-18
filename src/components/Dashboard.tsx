import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Shield, UserCog, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrustScore } from "./TrustScore";
import heroImage from "@/assets/hero-trustlens.jpg";
import { loadAppData, toRelativeDate } from "@/utils/appData";

export const Dashboard = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(() => loadAppData());

  useEffect(() => {
    const sync = () => setData(loadAppData());
    window.addEventListener('trustlens:data-updated', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('trustlens:data-updated', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const documentsCount = data.documents.length;
  const avgDocumentScore = documentsCount
    ? Math.round(data.documents.reduce((sum, doc) => sum + doc.trustScore, 0) / documentsCount)
    : 0;
  const resourceReadiness = data.courses.length
    ? Math.round(data.courses.reduce((sum, course) => sum + course.progress, 0) / data.courses.length)
    : 0;
  const activeRiskAlerts = data.documents.reduce((sum, doc) => sum + doc.risks, 0);

  const recentDocuments = data.documents.slice(0, 5);
  const recentFactChecks = data.factChecks.slice(0, 5);

  const stats = [
    {
      title: "Documents Analyzed",
      value: String(documentsCount),
      change: documentsCount > 0 ? `${Math.min(7, documentsCount)} recent` : "Upload your first document",
      icon: FileText,
    },
    {
      title: "Average Trust Score",
      value: String(avgDocumentScore),
      change: documentsCount > 0 ? "Based on uploaded docs" : "No score yet",
      icon: Shield,
    },
    {
      title: "Resource Readiness",
      value: `${resourceReadiness}%`,
      change: "Profile + settings health index",
      icon: UserCog,
    },
    {
      title: "Risk Alerts",
      value: String(activeRiskAlerts),
      change: activeRiskAlerts > 0 ? "Review flagged clauses" : "No active alerts",
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden dashboard-card-effect">
        <div className="relative h-48 bg-gradient-primary">
          <img src={heroImage} alt="TrustLens Platform" className="absolute inset-0 w-full h-full object-cover opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-r from-primary/90 to-primary/70" />
          <div className="relative p-6 text-primary-foreground">
            <h1 className="text-2xl font-bold mb-2">Welcome back to TrustLens</h1>
            <p className="text-primary-foreground/90 mb-4">
              Your AI-powered platform for legal document analysis and misinformation detection
            </p>
            <div className="flex space-x-3">
              <Button variant="secondary" onClick={() => navigate('/app?tab=documents')}>
                <FileText className="h-4 w-4 mr-2" />
                Upload Document
              </Button>
              <Button variant="secondary" onClick={() => navigate('/app?tab=misinformation')}>
                Check Information
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="dashboard-card-effect">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>Recent Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents yet. Start by uploading a file.</p>
            ) : (
              recentDocuments.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{doc.name}</h4>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-xs text-muted-foreground">{toRelativeDate(doc.uploadedAt)}</span>
                      <Badge variant={doc.risks > 0 ? "destructive" : "secondary"} className="text-xs">
                        {doc.risks > 0 ? `${doc.risks} risks` : "No risks"}
                      </Badge>
                    </div>
                  </div>
                  <TrustScore score={doc.trustScore} size="sm" showLabel={false} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>Recent Fact Checks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentFactChecks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fact checks yet.</p>
            ) : (
              recentFactChecks.map((check) => (
                <div key={check.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1">
                    <h4 className="font-medium text-sm">{check.title}</h4>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-xs text-muted-foreground">{toRelativeDate(check.checkedAt)}</span>
                      <Badge variant={check.status === 'verified' ? 'secondary' : check.status === 'mixed' ? 'outline' : 'destructive'} className="text-xs">
                        {check.status}
                      </Badge>
                    </div>
                  </div>
                  <TrustScore score={check.trustScore} size="sm" showLabel={false} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <Button variant="outline" className="h-16 flex-col" onClick={() => navigate('/app?tab=documents')}>
              <FileText className="h-5 w-5 mb-1" />
              <span className="text-sm">Analyze Document</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col" onClick={() => navigate('/app?tab=misinformation')}>
              <Shield className="h-5 w-5 mb-1" />
              <span className="text-sm">Fact Check Content</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col" onClick={() => navigate('/app?tab=resources')}>
              <UserCog className="h-5 w-5 mb-1" />
              <span className="text-sm">Open Resources</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
