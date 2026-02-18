import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { Dashboard } from "@/components/Dashboard";
import { DocumentUpload } from "@/components/DocumentUpload";
import { MisinformationChecker } from "@/components/MisinformationChecker";
import { ChatInterface } from "@/components/ChatInterface";
import { EducationHub } from "@/components/EducationHub";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Settings } from "lucide-react";

const AppLayout = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "dashboard";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const tab = searchParams.get("tab") || "dashboard";
    setActiveTab(tab);
  }, [searchParams]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'documents':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">Document Analysis</h2>
              <p className="text-muted-foreground">
                Upload and analyze legal documents for plain-language insights and risk assessment.
              </p>
            </div>
            <DocumentUpload />
          </div>
        );
      case 'misinformation':
        return <MisinformationChecker />;
      case 'chat':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">AI Assistant</h2>
              <p className="text-muted-foreground">
                Ask questions about your documents and get personalized legal insights.
              </p>
            </div>
            <ChatInterface />
          </div>
        );
      case 'education':
        return <EducationHub />;
      case 'profile':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">Profile</h2>
              <p className="text-muted-foreground">
                Manage your account settings and preferences.
              </p>
            </div>
            <Card className="dashboard-card-effect">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <User className="h-5 w-5" />
                  <span>User Profile</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Profile management coming soon...</p>
              </CardContent>
            </Card>
          </div>
        );
      case 'settings':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">Settings</h2>
              <p className="text-muted-foreground">
                Configure your TrustLens experience.
              </p>
            </div>
            <Card className="dashboard-card-effect">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Settings className="h-5 w-5" />
                  <span>Application Settings</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">Settings panel coming soon...</p>
              </CardContent>
            </Card>
          </div>
        );
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Navigation activeTab={activeTab} onTabChange={handleTabChange} />
      <main className="flex-1 p-6 overflow-y-auto">
        {renderContent()}
      </main>
    </div>
  );
};

export default AppLayout;
