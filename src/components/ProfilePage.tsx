import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

interface Profile {
  name: string;
  email: string;
  photoUrl: string;
  faceVerified: boolean;
}

interface ProfilePageProps {
  profile: Profile;
  onSave: (profile: Profile) => void;
}

export const ProfilePage = ({ profile, onSave }: ProfilePageProps) => {
  const [localProfile, setLocalProfile] = useState(profile);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalProfile(profile);
  }, [profile]);

  const handleSave = () => {
    onSave(localProfile);
    toast({
      title: "Profile Updated",
      description: "Your changes have been saved successfully.",
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setLocalProfile((prev) => ({ ...prev, [id]: value }));
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;

    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onloadend = () => {
      setLocalProfile((prev) => ({ ...prev, photoUrl: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Profile</h2>
        <p className="text-muted-foreground">Manage your account settings and preferences.</p>
      </div>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>User Profile</CardTitle>
          <CardDescription>Update your personal information and profile picture.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex items-center space-x-6">
            <Avatar className="h-24 w-24">
              <AvatarImage src={localProfile.photoUrl} alt={localProfile.name} />
              <AvatarFallback>{localProfile.name?.charAt(0).toUpperCase() || "U"}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <Button onClick={() => fileInputRef.current?.click()}>Change Photo</Button>
              <p className="text-xs text-muted-foreground">JPG, GIF or PNG. 1MB max.</p>
              <input type="file" ref={fileInputRef} onChange={handlePhotoChange} accept="image/*" className="hidden" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input id="name" value={localProfile.name} onChange={handleChange} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={localProfile.email} onChange={handleChange} />
          </div>

          <div className="space-y-2">
            <Label>Face Verified</Label>
            <p className="text-sm text-gray-400">{localProfile.faceVerified ? "Yes" : "No"}</p>
          </div>
        </CardContent>

        <div className="px-6 pb-6">
          <Button onClick={handleSave}>Save Changes</Button>
        </div>
      </Card>
    </div>
  );
};
