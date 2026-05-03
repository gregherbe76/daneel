import { useState } from "react";
import {
  ApplicationStage,
  BulkCandidateAction,
  BulkCandidateActionPayload,
  BulkCandidateActionResult,
  useBulkCandidateAction,
  useEnqueueBulkCandidateJob,
} from "@workspace/api-client-react";
import { trackBulkJob } from "@/lib/bulk-jobs-tracker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  X,
  Loader2,
  Download,
  Mail,
  Trash2,
  ArrowRightLeft,
} from "lucide-react";

const BULK_CHUNK_SIZE = 500;

// Above this many ids we stop chunking client-side and instead enqueue a
// background job — recruiters operating on the whole DB (thousands of rows)
// would otherwise sit through many sequential round-trips and lose progress
// on a refresh. The 500 threshold matches the per-request budget of the
// synchronous /candidates/bulk endpoint.
const BACKGROUND_JOB_THRESHOLD = 500;

// Hard caps mirror the server-side budget so the chunking math stays
// predictable: at 500 ids per request the recheck-email path takes a few
// seconds, anything more would risk request timeouts.
async function runChunked(
  ids: number[],
  fn: (chunk: number[]) => Promise<BulkCandidateActionResult>,
): Promise<BulkCandidateActionResult[]> {
  const out: BulkCandidateActionResult[] = [];
  for (let i = 0; i < ids.length; i += BULK_CHUNK_SIZE) {
    out.push(await fn(ids.slice(i, i + BULK_CHUNK_SIZE)));
  }
  return out;
}

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

export type BulkActionBarProps = {
  selectedIds: number[];
  onClear: () => void;
  // When jobId is set, the "Move to stage" action is shown; otherwise it's
  // hidden (bulk stage moves only make sense in a single-job pipeline).
  jobId?: number;
  onAfterChange?: () => void;
};

const STAGES: ApplicationStage[] = [
  "Sourced",
  "Contacted",
  "Screened",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
];

export function BulkActionBar({
  selectedIds,
  onClear,
  jobId,
  onAfterChange,
}: BulkActionBarProps) {
  const { toast } = useToast();
  const bulk = useBulkCandidateAction();
  const enqueue = useEnqueueBulkCandidateJob();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  if (selectedIds.length === 0) return null;
  const count = selectedIds.length;
  const needsTypedConfirm = count > 50;
  const useBackground = count > BACKGROUND_JOB_THRESHOLD;

  // Hand a large selection off to the queue worker. The BulkJobsTracker
  // surfaces progress and the final outcome (CSV download, completion toast,
  // etc.) on top of every page, including across refreshes.
  const enqueueBackground = async (
    action: BulkCandidateAction,
    payload?: BulkCandidateActionPayload,
  ) => {
    const job = await enqueue.mutateAsync({
      data: { ids: selectedIds, action, payload },
    });
    trackBulkJob(job.id);
    toast({
      title: `Queued ${count} candidate${count === 1 ? "" : "s"} for processing`,
      description: "Progress will keep running in the background.",
    });
    onAfterChange?.();
    onClear();
  };

  const finish = (msg: string) => {
    onAfterChange?.();
    onClear();
    toast({ title: msg });
  };

  const handleExportCsv = async () => {
    if (useBackground) {
      try {
        await enqueueBackground("export-csv");
      } catch (e) {
        toast({
          title: "Could not queue CSV export",
          description: e instanceof Error ? e.message : "Please try again",
          variant: "destructive",
        });
      }
      return;
    }
    try {
      const results = await runChunked(selectedIds, (chunk) =>
        bulk.mutateAsync({
          data: { ids: chunk, action: "export-csv" },
        }),
      );
      // Concatenate CSV chunks: keep the first header, drop the rest.
      const parts: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const csv = results[i].csv ?? "";
        if (i === 0) parts.push(csv);
        else {
          const idx = csv.indexOf("\n");
          parts.push(idx >= 0 ? csv.slice(idx + 1) : "");
        }
      }
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`candidates-${stamp}.csv`, parts.join("\n"));
      toast({ title: `Exported ${count} candidate${count === 1 ? "" : "s"} to CSV` });
      onClear();
    } catch (e) {
      toast({
        title: "CSV export failed",
        description: e instanceof Error ? e.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleRecheck = async () => {
    if (useBackground) {
      try {
        await enqueueBackground("recheck-email");
      } catch (e) {
        toast({
          title: "Could not queue email re-check",
          description: e instanceof Error ? e.message : "Please try again",
          variant: "destructive",
        });
      }
      return;
    }
    // Re-check can take a few seconds per chunk, so surface an in-progress
    // toast immediately and update it as each chunk completes — recruiters
    // running the action on hundreds of rows otherwise have no feedback.
    const total = selectedIds.length;
    const progressToast = toast({
      title: `Re-checking ${total} candidate${total === 1 ? "" : "s"}…`,
      description: total > BULK_CHUNK_SIZE ? `0 / ${total}` : "This may take a moment.",
    });
    let done = 0;
    let processed = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < selectedIds.length; i += BULK_CHUNK_SIZE) {
        const chunk = selectedIds.slice(i, i + BULK_CHUNK_SIZE);
        const r = await bulk.mutateAsync({
          data: { ids: chunk, action: "recheck-email" },
        });
        processed += r.processed;
        skipped += r.skipped;
        done += chunk.length;
        if (total > BULK_CHUNK_SIZE) {
          progressToast.update({
            id: progressToast.id,
            title: `Re-checking ${total} candidate${total === 1 ? "" : "s"}…`,
            description: `${done} / ${total}`,
          });
        }
      }
      onAfterChange?.();
      onClear();
      progressToast.update({
        id: progressToast.id,
        title: `Re-checked ${processed} candidate${processed === 1 ? "" : "s"}`,
        description: skipped > 0 ? `${skipped} skipped (no email or not found).` : undefined,
      });
    } catch (e) {
      progressToast.update({
        id: progressToast.id,
        title: "Bulk re-check failed",
        description: e instanceof Error ? e.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleMoveStage = async (stage: ApplicationStage) => {
    if (!jobId) return;
    if (useBackground) {
      try {
        await enqueueBackground("move-stage", { jobId, stage });
      } catch (e) {
        toast({
          title: "Could not queue stage move",
          description: e instanceof Error ? e.message : "Please try again",
          variant: "destructive",
        });
      }
      return;
    }
    try {
      const results = await runChunked(selectedIds, (chunk) =>
        bulk.mutateAsync({
          data: { ids: chunk, action: "move-stage", payload: { jobId, stage } },
        }),
      );
      const processed = results.reduce((sum, r) => sum + r.processed, 0);
      const skipped = results.reduce((sum, r) => sum + r.skipped, 0);
      const desc = skipped > 0
        ? `${skipped} candidate${skipped === 1 ? " has" : "s have"} no application on this job.`
        : undefined;
      onAfterChange?.();
      onClear();
      toast({
        title: `Moved ${processed} to ${stage}`,
        description: desc,
      });
    } catch (e) {
      toast({
        title: "Bulk move failed",
        description: e instanceof Error ? e.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (useBackground) {
      try {
        await enqueueBackground("delete");
        setConfirmDelete(false);
        setConfirmText("");
      } catch (e) {
        toast({
          title: "Could not queue delete",
          description: e instanceof Error ? e.message : "Please try again",
          variant: "destructive",
        });
      }
      return;
    }
    try {
      const results = await runChunked(selectedIds, (chunk) =>
        bulk.mutateAsync({
          data: { ids: chunk, action: "delete" },
        }),
      );
      const processed = results.reduce((sum, r) => sum + r.processed, 0);
      setConfirmDelete(false);
      setConfirmText("");
      finish(`Deleted ${processed} candidate${processed === 1 ? "" : "s"}`);
    } catch (e) {
      toast({
        title: "Bulk delete failed",
        description: e instanceof Error ? e.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const isPending = bulk.isPending || enqueue.isPending;

  return (
    <>
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-lg"
        data-testid="bulk-action-bar"
      >
        <span className="text-sm font-medium">
          {count} candidate{count === 1 ? "" : "s"} selected
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-7 px-2 text-xs text-muted-foreground"
          data-testid="bulk-clear"
        >
          Clear
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={isPending}
          className="h-8"
          data-testid="bulk-export-csv"
        >
          {isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-3.5 w-3.5" />
          )}
          Export CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRecheck}
          disabled={isPending}
          className="h-8"
          data-testid="bulk-recheck-email"
        >
          {isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Mail className="mr-1.5 h-3.5 w-3.5" />
          )}
          Re-check email
        </Button>
        {jobId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                className="h-8"
                data-testid="bulk-move-stage"
              >
                <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                Move to stage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STAGES.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => handleMoveStage(s)}
                  data-testid={`bulk-move-stage-${s}`}
                >
                  Move to {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setConfirmText("");
            setConfirmDelete(true);
          }}
          disabled={isPending}
          className="h-8 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          data-testid="bulk-delete"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          className="h-7 w-7"
          aria-label="Close bulk action bar"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => {
          setConfirmDelete(open);
          if (!open) setConfirmText("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {count} candidate{count === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected candidate
              {count === 1 ? "" : "s"} along with their applications and notes
              across every job. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {needsTypedConfirm && (
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Type <span className="font-mono">DELETE</span> to confirm:
              </label>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                data-testid="bulk-delete-confirm-input"
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isPending || (needsTypedConfirm && confirmText !== "DELETE")}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="bulk-delete-confirm"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                `Delete ${count} candidate${count === 1 ? "" : "s"}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
