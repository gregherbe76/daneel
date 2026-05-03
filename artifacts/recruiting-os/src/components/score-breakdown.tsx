import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";

export type ScoreDimension = {
  score: number;
  weight: number;
  reasoning: string;
};

export type ScoreBreakdown = {
  autonomy: ScoreDimension;
  productMindset: ScoreDimension;
  impact: ScoreDimension;
};

/** Per-job scoring weights as integer percentages (0-100). Must sum to 100. */
export type ScoringWeights = {
  autonomy: number;
  productMindset: number;
  impact: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  autonomy: 35,
  productMindset: 30,
  impact: 35,
};

type DimensionMeta = {
  key: keyof ScoringWeights;
  label: string;
  abbr: string;
  description: string;
};

const DIMENSION_META: DimensionMeta[] = [
  {
    key: "autonomy",
    label: "Autonomy & Ownership",
    abbr: "Autonomy",
    description: "Evidence they can run with projects end-to-end and make decisions without heavy direction.",
  },
  {
    key: "productMindset",
    label: "Product Mindset",
    abbr: "Product",
    description: "Whether they think about users and business outcomes, not just shipping tasks.",
  },
  {
    key: "impact",
    label: "Impact",
    abbr: "Impact",
    description: "Concrete shipped outcomes, measurable results, and the scope of work they've actually delivered.",
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
  /** Per-job weights (integer percentages). Falls back to defaults when omitted. */
  weights?: ScoringWeights;
  /** compact = inline bars only; expanded = bars + reasoning */
  defaultExpanded?: boolean;
  showToggle?: boolean;
  className?: string;
}

export function ScoreBreakdownDisplay({
  breakdown,
  weights = DEFAULT_SCORING_WEIGHTS,
  defaultExpanded = false,
  showToggle = true,
  className = "",
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={className}>
      <div className="space-y-2">
        {DIMENSION_META.map((dim) => {
          const d = breakdown[dim.key];
          if (!d) return null;
          const score = d.score ?? 0;
          const weightPct = weights[dim.key] ?? 0;
          const weightedContrib = Math.round((score * weightPct) / 100);

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
                    {weightPct}% weight
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
      {DIMENSION_META.map((dim) => {
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
