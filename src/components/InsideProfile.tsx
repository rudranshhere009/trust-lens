import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Camera, Save, RotateCcw, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import type { AppTrack } from "@/utils/insideData";
import {
  createProfileActivity,
  emitProfileUpdated,
  loadInsideProfileStore,
  mirrorToUserProfile,
  updateInsideProfileStore,
} from "@/utils/insideProfileData";
import { SECTION_ACTION_EVENT, isSectionActionDetail } from "@/utils/sectionActionEvents";

interface InsideProfileProps {
  mode: AppTrack;
}

const TRACK_ROLE: Record<AppTrack, string> = {
  legal: "Legal Investigation Analyst",
  compliance: "Compliance Operations Analyst",
  truthdesk: "Verification Desk Analyst",
};

export const InsideProfile = ({ mode }: InsideProfileProps) => {
  const [store, setStore] = useState(() => loadInsideProfileStore());
  const [form, setForm] = useState(() => loadInsideProfileStore());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const healthRef = useRef<HTMLDivElement | null>(null);
  const activityRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  const faceStatus = form.faceVerified ? "Verified" : "Pending";

  const completion = useMemo(() => {
    let score = 0;
    if (form.name.trim()) score += 20;
    if (form.email.trim()) score += 20;
    if (form.phone.trim()) score += 15;
    if (form.title.trim()) score += 15;
    if (form.bio.trim()) score += 15;
    if (form.photoUrl) score += 15;
    return score;
  }, [form]);

  const setField = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleAvatarPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({ ...current, photoUrl: String(reader.result || "") }));
    };
    reader.readAsDataURL(file);
  };

  const save = () => {
    const normalized = {
      ...form,
      name: form.name.trim() || "User",
      title: form.title.trim() || TRACK_ROLE[mode],
      department: form.department.trim() || "Operations",
      activity: [
        {
          id: createProfileActivity(),
          label: "Profile updated",
          detail: "Saved account details and preferences.",
          at: Date.now(),
        },
        ...store.activity.slice(0, 14),
      ],
    };

    const next = updateInsideProfileStore(() => normalized);
    mirrorToUserProfile(next);
    emitProfileUpdated();
    setStore(next);
    setForm(next);
    toast({ title: "Profile saved", description: "Profile and header details are updated." });
  };

  const resetChanges = () => {
    setForm(store);
  };

  useEffect(() => {
    const onSectionAction = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isSectionActionDetail(detail) || detail.tab !== "profile" || detail.mode !== mode) return;

      if (detail.action === "Role + specialization" || detail.action === "Control ownership" || detail.action === "Beat/topic focus") {
        titleRef.current?.focus();
      }
      if (detail.action === "Current case load" || detail.action === "Review quality score" || detail.action === "Accuracy metrics") {
        healthRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (detail.action === "Activity log" || detail.action === "Audit participation" || detail.action === "Publication history") {
        activityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (detail.action === "Training completion" || detail.action === "Permissions") {
        setField("bio", `${form.bio ? `${form.bio}\n` : ""}Updated focus: ${detail.action}`);
      }
    };

    window.addEventListener(SECTION_ACTION_EVENT, onSectionAction);
    return () => window.removeEventListener(SECTION_ACTION_EVENT, onSectionAction);
  }, [form.bio, mode]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="dashboard-card-effect lg:col-span-2">
          <CardHeader>
            <CardTitle>Profile Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={form.photoUrl} alt={form.name} />
                <AvatarFallback>{form.name?.charAt(0)?.toUpperCase() || "U"}</AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                  <Camera className="h-4 w-4 mr-2" />
                  Change Photo
                </Button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarPick} />
                <div className="text-xs text-muted-foreground">PNG/JPG image is stored locally on this device.</div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Full name</Label>
                <Input id="profile-name" value={form.name} onChange={(e) => setField("name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-title">Title</Label>
                <Input ref={titleRef} id="profile-title" value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder={TRACK_ROLE[mode]} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-dept">Department</Label>
                <Input id="profile-dept" value={form.department} onChange={(e) => setField("department", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-timezone">Timezone</Label>
                <Input id="profile-timezone" value={form.timezone} onChange={(e) => setField("timezone", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-phone">Phone</Label>
                <Input id="profile-phone" value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-bio">Bio</Label>
              <Textarea
                id="profile-bio"
                value={form.bio}
                onChange={(e) => setField("bio", e.target.value)}
                placeholder="Add your investigation focus, expertise, or workflow notes..."
                rows={4}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save}>
                <Save className="h-4 w-4 mr-2" />
                Save Profile
              </Button>
              <Button variant="outline" onClick={resetChanges}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset Changes
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card ref={healthRef} className="dashboard-card-effect">
          <CardHeader>
            <CardTitle>Profile Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Completion</div>
              <div className="text-2xl font-bold">{completion}%</div>
            </div>
            <div className="rounded-md border p-3 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Face Verification</div>
                <div className="font-medium flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  {faceStatus}
                </div>
              </div>
              <Badge variant={form.faceVerified ? "secondary" : "outline"}>{faceStatus}</Badge>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Last Login</div>
              <div className="font-medium">{new Date(form.lastLoginAt).toLocaleString()}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Active Track</div>
              <div className="font-medium">{TRACK_ROLE[mode]}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card ref={activityRef} className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>Recent Account Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {store.activity.length ? (
            store.activity.map((item) => (
              <div key={item.id} className="rounded-md border p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{item.label}</div>
                  <div className="text-sm text-muted-foreground">{item.detail}</div>
                </div>
                <div className="text-xs text-muted-foreground">{new Date(item.at).toLocaleString()}</div>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted-foreground">No activity yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
