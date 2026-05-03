import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export type ScoreDimension = {
  score: number;
  weight: number;
  reasoning: string;
};

export type ScoreBreakdown = {
  skillsMatch: ScoreDimension;
  experienceDepth: ScoreDimension;
  communication: ScoreDimension;
  clientFit: ScoreDimension;
  stability: ScoreDimension;
  autonomy: ScoreDimension;
};

const DIMENSIONS: {
  key: keyof ScoreBreakdown;
  label: string;
  abbr: string;
  description: string;
  weight: number;
}[] = [
  {
    key: "skillsMatch",
    label: "Skills Match",
    abbr: "Skills",
    description: "Technical skill coverage vs. must-haves",
    weight: 0.25,
  },
  {
    key: "experienceDepth",
    label: "Experience Depth",
    abbr: "Experience",
    description: "Depth and relevance of hands-on experience",
    weight: 0.20,
  },
  {
    key: "communication",
    label: "Communication",
    abbr: "Comm.",
    description: "Clarity, professionalism, and stakeholder communication signals",
    weight: 0.20,
  },
  {
    key: "clientFit",
    label: "Client Fit",
    abbr: "Client",
    description: "Alignment with client culture, values, and working style",
    weight: 0.20,
  },
  {
    key: "stability",
    label: "Stability",
    abbr: "Stability",
    description: "Tenure patterns and likelihood of long-term commitment",
    weight: 0.10,
  },
  {
    key: "autonomy",
    label: "Autonomy",
    abbr: "Autonomy",
    description: "Evidence of owning projects end-to-end without heavy direction",
    weight: 0.05,
  },
];

function barColor(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-amber-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

function scoreTextColor(score: number) {
  if (score >= 80) return "text-green-700";
  if (score >= 60) return "text-amber-700";
  if (score >= 40) return "text-orange-700";
  return "text-red-700";
}

interface Props {
  breakdown: ScoreBreakdown;
  /** compact = inline bars only; expanded = bars + reasoning */
  defaultExpanded?: boolean;
  showToggle?: boolean;
  className?: string;
}

export function ScoreBreakdownDisplay({
  breakdown,
  defaultExpanded = false,
  showToggle = true,
  className = "",
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={className}>
      {/* dimension bars row */}
      <div className="space-y-2">
        {DIMENSIONS.map((dim) => {
          const d = breakdown[dim.key];
          const score = d?.score ?? 0;
          const weightedContrib = Math.round(score * dim.weight);

          return (
            <div key={dim.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-foreground truncate">
                    {dim.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {Math.round(dim.weight * 100)}% weight
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-[10px] text-muted-foreground">
                    +{weightedContrib} pts
                  </span>
                  <span className={`text-xs font-bold w-8 text-right ${scoreTextColor(score)}`}>
                    {score}
                  </span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor(score)}`}
                  style={{ width: `${score}%` }}
                />
              </div>
              {expanded && d?.reasoning && (
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed pl-0.5">
                  {d.reasoning}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* toggle */}
      {showToggle && (
        <button
          className="mt-2.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Hide reasoning
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Show reasoning per dimension
            </>
          )}
        </button>
      )}
    </div>
  );
}

/** Compact inline pill version for tables */
export function ScoreBreakdownPills({
  breakdown,
}: {
  breakdown: ScoreBreakdown;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {DIMENSIONS.map((dim) => {
        const d = breakdown[dim.key];
        const score = d?.score ?? 0;
        return (
          <div
            key={dim.key}
            title={`${dim.label}: ${score}/100\n${d?.reasoning ?? ""}`}
            className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${
              score >= 80
                ? "bg-green-50 border-green-200 text-green-700"
                : score >= 60
                ? "bg-amber-50 border-amber-200 text-amber-700"
                : score >= 40
                ? "bg-orange-50 border-orange-200 text-orange-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            <span>{dim.abbr}</span>
            <span className="font-bold">{score}</span>
          </div>
        );
      })}
    </div>
  );
}
