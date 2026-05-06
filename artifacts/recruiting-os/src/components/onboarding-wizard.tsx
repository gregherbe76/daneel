import { useEffect, useState } from "react";
import { Check, ChevronRight, Sparkles, Users, FileText, X, Settings2 } from "lucide-react";
import { branding } from "@workspace/branding";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const STORAGE_KEY = "daneel.onboarding.dismissed";

type StepKey = "providers" | "candidates" | "screening" | "picks";

interface Step {
  key: StepKey;
  title: string;
  helper: string;
  icon: typeof Users;
  done: boolean;
  cta?: { label: string; onClick: () => void };
}

interface Props {
  jobId: number;
  hasProviders: boolean;
  hasCandidates: boolean;
  hasCompletedRun: boolean;
  onAddCandidates: () => void;
  onRunScreening: () => void;
  onConfigureProviders?: () => void;
}

export function OnboardingWizard({
  hasProviders,
  hasCandidates,
  hasCompletedRun,
  onAddCandidates,
  onRunScreening,
  onConfigureProviders,
}: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  const steps: Step[] = [
    {
      key: "providers",
      title: "Connect a screening engine",
      helper: "Pick the AI provider that will read profiles for you. The default works out of the box.",
      icon: Settings2,
      done: hasProviders,
      cta: onConfigureProviders ? { label: "Open settings", onClick: onConfigureProviders } : undefined,
    },
    {
      key: "candidates",
      title: "Add a few candidates",
      helper: `Paste LinkedIn URLs, upload CVs, or let ${branding.productName} find people for you.`,
      icon: Users,
      done: hasCandidates,
      cta: { label: "Add candidates", onClick: onAddCandidates },
    },
    {
      key: "screening",
      title: "Run AI Workflow",
      helper: `We'll score everyone against your role using the ${branding.productName} 3-dimension rubric — usually under a minute.`,
      icon: Sparkles,
      done: hasCompletedRun,
      cta: hasCandidates && !hasCompletedRun ? { label: "Run AI workflow", onClick: onRunScreening } : undefined,
    },
    {
      key: "picks",
      title: "Review your shortlist",
      helper: "Open the shareable hiring report — strengths, gaps, and a clear recommendation per person.",
      icon: FileText,
      done: hasCompletedRun,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = Math.round((completed / total) * 100);
  const allDone = completed === total;

  useEffect(() => {
    if (allDone && !dismissed) {
      window.localStorage.setItem(STORAGE_KEY, "1");
      setDismissed(true);
    }
  }, [allDone, dismissed]);

  if (dismissed || allDone) return null;

  // Find the active (next-to-do) step
  const activeIdx = steps.findIndex((s) => !s.done);

  const handleDismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="border border-primary/20 bg-gradient-to-br from-primary/[0.04] to-background rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold">Welcome to {branding.productName}</h3>
            <span className="text-xs text-muted-foreground">
              {completed} of {total} done · {pct}%
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            A guided setup so you can go from job to shortlist in one flow.
          </p>
          <Progress value={pct} className="h-1.5 mt-3" />
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Hide setup checklist"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="divide-y divide-border/50">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isActive = i === activeIdx;
          return (
            <div
              key={step.key}
              className={`px-5 py-3 flex items-start gap-3 ${
                isActive ? "bg-primary/[0.03]" : ""
              }`}
            >
              <div
                className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold ${
                  step.done
                    ? "bg-green-500 text-white"
                    : isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Icon className={`h-3.5 w-3.5 ${step.done ? "text-green-600" : "text-muted-foreground"}`} />
                  <p
                    className={`text-sm font-medium ${
                      step.done ? "line-through text-muted-foreground" : ""
                    }`}
                  >
                    {step.title}
                  </p>
                </div>
                {!step.done && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {step.helper}
                  </p>
                )}
              </div>
              {isActive && step.cta && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={step.cta.onClick}
                  className="shrink-0"
                >
                  {step.cta.label}
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
