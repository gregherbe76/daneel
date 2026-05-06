import { useEffect, useState } from "react";
import { useListJobs, usePreviewGithubQuery } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, Loader2, Search } from "lucide-react";

export interface GithubProviderConfig {
  extraKeywords?: string | null;
  excludeOrgs?: string | null;
  minFollowers?: number | null;
  minRepos?: number | null;
  requireBio?: boolean | null;
  activeWithinMonths?: number | null;
}

// ── github query preview ─────────────────────────────────────────────────────
//
// Lets recruiters see the exact `q=` string the GitHub Agent will send for a
// chosen sample job — applying the *currently entered* tuning knobs (even
// before they hit Save). Optional "Preview matches" hits the live GitHub
// search API once and reports total_count.
export function GithubQueryPreview({
  config,
  editProviderId,
}: {
  config: GithubProviderConfig;
  editProviderId: number | null;
}) {
  const { data: jobs = [], isLoading: jobsLoading } = useListJobs();
  const previewMutation = usePreviewGithubQuery();

  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [result, setResult] = useState<{
    query: string;
    totalCount?: number | null;
    totalCountError?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jobList = jobs as Array<{ id: number; title: string; location?: string | null }>;

  // Auto-pick the first job once they load so the preview is one click away.
  useEffect(() => {
    if (!selectedJobId && jobList.length > 0) {
      setSelectedJobId(String(jobList[0].id));
    }
  }, [jobList, selectedJobId]);

  async function runPreview(runMatches: boolean) {
    if (!selectedJobId) return;
    setError(null);
    try {
      const res = await previewMutation.mutateAsync({
        data: {
          jobId: parseInt(selectedJobId, 10),
          providerId: editProviderId ?? undefined,
          // Always send the inline config so unsaved edits are reflected.
          config,
          runMatches,
        },
      });
      setResult(res as typeof result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    }
  }

  const isPending = previewMutation.isPending;

  return (
    <div
      className="space-y-2 rounded-md border border-dashed border-border p-3"
      data-testid="github-query-preview"
    >
      <div className="flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Preview the search query</p>
      </div>
      <p className="text-xs text-muted-foreground">
        See exactly what the GitHub Agent will send for a sample job — including the knobs above. Edits don&apos;t need to be saved first.
      </p>

      {jobsLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading jobs…
        </div>
      ) : jobList.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          Create a job first to preview a query.
        </p>
      ) : (
        <>
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Sample job</Label>
              <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                <SelectTrigger className="h-9 text-sm" data-testid="gh-preview-job-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {jobList.map((j) => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      {j.title}
                      {j.location ? ` — ${j.location}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectedJobId || isPending}
              onClick={() => runPreview(false)}
              className="gap-1.5"
              data-testid="gh-preview-build-query"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Build query
            </Button>
          </div>

          {result && (
            <div className="space-y-2 mt-2">
              <div>
                <Label className="text-xs text-muted-foreground">Assembled query</Label>
                <pre
                  className="mt-1 rounded-md bg-muted/60 border border-border p-2 text-[11px] font-mono whitespace-pre-wrap break-all text-foreground"
                  data-testid="gh-preview-query"
                >
                  {result.query}
                </pre>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending || !selectedJobId}
                  onClick={() => runPreview(true)}
                  className="gap-1.5 h-7 text-xs"
                  data-testid="gh-preview-matches"
                >
                  {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="h-3 w-3" />
                  )}
                  Preview matches
                </Button>

                {result.totalCount != null && (
                  <span className="text-xs text-foreground">
                    <strong className="font-semibold">{result.totalCount.toLocaleString()}</strong>{" "}
                    matching GitHub user{result.totalCount === 1 ? "" : "s"}
                  </span>
                )}
                {result.totalCountError && (
                  <span className="text-xs text-destructive" title={result.totalCountError}>
                    Match lookup failed: {result.totalCountError.slice(0, 80)}
                  </span>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
