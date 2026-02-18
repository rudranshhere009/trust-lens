import { 
  Shield, 
  FileText, 
  MessageSquare, 
  Search, 
  BarChart3,
  UserCog,
  Hammer,
  ChevronsLeft,
  ChevronsRight
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";

interface NavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isCollapsed: boolean;
  onToggle: () => void;
}

export const Navigation = ({ activeTab, onTabChange, isCollapsed, onToggle }: NavigationProps) => {
  const { t } = useTranslation();
  const [tooltipOpenId, setTooltipOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!isCollapsed) setTooltipOpenId(null);
  }, [isCollapsed]);

  const navigationItems = [
    { id: 'dashboard', label: t('dashboard'), icon: BarChart3 },
    { id: 'documents', label: t('documents'), icon: FileText },
    { id: 'misinformation', label: t('fact_check'), icon: Search },
    { id: 'chat', label: t('ai_assistant'), icon: MessageSquare },
    { id: 'infantry', label: 'Infantry', icon: Hammer },
    { id: 'resources', label: 'Resources', icon: UserCog },
  ];

  return (
    <div className={cn("relative h-screen border-r border-border bg-card transition-all duration-300 ease-in-out", isCollapsed ? "w-20" : "w-64")}>
      <div className="flex h-full flex-col">
        <div className="p-4">
          <div className={cn("flex items-center", isCollapsed ? "justify-center" : "space-x-2")}>
            <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <Shield className="h-5 w-5 text-white" />
            </div>
            {!isCollapsed && <span className="text-xl font-bold">TrustLens</span>}
          </div>
        </div>
        
        <nav className="flex-1 space-y-2 px-4">
          {navigationItems.map((item) => (
            <Tooltip key={item.id} delayDuration={80} open={isCollapsed && tooltipOpenId === item.id}>
              <TooltipTrigger asChild>
                <Button
                  variant={activeTab === item.id ? "secondary" : "ghost"}
                  className={cn("w-full h-10", isCollapsed ? "justify-center" : "justify-start")}
                  onClick={() => onTabChange(item.id)}
                  onMouseEnter={() => isCollapsed && setTooltipOpenId(item.id)}
                  onMouseLeave={() => setTooltipOpenId((current) => (current === item.id ? null : current))}
                  onFocus={() => isCollapsed && setTooltipOpenId(item.id)}
                  onBlur={() => setTooltipOpenId((current) => (current === item.id ? null : current))}
                >
                  <item.icon className={cn("h-5 w-5", !isCollapsed && "mr-3")} />
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                  {!isCollapsed && item.badge && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {item.badge}
                    </Badge>
                  )}
                </Button>
              </TooltipTrigger>
              {isCollapsed && (
                <TooltipContent side="right" className="flex items-center gap-4">
                  {item.label}
                  {item.badge && <Badge variant="secondary">{item.badge}</Badge>}
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </nav>

        <div className="mt-auto p-4">
            <Button variant="outline" size="icon" className="w-full h-10" onClick={onToggle}>
                {isCollapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
            </Button>
        </div>
      </div>
    </div>
  );
};
