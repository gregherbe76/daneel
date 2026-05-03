import { useState, useEffect } from "react";
import {
  useListCandidateNotes,
  useCreateCandidateNote,
  useDeleteCandidateNote,
  useListCandidateComments,
  useCreateCandidateComment,
  useDeleteCandidateComment,
  useListTeamMembers,
  getListCandidateNotesQueryKey,
  getListCandidateCommentsQueryKey,
  type CommentMention,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  StickyNote,
  Trash2,
  CornerDownRight,
  Loader2,
  Send,
  AtSign,
} from "lucide-react";
import { MentionTextarea } from "./mention-textarea";
import { CommentBody } from "./comment-body";
import { useCurrentUserId, useCurrentUser } from "@/lib/current-user";

interface Props {
  candidateId: number;
  jobId: number;
}

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function CandidateNotesPanel({ candidateId, jobId }: Props) {
  const qc = useQueryClient();

  const teamQuery = useListTeamMembers();
  const roster = teamQuery.data ?? [];
  const [currentUserId, setCurrentUserId] = useCurrentUserId();
  const currentUser = useCurrentUser(roster);

  const notesQuery = useListCandidateNotes(
    candidateId,
    { jobId },
    { query: { queryKey: getListCandidateNotesQueryKey(candidateId, { jobId }) } },
  );
  const commentsQuery = useListCandidateComments(
    candidateId,
    { jobId },
    { query: { queryKey: getListCandidateCommentsQueryKey(candidateId, { jobId }) } },
  );

  const createNote = useCreateCandidateNote();
  const deleteNote = useDeleteCandidateNote();
  const createComment = useCreateCandidateComment();
  const deleteComment = useDeleteCandidateComment();

  const [newNote, setNewNote] = useState("");
  const [newComment, setNewComment] = useState("");
  const [newCommentMentions, setNewCommentMentions] = useState<CommentMention[]>([]);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyMentions, setReplyMentions] = useState<CommentMention[]>([]);

  // Ensure currentUserId is valid once roster loads
  useEffect(() => {
    if (roster.length > 0 && !roster.find((m) => m.id === currentUserId)) {
      setCurrentUserId(roster[0].id);
    }
  }, [roster, currentUserId, setCurrentUserId]);

  const authorName = currentUser?.name ?? "You";

  const invalidateNotes = () =>
    qc.invalidateQueries({ queryKey: getListCandidateNotesQueryKey(candidateId, { jobId }) });
  const invalidateComments = () =>
    qc.invalidateQueries({ queryKey: getListCandidateCommentsQueryKey(candidateId, { jobId }) });

  const submitNote = () => {
    if (!newNote.trim() || !authorName.trim()) return;
    createNote.mutate(
      { candidateId, data: { jobId, author: authorName.trim(), body: newNote.trim() } },
      {
        onSuccess: () => {
          setNewNote("");
          invalidateNotes();
        },
      },
    );
  };

  const submitComment = (
    parentId: number | null,
    body: string,
    mentions: CommentMention[],
  ) => {
    if (!body.trim() || !authorName.trim()) return;
    createComment.mutate(
      {
        candidateId,
        data: {
          jobId,
          parentId,
          author: authorName.trim(),
          body: body.trim(),
          mentions,
        },
      },
      {
        onSuccess: () => {
          if (parentId === null) {
            setNewComment("");
            setNewCommentMentions([]);
          } else {
            setReplyTo(null);
            setReplyBody("");
            setReplyMentions([]);
          }
          invalidateComments();
        },
      },
    );
  };

  const comments = commentsQuery.data ?? [];
  const topLevel = comments.filter((c) => c.parentId == null);
  const repliesByParent = new Map<number, typeof comments>();
  comments
    .filter((c) => c.parentId != null)
    .forEach((c) => {
      const arr = repliesByParent.get(c.parentId!) ?? [];
      arr.push(c);
      repliesByParent.set(c.parentId!, arr);
    });

  return (
    <div className="space-y-6">
      {/* current user picker */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Posting as
        </label>
        <Select value={currentUserId} onValueChange={setCurrentUserId}>
          <SelectTrigger className="max-w-xs" data-testid="current-user-select">
            <SelectValue placeholder="Select a teammate" />
          </SelectTrigger>
          <SelectContent>
            {roster.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-white text-[10px] font-semibold"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.initials}
                  </span>
                  <span>{m.name}</span>
                  <span className="text-xs text-muted-foreground">· {m.role}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── PRIVATE NOTES ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-amber-600" />
            Private notes
            <span className="text-xs font-normal text-muted-foreground">
              · just for the recruiter
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-start">
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Quick thought, follow-up, or reminder…"
              className="min-h-[68px] flex-1"
            />
            <Button
              size="sm"
              onClick={submitNote}
              disabled={!newNote.trim() || !authorName.trim() || createNote.isPending}
            >
              {createNote.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {notesQuery.isLoading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading notes…
            </div>
          ) : (notesQuery.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4 italic">
              No notes yet — add the first one above.
            </p>
          ) : (
            <ul className="space-y-2">
              {(notesQuery.data ?? []).map((n) => (
                <li
                  key={n.id}
                  className="text-sm border-l-2 border-amber-300 pl-3 py-1 group flex items-start justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                      <span className="font-medium text-foreground">{n.author}</span>
                      <span>·</span>
                      <span title={new Date(n.createdAt).toLocaleString()}>
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{n.body}</p>
                  </div>
                  <button
                    onClick={() =>
                      deleteNote.mutate(
                        { candidateId, noteId: n.id },
                        { onSuccess: invalidateNotes },
                      )
                    }
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                    title="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── TEAM COMMENTS (threaded) ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-600" />
            Team discussion
            <span className="text-xs font-normal text-muted-foreground">
              · type <AtSign className="h-3 w-3 inline" /> to mention a teammate
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-start">
            <MentionTextarea
              value={newComment}
              onChange={(v, mentions) => {
                setNewComment(v);
                setNewCommentMentions(mentions);
              }}
              roster={roster}
              placeholder="Start a discussion — type @ to pull in a teammate…"
              className="min-h-[68px]"
            />
            <Button
              size="sm"
              onClick={() => submitComment(null, newComment, newCommentMentions)}
              disabled={!newComment.trim() || !authorName.trim() || createComment.isPending}
              data-testid="submit-comment"
            >
              {createComment.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>

          {commentsQuery.isLoading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading discussion…
            </div>
          ) : topLevel.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4 italic">
              No comments yet — kick things off above.
            </p>
          ) : (
            <ul className="space-y-3">
              {topLevel.map((c) => {
                const replies = repliesByParent.get(c.id) ?? [];
                return (
                  <li
                    key={c.id}
                    className="border border-border/60 rounded-lg p-3 bg-card/50"
                  >
                    <div className="flex items-start justify-between gap-2 group">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <span className="font-medium text-foreground">{c.author}</span>
                          <span>·</span>
                          <span title={new Date(c.createdAt).toLocaleString()}>
                            {timeAgo(c.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm">
                          <CommentBody body={c.body} mentions={c.mentions} />
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          deleteComment.mutate(
                            { candidateId, commentId: c.id },
                            { onSuccess: invalidateComments },
                          )
                        }
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                        title="Delete comment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {replies.length > 0 && (
                      <ul className="mt-3 space-y-2 pl-4 border-l-2 border-border/60">
                        {replies.map((r) => (
                          <li
                            key={r.id}
                            className="group flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                                <CornerDownRight className="h-3 w-3" />
                                <span className="font-medium text-foreground">{r.author}</span>
                                <span>·</span>
                                <span title={new Date(r.createdAt).toLocaleString()}>
                                  {timeAgo(r.createdAt)}
                                </span>
                              </div>
                              <p className="text-sm pl-5">
                                <CommentBody body={r.body} mentions={r.mentions} />
                              </p>
                            </div>
                            <button
                              onClick={() =>
                                deleteComment.mutate(
                                  { candidateId, commentId: r.id },
                                  { onSuccess: invalidateComments },
                                )
                              }
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                              title="Delete reply"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {replyTo === c.id ? (
                      <div className="mt-3 flex gap-2 items-start pl-4">
                        <MentionTextarea
                          autoFocus
                          value={replyBody}
                          onChange={(v, mentions) => {
                            setReplyBody(v);
                            setReplyMentions(mentions);
                          }}
                          roster={roster}
                          placeholder="Write a reply… type @ to mention"
                          className="min-h-[52px] text-sm"
                        />
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            onClick={() => submitComment(c.id, replyBody, replyMentions)}
                            disabled={!replyBody.trim()}
                          >
                            Reply
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReplyTo(null);
                              setReplyBody("");
                              setReplyMentions([]);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReplyTo(c.id)}
                        className="mt-2 text-xs text-muted-foreground hover:text-primary transition"
                      >
                        Reply
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
