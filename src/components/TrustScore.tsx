import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface TrustScoreProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export const TrustScore = ({ score, size = 'md', showLabel = true, className }: TrustScoreProps) => {
  const getScoreColorVar = (s: number) => {
    if (s >= 70) return '--trust-high';
    if (s >= 40) return '--trust-medium';
    return '--trust-low';
  };

  const getScoreLabel = (s: number) => {
    if (s >= 70) return 'High Trust';
    if (s >= 40) return 'Medium Trust';
    return 'Low Trust';
  };

  const sizeClasses = {
    sm: 'w-12 h-12 text-base',
    md: 'w-24 h-24 text-lg',
    lg: 'w-32 h-32 text-2xl'
  };

  const radius = size === 'sm' ? 21 : 45;
  const strokeWidth = size === 'sm' ? 4 : 6;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  
  const colorVar = getScoreColorVar(score);

  const dynamicStyle = {
    backgroundColor: `hsl(var(${colorVar}) / 0.1)`,
    boxShadow: `0 0 15px hsl(var(${colorVar}) / 0.5)`
  };

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div 
        className={cn("relative rounded-full flex items-center justify-center", sizeClasses[size])}
        style={dynamicStyle}
      >
        <svg className="w-full h-full transform -rotate-90 absolute inset-0">
          <circle
            cx="50%"
            cy="50%"
            r={radius}
            stroke="hsl(var(--border) / 0.5)"
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <circle
            cx="50%"
            cy="50%"
            r={radius}
            stroke={`hsl(var(${colorVar}))`}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <span className="font-bold z-10">{score}</span>
      </div>
      {showLabel && (
        <Badge variant="outline" style={{ color: `hsl(var(${colorVar}))`, borderColor: `hsl(var(${colorVar}))` }}>
          {getScoreLabel(score)}
        </Badge>
      )}
    </div>
  );
};
