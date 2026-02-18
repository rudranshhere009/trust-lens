import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/components/ThemeProvider";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  INSIDE_DATA_KEYS,
  loadInsideSettingsStore,
  resetInsideSettingsStore,
  updateInsideSettingsStore,
  type InsideSettingsStore,
} from "@/utils/insideSettingsData";
import { loadIntegrationSettings, saveIntegrationSettings, type IntegrationSettings } from "@/utils/externalServices";
import { SECTION_ACTION_EVENT, isSectionActionDetail } from "@/utils/sectionActionEvents";

export const InsideSettings = () => {
  const [store, setStore] = useState(() => loadInsideSettingsStore());
  const [integrations, setIntegrations] = useState<IntegrationSettings>(() => loadIntegrationSettings());
  const { setTheme } = useTheme();
  const { i18n } = useTranslation();
  const { toast } = useToast();

  const appearanceRef = useRef<HTMLDivElement | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const securityRef = useRef<HTMLDivElement | null>(null);
  const integrationRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef<HTMLDivElement | null>(null);

  const sync = (updater: (current: InsideSettingsStore) => InsideSettingsStore) => {
    const next = updateInsideSettingsStore(updater);
    setStore(next);
  };

  useEffect(() => {
    setTheme(store.theme);
  }, [setTheme, store.theme]);

  useEffect(() => {
    void i18n.changeLanguage(store.language);
  }, [i18n, store.language]);

  const currentDataUsage = useMemo(() => {
    try {
      const bytes = INSIDE_DATA_KEYS.reduce((sum, key) => sum + (localStorage.getItem(key)?.length || 0), 0);
      return Math.round((bytes / 1024) * 10) / 10;
    } catch {
      return 0;
    }
  }, [store]);

  const resetSettings = () => {
    const next = resetInsideSettingsStore();
    setStore(next);
    setTheme(next.theme);
    void i18n.changeLanguage(next.language);
    toast({ title: "Settings reset", description: "Default settings restored." });
  };

  const clearWorkspaceData = () => {
    INSIDE_DATA_KEYS.forEach((key) => localStorage.removeItem(key));
    toast({ title: "Workspace data cleared", description: "Dashboard and section records were cleared." });
  };

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify({ app: store, integrations }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "trustlens-settings.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveIntegrations = () => {
    saveIntegrationSettings(integrations);
    toast({ title: "Integrations saved", description: "OCR and web-search providers updated." });
  };

  useEffect(() => {
    const onSectionAction = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isSectionActionDetail(detail) || detail.tab !== "settings") return;

      const action = detail.action;
      if (action === "Risk thresholds" || action === "Assignment rules" || action === "Review workflow") {
        securityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (action === "Evidence retention" || action === "Publication gates") {
        dataRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (action === "Escalation matrix" || action === "Notification policy") {
        notificationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (action === "Control frameworks" || action === "Vendor tiers" || action === "Verdict rubric" || action === "Source whitelist/blacklist") {
        integrationRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (action === "Audit cycles") {
        appearanceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.addEventListener(SECTION_ACTION_EVENT, onSectionAction);
    return () => window.removeEventListener(SECTION_ACTION_EVENT, onSectionAction);
  }, []);

  return (
    <div className="space-y-5">
      <Card ref={appearanceRef} className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Appearance and Language</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">Dark Theme</div>
              <div className="text-xs text-muted-foreground">Switch light or dark workspace mode.</div>
            </div>
            <Switch
              checked={store.theme === "dark"}
              onCheckedChange={(checked) => sync((current) => ({ ...current, theme: checked ? "dark" : "light" }))}
            />
          </div>
          <div className="rounded-md border p-3 space-y-2">
            <Label>Language</Label>
            <Select
              value={store.language}
              onValueChange={(value: "en" | "hi") => sync((current) => ({ ...current, language: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="hi">Hindi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">Reduced Motion</div>
              <div className="text-xs text-muted-foreground">Lower visual animation in the app.</div>
            </div>
            <Switch
              checked={store.accessibility.reducedMotion}
              onCheckedChange={(checked) =>
                sync((current) => ({
                  ...current,
                  accessibility: { ...current.accessibility, reducedMotion: checked },
                }))
              }
            />
          </div>
          <div className="rounded-md border p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">Compact Density</div>
              <div className="text-xs text-muted-foreground">Reduce spacing in cards and tables.</div>
            </div>
            <Switch
              checked={store.accessibility.compactDensity}
              onCheckedChange={(checked) =>
                sync((current) => ({
                  ...current,
                  accessibility: { ...current.accessibility, compactDensity: checked },
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card ref={notificationRef} className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <SwitchRow
            title="Email notifications"
            description="Receive updates for analysis and alerts by email."
            checked={store.notifications.email}
            onCheckedChange={(checked) =>
              sync((current) => ({
                ...current,
                notifications: { ...current.notifications, email: checked },
              }))
            }
          />
          <SwitchRow
            title="Desktop notifications"
            description="Browser notifications for high-priority events."
            checked={store.notifications.desktop}
            onCheckedChange={(checked) =>
              sync((current) => ({
                ...current,
                notifications: { ...current.notifications, desktop: checked },
              }))
            }
          />
          <SwitchRow
            title="Weekly summary"
            description="Send a weekly digest of progress and open tasks."
            checked={store.notifications.weeklySummary}
            onCheckedChange={(checked) =>
              sync((current) => ({
                ...current,
                notifications: { ...current.notifications, weeklySummary: checked },
              }))
            }
          />
          <SwitchRow
            title="Risk alerts"
            description="Immediate alerts for high confidence risk findings."
            checked={store.notifications.riskAlerts}
            onCheckedChange={(checked) =>
              sync((current) => ({
                ...current,
                notifications: { ...current.notifications, riskAlerts: checked },
              }))
            }
          />
        </CardContent>
      </Card>

      <Card ref={securityRef} className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Security</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border p-3 space-y-2">
            <Label htmlFor="auto-lock">Auto-lock (minutes)</Label>
            <Input
              id="auto-lock"
              type="number"
              min={1}
              value={store.security.autoLockMinutes}
              onChange={(e) =>
                sync((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    autoLockMinutes: Number(e.target.value) || 1,
                  },
                }))
              }
            />
          </div>
          <div className="rounded-md border p-3 space-y-2">
            <Label htmlFor="session-timeout">Session timeout (minutes)</Label>
            <Input
              id="session-timeout"
              type="number"
              min={5}
              value={store.security.sessionTimeoutMinutes}
              onChange={(e) =>
                sync((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    sessionTimeoutMinutes: Number(e.target.value) || 5,
                  },
                }))
              }
            />
          </div>
          <div className="rounded-md border p-3 flex items-center justify-between md:col-span-2">
            <div>
              <div className="font-medium">Require face verification for sensitive actions</div>
              <div className="text-xs text-muted-foreground">Applies to export, delete, and policy reset actions.</div>
            </div>
            <Switch
              checked={store.security.requireFaceForSensitiveActions}
              onCheckedChange={(checked) =>
                sync((current) => ({
                  ...current,
                  security: {
                    ...current.security,
                    requireFaceForSensitiveActions: checked,
                  },
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card ref={integrationRef} className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>OCR Studio and Web Search Integrations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border p-3 space-y-2">
              <Label>OCR Provider</Label>
              <Select
                value={integrations.ocrProvider}
                onValueChange={(value: "local" | "ocrspace" | "custom") =>
                  setIntegrations((current) => ({ ...current, ocrProvider: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local Tesseract</SelectItem>
                  <SelectItem value="ocrspace">OCR.Space API</SelectItem>
                  <SelectItem value="custom">Custom OCR Endpoint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>OCR Engine Profile</Label>
              <Select
                value={integrations.ocrEngineProfile}
                onValueChange={(value: "speed" | "balanced" | "accuracy") =>
                  setIntegrations((current) => ({ ...current, ocrEngineProfile: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="speed">Speed (faster)</SelectItem>
                  <SelectItem value="balanced">Balanced</SelectItem>
                  <SelectItem value="accuracy">Accuracy (best quality)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>OCR Language</Label>
              <Input
                value={integrations.ocrLanguage}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrLanguage: e.target.value || "eng" }))}
                placeholder="eng"
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label htmlFor="ocr-upscale">Image Upscale (1.0 - 3.0)</Label>
              <Input
                id="ocr-upscale"
                type="number"
                min={1}
                max={3}
                step={0.1}
                value={integrations.ocrUpscale}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrUpscale: Number(e.target.value) || 1 }))}
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label htmlFor="ocr-retries">OCR Retries (0 - 5)</Label>
              <Input
                id="ocr-retries"
                type="number"
                min={0}
                max={5}
                step={1}
                value={integrations.ocrRetries}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrRetries: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label htmlFor="ocr-timeout">OCR Timeout (ms)</Label>
              <Input
                id="ocr-timeout"
                type="number"
                min={5000}
                max={120000}
                step={1000}
                value={integrations.ocrTimeoutMs}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrTimeoutMs: Number(e.target.value) || 30000 }))}
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label htmlFor="ocr-min-confidence">Min Confidence (0 - 100)</Label>
              <Input
                id="ocr-min-confidence"
                type="number"
                min={0}
                max={100}
                step={1}
                value={integrations.ocrMinConfidence}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrMinConfidence: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="rounded-md border p-3 flex items-center justify-between md:col-span-2">
              <div>
                <div className="font-medium">Preprocess images before OCR</div>
                <div className="text-xs text-muted-foreground">Grayscale/contrast cleanup to improve scanned document extraction.</div>
              </div>
              <Switch
                checked={integrations.ocrPreprocessImages}
                onCheckedChange={(checked) => setIntegrations((current) => ({ ...current, ocrPreprocessImages: checked }))}
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>OCR.Space API Key</Label>
              <Input
                value={integrations.ocrSpaceApiKey}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrSpaceApiKey: e.target.value }))}
                placeholder="If using OCR.Space"
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>Custom OCR Endpoint</Label>
              <Input
                value={integrations.ocrCustomEndpoint}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrCustomEndpoint: e.target.value }))}
                placeholder="https://your-api/ocr"
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>Private OCR Request Mode</Label>
              <Select
                value={integrations.ocrCustomRequestMode}
                onValueChange={(value: "multipart" | "json-base64") =>
                  setIntegrations((current) => ({ ...current, ocrCustomRequestMode: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="multipart">multipart/form-data</SelectItem>
                  <SelectItem value="json-base64">JSON + base64 image</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>Custom OCR API Key</Label>
              <Input
                value={integrations.ocrCustomApiKey}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrCustomApiKey: e.target.value }))}
                placeholder="Private OCR API key"
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>Private OCR API Key Header</Label>
              <Input
                value={integrations.ocrCustomApiKeyHeader}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrCustomApiKeyHeader: e.target.value }))}
                placeholder="x-api-key"
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>Private OCR Text Path</Label>
              <Input
                value={integrations.ocrCustomTextPath}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrCustomTextPath: e.target.value }))}
                placeholder="text or result.text"
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>Private OCR Confidence Path</Label>
              <Input
                value={integrations.ocrCustomConfidencePath}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrCustomConfidencePath: e.target.value }))}
                placeholder="confidence or result.confidence"
              />
            </div>
            <div className="rounded-md border p-3 space-y-2 md:col-span-2">
              <Label>Private OCR Extra Headers (JSON)</Label>
              <Textarea
                value={integrations.ocrCustomExtraHeadersJson}
                onChange={(e) => setIntegrations((current) => ({ ...current, ocrCustomExtraHeadersJson: e.target.value }))}
                placeholder='{\"x-tenant\":\"acme\",\"x-env\":\"prod\"}'
                rows={3}
              />
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>Web Search Provider</Label>
              <Select
                value={integrations.webSearchProvider}
                onValueChange={(value: "hybrid" | "custom") =>
                  setIntegrations((current) => ({ ...current, webSearchProvider: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hybrid">Hybrid (Wikipedia + DuckDuckGo)</SelectItem>
                  <SelectItem value="custom">Custom Search Endpoint</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <Label>Web Search API Key</Label>
              <Input
                value={integrations.webSearchApiKey}
                onChange={(e) => setIntegrations((current) => ({ ...current, webSearchApiKey: e.target.value }))}
                placeholder="Bearer token for custom endpoint"
              />
            </div>
            <div className="rounded-md border p-3 space-y-2 md:col-span-2">
              <Label>Custom Search Endpoint</Label>
              <Input
                value={integrations.webSearchCustomEndpoint}
                onChange={(e) => setIntegrations((current) => ({ ...current, webSearchCustomEndpoint: e.target.value }))}
                placeholder="https://your-api/search"
              />
            </div>
          </div>
          <Button onClick={saveIntegrations}>Save Integration Settings</Button>
        </CardContent>
      </Card>

      <Card ref={dataRef} className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Data and Restore</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border p-3 text-sm">Approximate local data usage: {currentDataUsage} KB</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportSettings}>
              <Download className="h-4 w-4 mr-2" />
              Export Settings
            </Button>
            <Button variant="outline" onClick={resetSettings}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reset Settings
            </Button>
            <Button variant="destructive" onClick={clearWorkspaceData}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Workspace Data
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const SwitchRow = ({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => (
  <div className="rounded-md border p-3 flex items-center justify-between gap-4">
    <div>
      <div className="font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
    <Switch checked={checked} onCheckedChange={onCheckedChange} />
  </div>
);

