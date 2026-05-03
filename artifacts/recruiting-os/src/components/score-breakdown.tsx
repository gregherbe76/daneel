import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";

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
  productMindset: ScoreDimension;
  softSkills: ScoreDimension;
  cultureFit: ScoreDimension;
  longTermPotential: ScoreDimension;
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
    description: "How well the candidate's skills line up with the must-haves you listed for this role.",
    weight: 0.23,
  },
  {
    key: "experienceDepth",
    label: "Experience Depth",
    abbr: "Experience",
    description: "Whether their past hands-on experience matches the seniority you need.",
    weight: 0.20,
  },
  {
    key: "softSkills",
    label: "Soft Skills",
    abbr: "Soft",
    description: "Communication, empathy and adaptability shown in their profile.",
    weight: 0.15,
  },
  {
    key: "autonomy",
    label: "Autonomy & Ownership",
    abbr: "Autonomy",
    description: "Evidence they can run with projects and make decisions on their own.",
    weight: 0.13,
  },
  {
    key: "cultureFit",
    label: "Culture Fit",
    abbr: "Culture",
    description: "How aligned they look with your team's stated values and ways of working.",
    weight: 0.10,
  },
  {
    key: "longTermPotential",
    label: "Long-Term Potential",
    abbr: "Growth",
    description: "Their growth trajectory and learning agility — how far they could go on your team.",
    weight: 0.10,
  },
  {
    key: "productMindset",
    label: "Product Mindset",
    abbr: "Product",
    description: "Whether they think about users and business impact, not just execution.",
    weight: 0.09,
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
          if (!d) return null;
          const score = d.score ?? 0;
          const weightedContrib = Math.round(score * dim.weight);

          return (
            <div key={dim.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-xs font-medium text-foreground truncate inline-flex items-center gap-1"
                    title={dim.description}
                  >
                    {dim.label}
                    <Info className="h-3 w-3 text-muted-foreground shrink-0" />
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
        if (!d) return null;
        const score = d.score ?? 0;
        return (
          <div
            key={dim.key}
            title={`${dim.label}: ${score}/100\n${d.reasoning ?? ""}`}
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
