import { useEffect, useState } from "react";
import {
  useGetEmailRevalidationSettings,
  useUpdateEmailRevalidationSettings,
  useListEmailRevalidationRuns,
  useRunEmailRevalidationSweepNow,
  getGetEmailRevalidationSettingsQueryKey,
  getListEmailRevalidationRunsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, RotateCcw, Play, Activity } from "lucide-react";
import { SettingsTabs } from "@/components/settings-tabs";

const PRESET_INTERVALS: { label: string; ms: number }[] = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "12 hours", ms: 12 * 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
];

function msToHours(ms: number): string {
  if (ms <= 0) return "0";
  const hours = ms / (60 * 60 * 1000);
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2);
}

function hoursToMs(hours: string): number {
  const n = Number(hours);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 60 * 60 * 1000);
}

export default function EmailRevalidationSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useGetEmailRevalidationSettings();
  const updateMutation = useUpdateEmailRevalidationSettings();
  const runsQuery = useListEmailRevalidationRuns({
    query: {
      queryKey: getListEmailRevalidationRunsQueryKey(),
      refetchInterval: 15000,
    },
  });
  const sweepMutation = useRunEmailRevalidationSweepNow();

  const [thresholdDays, setThresholdDays] = useState("30");
  const [intervalHours, setIntervalHours] = useState("6");
  const [batchSize, setBatchSize] = useState("50");
  const [enabled, setEnabled] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settingsQuery.data && !dirty) {
      setThresholdDays(String(settingsQuery.data.thresholdDays));
      setIntervalHours(msToHours(settingsQuery.data.intervalMs));
      setBatchSize(String(settingsQuery.data.batchSize));
      setEnabled(settingsQuery.data.enabled);
    }
  }, [settingsQuery.data, dirty]);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    const days = Number(thresholdDays);
    const intervalMs = hoursToMs(intervalHours);
    const batch = Number(batchSize);

    if (!Number.isFinite(days) || days < 1 || days > 365) {
      toast({ title: "Invalid threshold", description: "Threshold must be between 1 and 365 days.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(intervalMs) || intervalMs < 0) {
      toast({ title: "Invalid interval", description: "Interval must be a positive number of hours.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(batch) || batch < 1 || batch > 10000) {
      toast({ title: "Invalid batch size", description: "Batch size must be between 1 and 10,000.", variant: "destructive" });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        data: {
          thresholdDays: days,
          intervalMs,
          batchSize: batch,
          enabled,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetEmailRevalidationSettingsQueryKey(),
      });
      setDirty(false);
      toast({ title: "Settings saved", description: "The scheduler will pick up the new values on its next tick." });
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
    setThresholdDays(String(settingsQuery.data.thresholdDays));
    setIntervalHours(msToHours(settingsQuery.data.intervalMs));
    setBatchSize(String(settingsQuery.data.batchSize));
    setEnabled(settingsQuery.data.enabled);
    setDirty(false);
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

  const handleRunNow = async () => {
    try {
      const run = await sweepMutation.mutateAsync();
      await queryClient.invalidateQueries({
        queryKey: getListEmailRevalidationRunsQueryKey(),
      });
      const errorSuffix = run.errors > 0 ? `, ${run.errors} error${run.errors === 1 ? "" : "s"}` : "";
      toast({
        title: "Sweep finished",
        description: `Re-checked ${run.rechecked} candidate${run.rechecked === 1 ? "" : "s"}${errorSuffix}.`,
      });
    } catch (err) {
      toast({
        title: "Sweep failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const runs = runsQuery.data ?? [];

  return (
    <>
      <SettingsTabs />
      <div className="p-8 max-w-3xl">
      <div className="mb-8 flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Mail className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Email Re-check Schedule</h1>
          <p className="text-muted-foreground mt-1">
            Tune how often the system re-validates candidate email addresses. Higher frequency keeps verifications fresh; lower frequency reduces DNS noise. Changes take effect on the next sweep.
          </p>
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base font-semibold">Scheduler enabled</Label>
            <p className="text-sm text-muted-foreground">When off, no automatic re-checks are performed.</p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => {
              setEnabled(v);
              markDirty();
            }}
            data-testid="switch-enabled"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="threshold-days">Staleness threshold (days)</Label>
          <Input
            id="threshold-days"
            type="number"
            min={1}
            max={365}
            value={thresholdDays}
            onChange={(e) => {
              setThresholdDays(e.target.value);
              markDirty();
            }}
            className="max-w-xs"
            data-testid="input-threshold-days"
          />
          <p className="text-xs text-muted-foreground">
            A previously verified email is re-checked once it has been this many days old.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="interval-hours">Sweep interval (hours)</Label>
          <Input
            id="interval-hours"
            type="number"
            min={0}
            step={0.25}
            value={intervalHours}
            onChange={(e) => {
              setIntervalHours(e.target.value);
              markDirty();
            }}
            className="max-w-xs"
            data-testid="input-interval-hours"
          />
          <div className="flex flex-wrap gap-2 mt-1">
            {PRESET_INTERVALS.map((p) => (
              <button
                key={p.ms}
                type="button"
                onClick={() => {
                  setIntervalHours(msToHours(p.ms));
                  markDirty();
                }}
                className="text-xs px-2 py-1 rounded border border-border hover:bg-accent"
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            How often the background sweeper wakes up to look for stale rows. Minimum effective cadence is 1 minute.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="batch-size">Batch size</Label>
          <Input
            id="batch-size"
            type="number"
            min={1}
            max={10000}
            value={batchSize}
            onChange={(e) => {
              setBatchSize(e.target.value);
              markDirty();
            }}
            className="max-w-xs"
            data-testid="input-batch-size"
          />
          <p className="text-xs text-muted-foreground">
            Maximum number of candidates re-checked in a single sweep. Lower values smooth out DNS load.
          </p>
        </div>

        <div className="pt-2 flex items-center gap-3 border-t border-border">
          <Button
            onClick={handleSave}
            disabled={!dirty || updateMutation.isPending}
            data-testid="button-save"
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={!dirty || updateMutation.isPending}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <p className="text-xs text-muted-foreground ml-auto">
            Last updated: {updatedAt}
          </p>
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card p-6 mt-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Recent activity</h2>
              <p className="text-sm text-muted-foreground">
                The last few sweeps run by the scheduler — verify it's actually firing and see how many addresses each pass touched.
              </p>
            </div>
          </div>
          <Button
            onClick={handleRunNow}
            disabled={sweepMutation.isPending}
            className="gap-2 shrink-0"
            data-testid="button-run-sweep-now"
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
          <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-md">
            No sweeps have run yet. Use "Run sweep now" to trigger one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-recent-sweeps">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-medium">Started</th>
                  <th className="py-2 pr-4 font-medium">Trigger</th>
                  <th className="py-2 pr-4 font-medium text-right">Re-checked</th>
                  <th className="py-2 pr-4 font-medium text-right">Errors</th>
                  <th className="py-2 pr-4 font-medium">Duration</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const started = new Date(run.startedAt);
                  const finished = run.finishedAt ? new Date(run.finishedAt) : null;
                  const durationMs = finished ? finished.getTime() - started.getTime() : null;
                  const durationLabel =
                    durationMs == null
                      ? "running…"
                      : durationMs < 1000
                        ? `${durationMs}ms`
                        : `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`;
                  const isError = !!run.errorMessage;
                  return (
                    <tr key={run.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">{started.toLocaleString()}</td>
                      <td className="py-2 pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${run.trigger === "manual" ? "bg-blue-50 text-blue-700" : "bg-muted text-muted-foreground"}`}>
                          {run.trigger}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{run.rechecked}</td>
                      <td className={`py-2 pr-4 text-right tabular-nums ${run.errors > 0 ? "text-destructive font-medium" : ""}`}>
                        {run.errors}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{durationLabel}</td>
                      <td className="py-2">
                        {isError ? (
                          <span className="text-xs text-destructive" title={run.errorMessage ?? undefined}>
                            crashed
                          </span>
                        ) : finished ? (
                          <span className="text-xs text-emerald-600">ok</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">in progress</span>
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
