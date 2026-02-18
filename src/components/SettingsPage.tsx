import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTheme } from "@/components/ThemeProvider";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

function useStoredState<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const storedValue = localStorage.getItem(key);
      return storedValue !== null ? JSON.parse(storedValue) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

export const SettingsPage = () => {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const currentLanguage = i18n.language === "hi" ? "hi" : "en";
  const [emailNotifications, setEmailNotifications] = useStoredState("settings-email-notifications", true);
  const [pushNotifications, setPushNotifications] = useStoredState("settings-push-notifications", false);
  const [language, setLanguage] = useStoredState("settings-language", currentLanguage);
  const [isLangDialogOpen, setIsLangDialogOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language, i18n]);

  const handleClearCache = () => {
    localStorage.clear();
    toast({
      title: t("clear_cache"),
      description: t("clear_cache_confirm_description"),
    });
    setTimeout(() => window.location.reload(), 1500);
  };

  const handleLanguageChange = (lang: string) => {
    if (lang !== language) {
      setSelectedLanguage(lang);
      setIsLangDialogOpen(true);
    }
  };

  const handleDeleteAccount = () => {
    const currentUserProfileString = localStorage.getItem("userProfile");
    if (!currentUserProfileString) return;

    const currentUserProfile = JSON.parse(currentUserProfileString);
    const currentUserEmail = currentUserProfile.email;

    const storedUsers = JSON.parse(localStorage.getItem("users") || "[]");
    const updatedUsers = storedUsers.filter((user: any) => user.email !== currentUserEmail);
    localStorage.setItem("users", JSON.stringify(updatedUsers));

    localStorage.removeItem("userProfile");

    toast({
      title: t("account_deleted"),
      description: t("account_deleted_description"),
    });
    navigate("/");
  };

  const confirmLanguageChange = () => {
    if (selectedLanguage) {
      setLanguage(selectedLanguage);
    }
    setIsLangDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">{t("settings_title")}</h2>
        <p className="text-muted-foreground">{t("settings_description")}</p>
      </div>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>{t("appearance")}</CardTitle>
          <CardDescription>{t("appearance_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <Label htmlFor="dark-mode" className="flex flex-col space-y-1">
              <span>{t("dark_mode")}</span>
              <span className="font-normal leading-snug text-muted-foreground">{t("dark_mode_description")}</span>
            </Label>
            <Switch id="dark-mode" checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
          </div>
        </CardContent>
      </Card>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>{t("notifications")}</CardTitle>
          <CardDescription>{t("notifications_description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <Label htmlFor="email-notifications" className="flex flex-col space-y-1">
              <span>{t("email_notifications")}</span>
              <span className="font-normal leading-snug text-muted-foreground">{t("email_notifications_description")}</span>
            </Label>
            <Switch id="email-notifications" checked={emailNotifications} onCheckedChange={setEmailNotifications} />
          </div>
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <Label htmlFor="push-notifications" className="flex flex-col space-y-1">
              <span>{t("push_notifications")}</span>
              <span className="font-normal leading-snug text-muted-foreground">{t("push_notifications_description")}</span>
            </Label>
            <Switch id="push-notifications" checked={pushNotifications} onCheckedChange={setPushNotifications} disabled />
          </div>
        </CardContent>
      </Card>

      <Card className="dashboard-card-effect">
        <CardHeader>
          <CardTitle>{t("language_region")}</CardTitle>
          <CardDescription>{t("language_region_description")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Label htmlFor="language">{t("language")}</Label>
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger id="language" className="w-[280px]">
              <SelectValue placeholder="Select a language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="hi">Hindi</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="dashboard-card-effect border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t("data_management")}</CardTitle>
          <CardDescription>{t("data_management_description")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">{t("clear_cache")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("clear_cache_confirm_title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("clear_cache_confirm_description")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearCache}>{t("continue")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <p className="text-sm text-muted-foreground mt-2">This will reset your application to its default state.</p>
        </CardContent>
      </Card>

      <Card className="dashboard-card-effect border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t("account_management")}</CardTitle>
          <CardDescription>{t("account_management_description")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">{t("delete_account")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete_account_confirm_title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("delete_account_confirm_description")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAccount} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {t("delete_account_confirm_button")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <p className="text-sm text-muted-foreground mt-2">{t("delete_account_warning")}</p>
        </CardContent>
      </Card>

      <AlertDialog open={isLangDialogOpen} onOpenChange={setIsLangDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>Changing the language will reload the application.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedLanguage(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLanguageChange}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
