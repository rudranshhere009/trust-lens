import { useState } from "react";
import { Search, Link, Type, AlertCircle, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { AnalysisResults } from "./AnalysisResults";
import { loadAppData, toRelativeDate, updateAppData, type FactCheckRecord } from "@/utils/appData";
import { analyzeMisinformation } from "@/utils/realAnalysis";

export const MisinformationChecker = () => {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeInputType, setActiveInputType] = useState<"url" | "text">("url");
  const [selectedResult, setSelectedResult] = useState<FactCheckRecord | null>(null);
  const [history, setHistory] = useState<FactCheckRecord[]>(() => loadAppData().factChecks);
  const { toast } = useToast();

  const runAnalysis = async (type: "url" | "text") => {
    const sourceValue = (type === "url" ? url : text).trim();

    if (!sourceValue) {
      toast({
        title: "Input Required",
        description: `Please enter a ${type === "url" ? "URL" : "text"} to analyze.`,
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);

    try {
      const analysis = await analyzeMisinformation(type, sourceValue);
      const newRecord: FactCheckRecord = {
        id: Math.random().toString(36).slice(2, 11),
        title: type === "url" ? sourceValue.replace(/^https?:\/\//, "").slice(0, 80) : sourceValue.slice(0, 80),
        sourceType: type,
        sourceValue,
        checkedAt: Date.now(),
        ...analysis,
      };

      const next = updateAppData((current) => ({
        ...current,
        factChecks: [newRecord, ...current.factChecks].slice(0, 50),
      }));

      setHistory(next.factChecks);
      setSelectedResult(newRecord);

      toast({
        title: "Analysis Complete",
        description: "Fact check finished with live external evidence and was saved to your history.",
      });
    } catch {
      toast({
        title: "Analysis Failed",
        description: "Could not fetch verification evidence right now. Please retry.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const removeHistoryItem = (id: string) => {
    const next = updateAppData((current) => ({
      ...current,
      factChecks: current.factChecks.filter((item) => item.id !== id),
    }));
    setHistory(next.factChecks);
    if (selectedResult?.id === id) {
      setSelectedResult(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Misinformation Checker</h2>
        <p className="text-muted-foreground">
          Analyze URLs or text content to detect misinformation, verify claims, and assess credibility.
        </p>
      </div>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Search className="h-5 w-5" />
            <span>Content Analysis</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="url" className="w-full" onValueChange={(val) => setActiveInputType(val as "url" | "text")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url" className="flex items-center space-x-2">
                <Link className="h-4 w-4" />
                <span>URL Analysis</span>
              </TabsTrigger>
              <TabsTrigger value="text" className="flex items-center space-x-2">
                <Type className="h-4 w-4" />
                <span>Text Analysis</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Website URL</label>
                <Input placeholder="https://example.com/article" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <Button onClick={() => void runAnalysis("url")} disabled={isAnalyzing} className="w-full">
                {isAnalyzing && activeInputType === "url" ? "Analyzing live sources..." : "Analyze URL"}
              </Button>
            </TabsContent>

            <TabsContent value="text" className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Text Content</label>
                <Textarea
                  placeholder="Paste the text content you want to fact-check..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                />
              </div>
              <Button onClick={() => void runAnalysis("text")} disabled={isAnalyzing} className="w-full">
                {isAnalyzing && activeInputType === "text" ? "Analyzing live sources..." : "Analyze Text"}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {selectedResult ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Latest Result</h3>
            <Button variant="outline" size="sm" onClick={() => setSelectedResult(null)}>
              Clear View
            </Button>
          </div>
          <AnalysisResults type="misinformation" data={selectedResult} />
        </div>
      ) : null}

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Recent Fact Checks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fact checks yet.</p>
          ) : (
            history.slice(0, 8).map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium text-sm">{item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {toRelativeDate(item.checkedAt)} • {item.status} • score {item.trustScore}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedResult(item)}>
                    View
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeHistoryItem(item.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="dashboard-card-effect">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2 mb-2">
              <AlertCircle className="h-5 w-5 text-primary" />
              <h4 className="font-medium">Claim Detection</h4>
            </div>
            <p className="text-sm text-muted-foreground">Identifies risky claims and unsupported wording patterns.</p>
          </CardContent>
        </Card>
        <Card className="dashboard-card-effect">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Search className="h-5 w-5 text-primary" />
              <h4 className="font-medium">Live Source Signals</h4>
            </div>
            <p className="text-sm text-muted-foreground">Pulls external references from public knowledge endpoints.</p>
          </CardContent>
        </Card>
        <Card className="dashboard-card-effect">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Search className="h-5 w-5 text-primary" />
              <h4 className="font-medium">Risk Scoring</h4>
            </div>
            <p className="text-sm text-muted-foreground">Generates a practical trust score and action-oriented guidance.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
