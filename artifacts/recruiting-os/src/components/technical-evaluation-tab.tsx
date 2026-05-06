import { useGetLatestJobWorkflow } from "@workspace/api-client-react";
import type { TechnicalEvaluation, TechnicalEvaluationScores } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, ExternalLink, Github } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  premium_required:
    "This candidate requires a paid CodeMatch run. Upgrade your plan at assess.codes to score them.",
  no_github_username:
    "Candidate has no public GitHub username on file. Add one to enable technical evaluation.",
  github_user_not_found:
    "CodeMatch couldn't find this GitHub user. The username on file may be wrong or the account may be private.",
  rate_limited: "CodeMatch rate-limited the request. The next workflow run will retry.",
  auth_failed:
    "CodeMatch rejected the API key. Reconnect the provider in Settings → Marketplace.",
  timeout: "CodeMatch took too long to respond. The next workflow run will retry.",
  server_error:
    "CodeMatch returned a server error. Try again — if it persists, contact assess.codes support.",
  network_error: "Network error reaching CodeMatch. The next workflow run will retry.",
  invalid_response: "CodeMatch returned a malformed response. Contact assess.codes support.",
};

type ScoreDim = Exclude<keyof TechnicalEvaluationScores, "overall">;
const DIMENSIONS: Array<{ key: ScoreDim; label: string }> = [
  { key: "technical_depth", label: "Technical depth" },
  { key: "ownership", label: "Ownership" },
  { key: "consistency", label: "Consistency" },
  { key: "taste", label: "Taste" },
  { key: "impact", label: "Impact" },
];

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 75
      ? "bg-emerald-500"
      : pct >= 50
        ? "bg-amber-500"
        : "bg-rose-500";
  return (
    <div className="space-y-1" data-testid={`tech-score-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{pct}/100</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function TechnicalEvaluationTab({
  candidateId,
  jobId,
  candidateGithubUsername,
}: {
  candidateId: number;
  jobId: number;
  candidateGithubUsername: string | null;
}) {
  const { data, isLoading, isError } = useGetLatestJobWorkflow(jobId, {
    query: { enabled: !!jobId, queryKey: [`/api/workflows/jobs/${jobId}/latest`] },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading technical evaluation…
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground italic text-center">
            No workflow run yet for this job. Run the workflow to produce technical evaluations.
          </p>
        </CardContent>
      </Card>
    );
  }

  const techEvals = (data.technicalEvaluations ?? []) as TechnicalEvaluation[];
  const evalRow = techEvals.find((te) => te.candidateId === candidateId) ?? null;

  if (!evalRow) {
    return (
      <Card data-testid="tech-eval-empty">
        <CardContent className="py-6 space-y-3">
          <p className="text-sm text-muted-foreground italic text-center">
            No technical evaluation has been run for this candidate on this job yet.
          </p>
          <p className="text-xs text-muted-foreground text-center">
            Enable “Technical evaluation” on the job edit page and re-run the workflow with a
            connected technical evaluation provider (e.g. CodeMatch).
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!evalRow.evaluated) {
    const code = evalRow.error ?? "server_error";
    const msg = ERROR_MESSAGES[code] ?? `Evaluation failed (${code}).`;
    return (
      <Card data-testid="tech-eval-failed">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-sm">Technical evaluation unavailable</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">{msg}</p>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Provider: {evalRow.providerName}</span>
            <Badge variant="outline" className="text-[10px]">
              code: {code}
            </Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  const scores = evalRow.scores;

  return (
    <div className="space-y-4">
      <Card data-testid="tech-eval-scores">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <CardTitle className="text-sm">{evalRow.providerName} — Technical Scores</CardTitle>
          </div>
          {candidateGithubUsername && (
            <a
              href={`https://github.com/${candidateGithubUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Github className="h-3 w-3" /> @{candidateGithubUsername}
            </a>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {scores && (
            <>
              <div className="flex items-baseline justify-between border-b border-border pb-3">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Overall
                </span>
                <span
                  className="text-2xl font-bold tabular-nums"
                  data-testid="tech-score-overall"
                >
                  {scores.overall}
                  <span className="text-sm font-normal text-muted-foreground">/100</span>
                </span>
              </div>
              <div className="space-y-3">
                {DIMENSIONS.map((d) => (
                  <ScoreBar key={d.key} label={d.label} value={scores[d.key] ?? 0} />
                ))}
              </div>
            </>
          )}
          {evalRow.summary && (
            <p className="text-sm text-muted-foreground leading-relaxed border-t border-border pt-3 whitespace-pre-wrap">
              {evalRow.summary}
            </p>
          )}
          {evalRow.reportUrl && (
            <a
              href={evalRow.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open full report <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </CardContent>
      </Card>

      {evalRow.strengths.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Strengths</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5" data-testid="tech-strengths">
              {evalRow.strengths.map((s, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-700 border-emerald-200"
                >
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {evalRow.redFlags.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Red flags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5" data-testid="tech-red-flags">
              {evalRow.redFlags.map((s, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="bg-rose-500/10 text-rose-700 border-rose-200"
                >
                  {s}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
