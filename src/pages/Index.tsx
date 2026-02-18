import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { InsideRebuild } from "@/components/InsideRebuild";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { UserCog, LogOut } from "lucide-react";
import { PROFILE_UPDATED_EVENT } from "@/utils/insideProfileData";

interface UserProfile {
  name: string;
  email: string;
  photoUrl: string;
  faceVerified: boolean;
}

const emptyProfile: UserProfile = {
  name: "User",
  email: "",
  photoUrl: "",
  faceVerified: false,
};

const normalizeTab = (tab: string) => {
  if (tab === "profile" || tab === "settings") return "resources";
  if (tab === "education" || tab === "learn") return "resources";
  return tab;
};

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCollapsed, setIsCollapsed] = useState(true);
  const initialTab = normalizeTab(searchParams.get("tab") || "dashboard");
  const [activeTab, setActiveTab] = useState(initialTab);

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const savedProfile = localStorage.getItem("userProfile");
      if (!savedProfile) return emptyProfile;
      const parsed = JSON.parse(savedProfile) as Partial<UserProfile>;
      return {
        ...emptyProfile,
        ...parsed,
        name: parsed.name?.trim() || "User",
      };
    } catch {
      return emptyProfile;
    }
  });

  useEffect(() => {
    localStorage.setItem("userProfile", JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    const refreshProfile = () => {
      try {
        const raw = localStorage.getItem("userProfile");
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<UserProfile>;
        setUserProfile((current) => ({
          ...current,
          ...parsed,
          name: parsed.name?.trim() || current.name || "User",
        }));
      } catch {
        // Ignore invalid local profile payloads
      }
    };

    window.addEventListener(PROFILE_UPDATED_EVENT, refreshProfile);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, refreshProfile);
  }, []);

  useEffect(() => {
    const tab = normalizeTab(searchParams.get("tab") || "dashboard");
    setActiveTab(tab);
  }, [searchParams]);

  const handleTabChange = (tab: string) => {
    const normalized = normalizeTab(tab);
    setActiveTab(normalized);
    setSearchParams({ tab: normalized });
  };

  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("userProfile");
    setUserProfile(emptyProfile);
    navigate("/");
  };

  const getPageTitle = () => {
    switch (activeTab) {
      case "dashboard":
        return "Dashboard";
      case "documents":
        return "Document Analysis";
      case "misinformation":
        return "Fact Check";
      case "chat":
        return "AI Assistant";
      case "infantry":
        return "Infantry";
      case "resources":
        return "Resource Center";
      default:
        return "Dashboard";
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Navigation activeTab={activeTab} onTabChange={handleTabChange} isCollapsed={isCollapsed} onToggle={() => setIsCollapsed(!isCollapsed)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b p-4 h-16 flex-shrink-0">
          <h1 className="text-xl font-bold tracking-tight">{getPageTitle()}</h1>
          <div className="flex items-center space-x-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-10 w-auto px-3 space-x-3">
                  <span className="text-right">
                    <div className="font-medium">Hi, {userProfile.name}</div>
                  </span>
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={userProfile.photoUrl} alt="User avatar" />
                    <AvatarFallback>{userProfile.name?.charAt(0).toUpperCase() || "U"}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{userProfile.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{userProfile.email || "No email set"}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => handleTabChange("resources")}>
                  <UserCog className="mr-2 h-4 w-4" />
                  <span>Resources</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 bg-muted/40">
          <InsideRebuild activeTab={activeTab} />
        </main>
      </div>
    </div>
  );
};

export default Index;
