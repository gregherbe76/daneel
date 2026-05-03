import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";
import {
  DEFAULT_SCORING_WEIGHTS,
  type ScoringWeights,
} from "@/components/score-breakdown";

const DIMENSIONS: { key: keyof ScoringWeights; label: string; hint: string }[] = [
  { key: "skillsMatch", label: "Skills Match", hint: "Coverage of must-have skills" },
  { key: "experienceDepth", label: "Experience Depth", hint: "Hands-on seniority depth" },
  { key: "softSkills", label: "Soft Skills", hint: "Communication, empathy, adaptability" },
  { key: "autonomy", label: "Autonomy & Ownership", hint: "End-to-end ownership" },
  { key: "cultureFit", label: "Culture Fit", hint: "Alignment with team values" },
  { key: "longTermPotential", label: "Long-Term Potential", hint: "Growth & learning agility" },
  { key: "productMindset", label: "Product Mindset", hint: "User & business impact" },
];

export function sumWeights(w: ScoringWeights): number {
  return DIMENSIONS.reduce((s, d) => s + (Number(w[d.key]) || 0), 0);
}

interface Props {
  value: ScoringWeights;
  onChange: (next: ScoringWeights) => void;
}

export function ScoringWeightsEditor({ value, onChange }: Props) {
  const total = sumWeights(value);
  const remaining = 100 - total;

  const setOne = (key: keyof ScoringWeights, raw: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(raw)));
    onChange({ ...value, [key]: clamped });
  };

  const reset = () => onChange({ ...DEFAULT_SCORING_WEIGHTS });

  const remainingColor =
    total === 100
      ? "text-green-700 bg-green-50 border-green-200"
      : "text-amber-700 bg-amber-50 border-amber-200";

  const remainingLabel =
    total === 100
      ? "Weights add up to 100%"
      : remaining > 0
      ? `${remaining}% remaining — increase a dimension`
      : `${Math.abs(remaining)}% over — reduce a dimension`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Scoring Weights</p>
          <p className="text-xs text-muted-foreground">
            Tune how much each dimension counts toward the fit score for this role.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium px-2 py-1 rounded border ${remainingColor}`}
            data-testid="scoring-weights-remaining"
          >
            {remainingLabel}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={reset} className="text-xs">
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
        {DIMENSIONS.map((dim) => {
          const v = Number(value[dim.key]) || 0;
          return (
            <div key={dim.key} className="grid grid-cols-[1fr_auto] gap-3 items-center">
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground" htmlFor={`w-${dim.key}`}>
                    {dim.label}
                  </label>
                  <span className="text-[10px] text-muted-foreground">{dim.hint}</span>
                </div>
                <Slider
                  id={`w-${dim.key}`}
                  min={0}
                  max={100}
                  step={1}
                  value={[v]}
                  onValueChange={(vals) => setOne(dim.key, vals[0] ?? 0)}
                />
              </div>
              <Input
                type="number"
                min={0}
                max={100}
                value={v}
                onChange={(e) => setOne(dim.key, Number(e.target.value))}
                className="w-20 text-right tabular-nums"
                aria-label={`${dim.label} weight`}
                data-testid={`scoring-weight-${dim.key}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
