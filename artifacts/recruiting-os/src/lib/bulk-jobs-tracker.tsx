import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getBulkCandidateJob,
  listActiveBulkCandidateJobs,
  cancelBulkCandidateJob,
  type BulkCandidateJob,
  getListCandidatesQueryKey,
  getListApplicationsQueryKey,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, X, Download, AlertCircle, Ban } from "lucide-react";

/**
 * Bulk-action background jobs survive a browser refresh because the server
 * persists them; this little client-side tracker is what makes them visible
 * to the recruiter again after that refresh.
 *
 * It keeps a small list of "job ids the user is currently following" in
 * localStorage so the floating progress card and final completion toast
 * (e.g. the CSV download for `export-csv`) don't disappear when the page
 * reloads. On mount we also reconcile against the server's list of
 * still-running jobs so any in-flight work the user wasn't yet tracking
 * (e.g. a job started in another tab) shows up too.
 */

const TRACKED_KEY = "hiringai:bulk-jobs:tracked:v1";
const COMPLETED_KEY = "hiringai:bulk-jobs:completed-shown:v1";

type State = {
  tracked: number[];
  /**
   * Job ids we've already finalized in the UI (downloaded CSV, fired the
   * "Done" toast, etc.). Prevents re-firing those side effects across
   * refreshes if the row still happens to be returned by the server briefly.
   */
  completedShown: number[];
};

const listeners = new Set<() => void>();
let state: State = load();

function load(): State {
  if (typeof window === "undefined") return { tracked: [], completedShown: [] };
  try {
    const tracked = JSON.parse(localStorage.getItem(TRACKED_KEY) ?? "[]") as number[];
    const completedShown = JSON.parse(
      localStorage.getItem(COMPLETED_KEY) ?? "[]",
    ) as number[];
    return {
      tracked: Array.isArray(tracked) ? tracked : [],
      completedShown: Array.isArray(completedShown) ? completedShown : [],
    };
  } catch {
    return { tracked: [], completedShown: [] };
  }
}

function persist() {
  if (typeof window === "undefined") return;
  localStorage.setItem(TRACKED_KEY, JSON.stringify(state.tracked));
  // Cap completed-shown so it doesn't grow forever.
  const trimmed = state.completedShown.slice(-100);
  localStorage.setItem(COMPLETED_KEY, JSON.stringify(trimmed));
}

function emit() {
  listeners.forEach((l) => l());
}

export function trackBulkJob(id: number) {
  if (state.tracked.includes(id)) return;
  state = { ...state, tracked: [...state.tracked, id] };
  persist();
  emit();
}

export function untrackBulkJob(id: number) {
  state = { ...state, tracked: state.tracked.filter((x) => x !== id) };
  persist();
  emit();
}

function markCompletedShown(id: number) {
  if (state.completedShown.includes(id)) return;
  state = {
    ...state,
    completedShown: [...state.completedShown, id],
  };
  persist();
  emit();
}

export function useTrackedBulkJobIds(): number[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state.tracked,
    () => state.tracked,
  );
}

if (typeof window !== "undefined") {
  // Cross-tab: if another tab adds/removes a tracked job, mirror it locally.
  window.addEventListener("storage", (e) => {
    if (e.key === TRACKED_KEY || e.key === COMPLETED_KEY) {
      state = load();
      emit();
    }
  });
}

const POLL_MS = 1500;

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function actionLabel(action: string): string {
  switch (action) {
    case "delete":
      return "Deleting candidates";
    case "recheck-email":
      return "Re-checking emails";
    case "move-stage":
      return "Moving candidates";
    case "export-csv":
      return "Exporting CSV";
    default:
      return action;
  }
}

function useJobPoller(
  id: number,
  onUpdate: (job: BulkCandidateJob) => void,
) {
  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const job = await getBulkCandidateJob(id);
        if (cancelled) return;
        onUpdate(job);
        if (
          job.status === "completed" ||
          job.status === "failed" ||
          job.status === "canceled"
        )
          return;
      } catch {
        // Network blip — try again next tick.
      }
      if (!cancelled) timeout = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [id, onUpdate]);
}

function TrackedJobCard({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const [job, setJob] = useState<BulkCandidateJob | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useJobPoller(id, setJob);

  const onCancelClick = async () => {
    if (!job || cancelling) return;
    setCancelling(true);
    try {
      const updated = await cancelBulkCandidateJob(job.id);
      setJob(updated);
    } catch {
      toast({
        title: "Could not cancel job",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    if (!job || finalized) return;
    if (
      job.status !== "completed" &&
      job.status !== "failed" &&
      job.status !== "canceled"
    )
      return;
    setFinalized(true);

    const alreadyShown = state.completedShown.includes(job.id);
    markCompletedShown(job.id);

    if (job.status === "failed") {
      if (!alreadyShown) {
        toast({
          title: `${actionLabel(job.action)} failed`,
          description: job.errorMessage ?? "Please try again.",
          variant: "destructive",
        });
      }
      return;
    }

    if (job.status === "canceled") {
      if (!alreadyShown) {
        toast({
          title: `${actionLabel(job.action)} canceled`,
          description:
            job.processed + job.skipped > 0
              ? `Stopped after ${job.processed} processed${job.skipped > 0 ? `, ${job.skipped} skipped` : ""}.`
              : "No items were processed.",
        });
      }
      return;
    }

    // Completed — invalidate any list views the action could have touched.
    queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });

    if (!alreadyShown) {
      if (job.action === "export-csv" && job.csv) {
        const stamp = new Date().toISOString().slice(0, 10);
        downloadCsv(`candidates-${stamp}.csv`, job.csv);
        toast({
          title: `Exported ${job.processed} candidate${job.processed === 1 ? "" : "s"} to CSV`,
        });
      } else {
        const verbed =
          job.action === "delete"
            ? "Deleted"
            : job.action === "recheck-email"
              ? "Re-checked"
              : job.action === "move-stage"
                ? "Moved"
                : "Processed";
        toast({
          title: `${verbed} ${job.processed} candidate${job.processed === 1 ? "" : "s"}`,
          description:
            job.skipped > 0 ? `${job.skipped} skipped.` : undefined,
        });
      }
    }
  }, [job, finalized, queryClient]);

  if (!job) return null;
  if (
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "canceled"
  ) {
    // Auto-dismiss after the toast fires; the close button below also works.
    return (
      <div
        className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 shadow"
        data-testid={`bulk-job-card-${job.id}`}
      >
        {job.status === "failed" ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : job.status === "canceled" ? (
          <Ban className="h-4 w-4 text-muted-foreground" />
        ) : job.action === "export-csv" && job.csv ? (
          <Download className="h-4 w-4 text-muted-foreground" />
        ) : null}
        <div className="text-xs">
          <div className="font-medium">
            {job.status === "failed"
              ? `${actionLabel(job.action)} failed`
              : job.status === "canceled"
                ? `${actionLabel(job.action)} canceled`
                : `${actionLabel(job.action)} — done`}
          </div>
          <div className="text-muted-foreground">
            {job.processed} / {job.total}
            {job.skipped > 0 ? ` · ${job.skipped} skipped` : ""}
          </div>
        </div>
        {job.action === "export-csv" && job.status === "completed" && job.csv && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => {
              const stamp = new Date().toISOString().slice(0, 10);
              downloadCsv(`candidates-${stamp}.csv`, job.csv ?? "");
            }}
            data-testid={`bulk-job-download-${job.id}`}
          >
            Download
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label="Dismiss"
          onClick={() => untrackBulkJob(job.id)}
          data-testid={`bulk-job-dismiss-${job.id}`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const total = Math.max(job.total, 1);
  const done = job.processed + job.skipped;
  const pct = Math.min(100, Math.round((done / total) * 100));

  return (
    <div
      className="w-72 rounded-md border border-border bg-card p-3 shadow"
      data-testid={`bulk-job-card-${job.id}`}
    >
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <div className="flex-1 text-xs font-medium">
          {actionLabel(job.action)}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} className="mt-2 h-1.5" />
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {done} / {job.total}
          {job.skipped > 0 ? ` · ${job.skipped} skipped` : ""}
        </span>
        <span>{job.status === "pending" ? "Queued" : "Running"}</span>
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={onCancelClick}
          disabled={cancelling}
          data-testid={`bulk-job-cancel-${job.id}`}
        >
          <Ban className="mr-1 h-3 w-3" />
          {cancelling ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

export function BulkJobsTracker() {
  const tracked = useTrackedBulkJobIds();

  // On mount (and on focus), reconcile against active jobs the server still
  // knows about so a job started before refresh — or in another tab — appears
  // here too.
  useEffect(() => {
    let cancelled = false;
    const reconcile = async () => {
      try {
        const active = await listActiveBulkCandidateJobs();
        if (cancelled) return;
        for (const job of active) trackBulkJob(job.id);
      } catch {
        // Best-effort — the per-job poller handles its own errors.
      }
    };
    reconcile();
    const onFocus = () => reconcile();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (tracked.length === 0) return null;

  return (
    <div
      className="fixed bottom-24 right-6 z-50 flex flex-col gap-2"
      data-testid="bulk-jobs-tracker"
    >
      {tracked.map((id) => (
        <TrackedJobCard key={id} id={id} />
      ))}
    </div>
  );
}

