import { useEffect, useState } from "react";
import {
  useGetBulkJobsSettings,
  useUpdateBulkJobsSettings,
  useListBulkJobsRuns,
  useRunBulkJobsSweepNow,
  getGetBulkJobsSettingsQueryKey,
  getListBulkJobsRunsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, RotateCcw, Activity, Play } from "lucide-react";
import { SettingsTabs } from "@/components/settings-tabs";

export default function BulkJobsSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useGetBulkJobsSettings();
  const updateMutation = useUpdateBulkJobsSettings();
  const runsQuery = useListBulkJobsRuns({
    query: {
      queryKey: getListBulkJobsRunsQueryKey(),
      refetchInterval: 15000,
    },
  });
  const sweepMutation = useRunBulkJobsSweepNow();

  const [retentionDays, setRetentionDays] = useState("7");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settingsQuery.data && !dirty) {
      setRetentionDays(String(settingsQuery.data.retentionDays));
    }
  }, [settingsQuery.data, dirty]);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      toast({
        title: "Invalid retention",
        description: "Retention must be between 1 and 365 days.",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateMutation.mutateAsync({ data: { retentionDays: days } });
      await queryClient.invalidateQueries({
        queryKey: getGetBulkJobsSettingsQueryKey(),
      });
      setDirty(false);
      toast({
        title: "Settings saved",
        description:
          "The retention sweep will use the new window on its next tick (within the hour).",
      });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const handleReset = () => {
    if (!settingsQuery.data) return;
    setRetentionDays(String(settingsQuery.data.retentionDays));
    setDirty(false);
  };

  const handleRunNow = async () => {
    try {
      const run = await sweepMutation.mutateAsync();
      await queryClient.invalidateQueries({
        queryKey: getListBulkJobsRunsQueryKey(),
      });
      if (run.errorMessage) {
        toast({
          title: "Sweep crashed",
          description: run.errorMessage,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sweep finished",
          description:
            run.deleted === 0
              ? "No old bulk-job rows needed pruning."
              : `Deleted ${run.deleted} old bulk-job row${run.deleted === 1 ? "" : "s"}.`,
        });
      }
    } catch (err) {
      toast({
        title: "Sweep failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  if (settingsQuery.isLoading) {
    return (
      <>
        <SettingsTabs />
        <div className="p-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading settings…
        </div>
      </>
    );
  }

  if (settingsQuery.error) {
    return (
      <>
        <SettingsTabs />
        <div className="p-8 text-destructive">
          Failed to load settings: {String(settingsQuery.error)}
        </div>
      </>
    );
  }

  const updatedAt = settingsQuery.data?.updatedAt
    ? new Date(settingsQuery.data.updatedAt).toLocaleString()
    : "—";

  const runs = runsQuery.data ?? [];

  return (
    <>
      <SettingsTabs />
      <div className="p-8 max-w-3xl">
        <div className="mb-8 flex items-start gap-3">
          <div className="h-10 w-10 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Trash2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Bulk-job retention
            </h1>
            <p className="text-muted-foreground mt-1">
              Completed, failed, and canceled bulk-action jobs (delete, recheck
              email, move stage, export CSV) are kept for this many days before
              the background sweep removes them. Lower values free up space on
              busy deployments; higher values keep history around for audits.
              Changes take effect on the next sweep (runs hourly).
            </p>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-card p-6 space-y-6">
          <div className="grid gap-2">
            <Label htmlFor="retention-days">Retention window (days)</Label>
            <Input
              id="retention-days"
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => {
                setRetentionDays(e.target.value);
                markDirty();
              }}
              className="max-w-xs"
              data-testid="input-bulk-jobs-retention-days"
            />
            <p className="text-xs text-muted-foreground">
              Terminal bulk-job rows older than this are deleted on the next
              hourly sweep. Must be between 1 and 365.
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div className="text-xs text-muted-foreground">
              Last updated: {updatedAt}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={!dirty || updateMutation.isPending}
                data-testid="button-bulk-jobs-reset"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button
                onClick={handleSave}
                disabled={!dirty || updateMutation.isPending}
                data-testid="button-bulk-jobs-save"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </div>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-card p-6 mt-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Recent activity
                </h2>
                <p className="text-sm text-muted-foreground">
                  The last few retention sweeps — verify the background worker
                  is actually firing and see how many old bulk-job rows each
                  pass removed.
                </p>
              </div>
            </div>
            <Button
              onClick={handleRunNow}
              disabled={sweepMutation.isPending}
              className="gap-2 shrink-0"
              data-testid="button-run-bulk-jobs-sweep-now"
            >
              {sweepMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run sweep now
                </>
              )}
            </Button>
          </div>

          {runsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading recent sweeps…
            </div>
          ) : runs.length === 0 ? (
            <div
              className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-md"
              data-testid="text-bulk-jobs-no-sweeps"
            >
              No sweeps have run yet. Use "Run sweep now" to trigger one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="table-bulk-jobs-recent-sweeps"
              >
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4 font-medium">Started</th>
                    <th className="py-2 pr-4 font-medium">Trigger</th>
                    <th className="py-2 pr-4 font-medium text-right">
                      Deleted
                    </th>
                    <th className="py-2 pr-4 font-medium text-right">
                      Retention
                    </th>
                    <th className="py-2 pr-4 font-medium">Duration</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const started = new Date(run.startedAt);
                    const finished = run.finishedAt
                      ? new Date(run.finishedAt)
                      : null;
                    const durationMs = finished
                      ? finished.getTime() - started.getTime()
                      : null;
                    const durationLabel =
                      durationMs == null
                        ? "running…"
                        : durationMs < 1000
                          ? `${durationMs}ms`
                          : `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`;
                    const isError = !!run.errorMessage;
                    return (
                      <tr
                        key={run.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {started.toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${run.trigger === "manual" ? "bg-blue-50 text-blue-700" : "bg-muted text-muted-foreground"}`}
                          >
                            {run.trigger}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {run.deleted}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {run.retentionDays}d
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {durationLabel}
                        </td>
                        <td className="py-2">
                          {isError ? (
                            <span
                              className="text-xs text-destructive"
                              title={run.errorMessage ?? undefined}
                            >
                              crashed
                            </span>
                          ) : finished ? (
                            <span className="text-xs text-emerald-600">
                              ok
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              in progress
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
