import { useState } from "react";
import {
  useListCandidateNotes,
  useListCandidateComments,
  getListCandidateNotesQueryKey,
  getListCandidateCommentsQueryKey,
} from "@workspace/api-client-react";
import { MessageSquare, StickyNote } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CandidateNotesPanel } from "@/components/candidate-notes-panel";

interface Props {
  candidateId: number;
  jobId: number;
  candidateName?: string;
  className?: string;
  variant?: "default" | "compact" | "dark";
}

export function CandidateNotesIndicator({
  candidateId,
  jobId,
  candidateName,
  className,
  variant = "default",
}: Props) {
  const [open, setOpen] = useState(false);

  const notesQuery = useListCandidateNotes(
    candidateId,
    { jobId },
    {
      query: {
        queryKey: getListCandidateNotesQueryKey(candidateId, { jobId }),
        enabled: !!candidateId && !!jobId,
      },
    },
  );
  const commentsQuery = useListCandidateComments(
    candidateId,
    { jobId },
    {
      query: {
        queryKey: getListCandidateCommentsQueryKey(candidateId, { jobId }),
        enabled: !!candidateId && !!jobId,
      },
    },
  );

  const noteCount = notesQuery.data?.length ?? 0;
  const commentCount = commentsQuery.data?.length ?? 0;
  const hasAny = noteCount > 0 || commentCount > 0;

  const baseCls =
    variant === "compact"
      ? "h-6 px-2 text-[11px] gap-1.5"
      : "h-7 px-2.5 text-xs gap-1.5";

  const colorCls = hasAny
    ? variant === "dark"
      ? "border-blue-500/40 text-blue-300 bg-transparent hover:bg-blue-500/10"
      : "border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
    : variant === "dark"
      ? "border-slate-600 text-slate-400 bg-transparent hover:bg-slate-700/50"
      : "border-border text-muted-foreground bg-card hover:bg-muted/60";

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title={
          hasAny
            ? `${noteCount} note${noteCount === 1 ? "" : "s"} · ${commentCount} comment${commentCount === 1 ? "" : "s"}`
            : "Add notes or start a discussion"
        }
        className={[
          "inline-flex items-center rounded-full border font-medium transition-colors",
          baseCls,
          colorCls,
          className ?? "",
        ].join(" ")}
      >
        <StickyNote className="h-3 w-3" />
        <span>{noteCount}</span>
        <span className="opacity-50">·</span>
        <MessageSquare className="h-3 w-3" />
        <span>{commentCount}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Notes & discussion{candidateName ? ` — ${candidateName}` : ""}
            </DialogTitle>
            <DialogDescription>
              Private notes are just for you. Team comments are visible to
              everyone on this job.
            </DialogDescription>
          </DialogHeader>
          <CandidateNotesPanel candidateId={candidateId} jobId={jobId} />
        </DialogContent>
      </Dialog>
    </>
  );
}
