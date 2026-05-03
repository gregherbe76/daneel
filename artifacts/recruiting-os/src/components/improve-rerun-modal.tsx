import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";

export type ImproveRerunCandidate = {
  candidateId: number;
  name: string;
  headline?: string | null;
  confidenceLevel?: string | null;
  dataConfidenceScore?: number | null;
  missingDataWarnings?: string[];
  requiresEnrichment?: boolean | null;
  confidenceReason?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: ImproveRerunCandidate[];
  onConfirm: () => void;
  isSubmitting: boolean;
};

const confidenceBadgeClass = (level?: string | null, score?: number | null) => {
  if (level === "Low" || (typeof score === "number" && score < 50)) {
    return "border-red-200 bg-red-500/10 text-red-700";
  }
  if (level === "Medium" || (typeof score === "number" && score < 75)) {
    return "border-amber-200 bg-amber-500/10 text-amber-700";
  }
  return "border-muted bg-muted text-muted-foreground";
};

export function ImproveRerunModal({
  open,
  onOpenChange,
  candidates,
  onConfirm,
  isSubmitting,
}: Props) {
  const count = candidates.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-600" />
            Improve and Rerun
          </DialogTitle>
          <DialogDescription>
            {count === 0
              ? "No low-confidence candidates were detected in this run."
              : `The following ${count} candidate${count === 1 ? "" : "s"} will be enriched with additional data, then the workflow will re-score everyone in a new run. Your original run is preserved.`}
          </DialogDescription>
        </DialogHeader>

        {count > 0 && (
          <ScrollArea className="max-h-[360px] pr-3 -mr-3">
            <ul className="space-y-2">
              {candidates.map((c) => {
                const warnings = c.missingDataWarnings ?? [];
                const score = c.dataConfidenceScore;
                return (
                  <li
                    key={c.candidateId}
                    className="border border-border rounded-md p-3 bg-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        {c.headline && (
                          <p className="text-xs text-muted-foreground truncate">
                            {c.headline}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] shrink-0 ${confidenceBadgeClass(c.confidenceLevel, score)}`}
                      >
                        {c.confidenceLevel ?? "Low"} confidence
                        {typeof score === "number" ? ` · ${score}%` : ""}
                      </Badge>
                    </div>

                    {(warnings.length > 0 || c.requiresEnrichment || c.confidenceReason) && (
                      <div className="mt-2 space-y-1">
                        {warnings.map((w, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-1.5 text-[11px] text-amber-800"
                          >
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-600" />
                            <span>{w}</span>
                          </div>
                        ))}
                        {warnings.length === 0 && c.confidenceReason && (
                          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-600" />
                            <span>{c.confidenceReason}</span>
                          </div>
                        )}
                        {warnings.length === 0 && !c.confidenceReason && c.requiresEnrichment && (
                          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-amber-600" />
                            <span>Profile flagged for enrichment — limited data available.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isSubmitting || count === 0}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Start
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
