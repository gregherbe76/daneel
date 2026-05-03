import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetLatestJobWorkflowQueryKey,
  getListJobRunsQueryKey,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

const PENDING_KEY = "shortlistpro:pending-improve-runs:v1";
const UNSEEN_KEY = "shortlistpro:unseen-job-runs:v1";

type PendingRun = {
  runId: number;
  jobId: number;
  jobTitle: string;
  startedAt: number;
};

type UnseenRun = {
  runId: number;
  jobId: number;
  jobTitle: string;
  completedAt: number;
};

type State = {
  pending: PendingRun[];
  unseen: UnseenRun[];
};

const listeners = new Set<() => void>();
let state: State = load();

function load(): State {
  if (typeof window === "undefined") return { pending: [], unseen: [] };
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as PendingRun[];
    const unseen = JSON.parse(localStorage.getItem(UNSEEN_KEY) ?? "[]") as UnseenRun[];
    return {
      pending: Array.isArray(pending) ? pending : [],
      unseen: Array.isArray(unseen) ? unseen : [],
    };
  } catch {
    return { pending: [], unseen: [] };
  }
}

function persist() {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(state.pending));
    localStorage.setItem(UNSEEN_KEY, JSON.stringify(state.unseen));
  } catch {
    // ignore quota / private mode errors
  }
}

function setState(next: State) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): State {
  return state;
}

export function addPendingImproveRun(run: PendingRun) {
  if (state.pending.some((r) => r.runId === run.runId)) return;
  setState({ ...state, pending: [...state.pending, run] });
}

export function removePendingImproveRun(runId: number) {
  setState({ ...state, pending: state.pending.filter((r) => r.runId !== runId) });
}

export function addUnseenJobRun(run: UnseenRun) {
  const filtered = state.unseen.filter((r) => r.runId !== run.runId);
  setState({ ...state, unseen: [...filtered, run] });
}

export function markJobRunsSeen(jobId: number) {
  if (!state.unseen.some((r) => r.jobId === jobId)) return;
  setState({ ...state, unseen: state.unseen.filter((r) => r.jobId !== jobId) });
}

export function usePendingImproveRuns() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).pending;
}

export function useUnseenRunsByJob() {
  const unseen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot).unseen;
  const map = new Map<number, UnseenRun[]>();
  for (const r of unseen) {
    const arr = map.get(r.jobId) ?? [];
    arr.push(r);
    map.set(r.jobId, arr);
  }
  return map;
}

// Cross-tab sync
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === PENDING_KEY || e.key === UNSEEN_KEY) {
      state = load();
      listeners.forEach((l) => l());
    }
  });
}

// ── Watcher component ─────────────────────────────────────────────────────────

const POLL_MS = 4000;
const MAX_AGE_MS = 30 * 60 * 1000; // give up after 30min

export function PendingRunsWatcher() {
  const pending = usePendingImproveRuns();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (pending.length === 0) return;

    let cancelled = false;

    const tick = async () => {
      const now = Date.now();
      for (const run of pending) {
        if (cancelled) return;
        if (now - run.startedAt > MAX_AGE_MS) {
          removePendingImproveRun(run.runId);
          continue;
        }
        try {
          const res = await fetch(`/api/workflows/runs/${run.runId}`);
          if (!res.ok) continue;
          const data = (await res.json()) as { status?: string };
          if (data.status === "completed") {
            removePendingImproveRun(run.runId);
            addUnseenJobRun({
              runId: run.runId,
              jobId: run.jobId,
              jobTitle: run.jobTitle,
              completedAt: Date.now(),
            });
            queryClient.invalidateQueries({
              queryKey: getGetLatestJobWorkflowQueryKey(run.jobId),
            });
            queryClient.invalidateQueries({
              queryKey: getListJobRunsQueryKey(run.jobId),
            });
            queryClient.invalidateQueries({ queryKey: ["report", run.jobId] });
            const t = toast({
              title: "Improved run ready",
              description: `${run.jobTitle} — re-scored shortlist available.`,
              duration: 15000,
              onOpenChange: (open) => {
                if (!open) return;
              },
            });
            // Add a clickable wrapper via title — we keep it simple:
            // the user can click the toast region; navigation via separate UI.
            // Provide a fallback via the toast description:
            t.update({
              id: t.id,
              title: "Improved run ready",
              description: (
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-primary"
                  onClick={() => {
                    markJobRunsSeen(run.jobId);
                    t.dismiss();
                    navigate(`/jobs/${run.jobId}/report?runId=${run.runId}`);
                  }}
                >
                  {run.jobTitle} — view re-scored shortlist
                </button>
              ),
              open: true,
            });
          } else if (data.status === "failed") {
            removePendingImproveRun(run.runId);
            queryClient.invalidateQueries({
              queryKey: getGetLatestJobWorkflowQueryKey(run.jobId),
            });
            queryClient.invalidateQueries({
              queryKey: getListJobRunsQueryKey(run.jobId),
            });
            toast({
              title: "Improve and Rerun failed",
              description: run.jobTitle,
              variant: "destructive",
            });
          }
        } catch {
          // network blip — try again next tick
        }
      }
    };

    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pending, navigate, queryClient]);

  return null;
}
