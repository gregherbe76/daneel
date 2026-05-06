import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTrashedCandidates,
  useRestoreCandidatesByIds,
  useEmptyCandidateTrash,
  getListTrashedCandidatesQueryKey,
  getListCandidatesQueryKey,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/hooks/use-toast";
import { Trash2, Undo2, Loader2, AlertTriangle, Briefcase } from "lucide-react";

function formatDeletedAt(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function TrashPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const trashQuery = useListTrashedCandidates();
  const restore = useRestoreCandidatesByIds();
  const emptyTrash = useEmptyCandidateTrash();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptyConfirmText, setEmptyConfirmText] = useState("");

  const items = trashQuery.data?.items ?? [];
  const retentionDays = trashQuery.data?.retentionDays ?? 7;

  const batches = useMemo(() => {
    // Group by deletionBatchId so we can offer a single "Restore batch"
    // affordance for multi-candidate deletes. Rows with no batch id
    // (legacy single-row deletes from before batch ids existed) are kept
    // ungrouped — each gets its own implicit "batch of 1".
    const map = new Map<
      string,
      { batchId: string | null; ids: number[]; deletedAt: string | Date }
    >();
    for (const row of items) {
      const key = row.deletionBatchId ?? `solo:${row.id}`;
      const existing = map.get(key);
      if (existing) {
        existing.ids.push(row.id);
      } else {
        map.set(key, {
          batchId: row.deletionBatchId ?? null,
          ids: [row.id],
          deletedAt: row.deletedAt,
        });
      }
    }
    return map;
  }, [items]);

  const refreshLists = async () => {
    // Refresh both the trash view and the main candidates list — restoring
    // a candidate immediately puts them back in the recruiter's pipeline.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListTrashedCandidatesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() }),
    ]);
  };

  // Build a one-line "attached to X jobs (Y archived)" summary that the
  // restore toast can echo back, so the recruiter sees what pipeline state
  // they just brought a candidate (or batch) back into.
  const summarizeAttachments = (
    rows: Array<{
      attachedJobs?: Array<{ exists: boolean }>;
      archivedJobCount?: number;
    }>,
  ): string => {
    // Defensive defaults match the row UI — see the note in the row render
    // about legacy / version-skew payloads. Do NOT crash the toast just
    // because the snapshot column is missing.
    const total = rows.reduce(
      (n, r) => n + (r.attachedJobs?.length ?? 0),
      0,
    );
    const archived = rows.reduce(
      (n, r) => n + (r.archivedJobCount ?? 0),
      0,
    );
    // Always return a sentence — including for the "no attachments" case —
    // so the restore toast surfaces the same context the recruiter saw on
    // the row before clicking, instead of falling back to a bare title.
    if (total === 0) return "Was not attached to any jobs at delete time.";
    const base = `Originally attached to ${total} job${total === 1 ? "" : "s"}`;
    return archived > 0
      ? `${base} — ${archived} archived/deleted while in trash, restored without that pipeline context.`
      : `${base}, all still active.`;
  };

  const handleRestoreOne = async (
    id: number,
    name: string,
    row: (typeof items)[number],
  ) => {
    const res = await restore.mutateAsync({ data: { ids: [id] } });
    if (res.restored > 0) {
      toast({
        title: `Restored ${name}`,
        description: summarizeAttachments([row]),
      });
    } else {
      toast({
        title: "Nothing to restore",
        description: "This candidate may have already been hard-deleted.",
        variant: "destructive",
      });
    }
    await refreshLists();
  };

  const handleRestoreBatch = async (
    ids: number[],
    rows: Array<(typeof items)[number]>,
  ) => {
    const res = await restore.mutateAsync({ data: { ids } });
    toast({
      title: `Restored ${res.restored} candidate${res.restored === 1 ? "" : "s"}`,
      description: summarizeAttachments(rows),
    });
    await refreshLists();
  };

  const handleEmptyTrash = async () => {
    const res = await emptyTrash.mutateAsync();
    setConfirmEmpty(false);
    setEmptyConfirmText("");
    toast({
      title: `Permanently deleted ${res.purged} candidate${res.purged === 1 ? "" : "s"}`,
    });
    await refreshLists();
  };

  const isLoading = trashQuery.isLoading;
  const isMutating = restore.isPending || emptyTrash.isPending;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Trash</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Soft-deleted candidates are kept for {retentionDays} day
            {retentionDays === 1 ? "" : "s"} before being permanently removed.
            Restore individuals or whole batches below.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setEmptyConfirmText("");
            setConfirmEmpty(true);
          }}
          disabled={items.length === 0 || isMutating}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          data-testid="empty-trash"
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Empty trash
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading trash…
        </div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          <Trash2 className="mx-auto h-8 w-8 mb-3 opacity-40" />
          <p className="font-medium">Trash is empty</p>
          <p className="text-sm mt-1">
            Deleted candidates show up here with a {retentionDays}-day window
            to undo.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(batches.values()).map((batch) => {
            const batchRows = items.filter((r) =>
              batch.batchId
                ? r.deletionBatchId === batch.batchId
                : r.deletionBatchId === null && r.id === batch.ids[0],
            );
            const isMultiBatch = batch.batchId !== null && batchRows.length > 1;
            return (
              <div
                key={batch.batchId ?? `solo-${batch.ids[0]}`}
                data-testid={`trash-batch-${batch.batchId ?? "solo-" + batch.ids[0]}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-muted-foreground">
                    {isMultiBatch
                      ? `Bulk delete · ${batchRows.length} candidates · ${formatDeletedAt(batch.deletedAt)}`
                      : `Deleted ${formatDeletedAt(batch.deletedAt)}`}
                  </div>
                  {isMultiBatch && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleRestoreBatch(
                          batchRows.map((r) => r.id),
                          batchRows,
                        )
                      }
                      disabled={isMutating}
                      data-testid={`restore-batch-${batch.batchId}`}
                    >
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                      Restore batch ({batchRows.length})
                    </Button>
                  )}
                </div>
                <Card className="divide-y">
                  {batchRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-4 p-4"
                      data-testid={`trash-row-${row.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{row.name}</span>
                          {row.daysRemaining <= 1 && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 text-amber-700 dark:text-amber-400"
                            >
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              {row.daysRemaining === 0
                                ? "Purges today"
                                : "1 day left"}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {row.email ?? "no email"}
                          {row.headline ? ` · ${row.headline}` : ""}
                          {row.currentCompany ? ` · ${row.currentCompany}` : ""}
                        </div>
                        {/* Pipeline-context warning: tells the recruiter how
                            many jobs the candidate will land back in if
                            restored, and flags any that have been
                            archived/deleted while the candidate was in the
                            trash. The amber row appears even when 0 jobs
                            remain (so the recruiter knows the restored
                            candidate will sit pipeline-less). */}
                        <div
                          className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs"
                          data-testid={`attached-jobs-${row.id}`}
                        >
                          <Briefcase className="h-3 w-3 text-muted-foreground" />
                          {/* Defensive defaults so legacy rows or version-skew
                              payloads (no snapshot column yet) don't crash
                              the page — they just render "no jobs at delete
                              time" instead. */}
                          {(() => {
                            const attached = row.attachedJobs ?? [];
                            return attached.length === 0 ? (
                              <span className="text-muted-foreground">
                                Not attached to any jobs at delete time
                              </span>
                            ) : (
                              <>
                                <span className="text-muted-foreground">
                                  Originally attached to {attached.length} job
                                  {attached.length === 1 ? "" : "s"}
                                </span>
                                {attached.slice(0, 3).map((j) => (
                                  <Badge
                                    key={j.id}
                                    variant="secondary"
                                    className={
                                      j.exists
                                        ? "font-normal"
                                        : "font-normal line-through opacity-70"
                                    }
                                    title={
                                      j.exists
                                        ? undefined
                                        : "This job has been archived/deleted while the candidate was in the trash."
                                    }
                                    data-testid={
                                      j.exists
                                        ? `attached-job-live-${row.id}-${j.id}`
                                        : `attached-job-archived-${row.id}-${j.id}`
                                    }
                                  >
                                    {j.title}
                                  </Badge>
                                ))}
                              </>
                            );
                          })()}
                          {(row.archivedJobCount ?? 0) > 0 && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 text-amber-700 dark:text-amber-400"
                              data-testid={`archived-jobs-badge-${row.id}`}
                            >
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              {row.archivedJobCount} archived/deleted
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-muted-foreground mb-1">
                          {row.daysRemaining > 1
                            ? `${row.daysRemaining} days left`
                            : null}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestoreOne(row.id, row.name, row)}
                          disabled={isMutating}
                          data-testid={`restore-${row.id}`}
                        >
                          <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                          Restore
                        </Button>
                      </div>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={confirmEmpty}
        onOpenChange={(open) => {
          setConfirmEmpty(open);
          if (!open) setEmptyConfirmText("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete {items.length} candidate
              {items.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This bypasses the {retentionDays}-day retention window and
              hard-deletes every candidate currently in the trash, along with
              their applications, notes, and evaluations. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Type <span className="font-mono">EMPTY</span> to confirm:
            </label>
            <Input
              value={emptyConfirmText}
              onChange={(e) => setEmptyConfirmText(e.target.value)}
              placeholder="EMPTY"
              data-testid="empty-trash-confirm-input"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEmptyTrash}
              disabled={emptyConfirmText !== "EMPTY" || emptyTrash.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="empty-trash-confirm"
            >
              {emptyTrash.isPending ? "Emptying…" : "Empty trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
