import { useState } from "react";
import {
  useListCandidateNotes,
  useCreateCandidateNote,
  useDeleteCandidateNote,
  useListCandidateComments,
  useCreateCandidateComment,
  useDeleteCandidateComment,
  getListCandidateNotesQueryKey,
  getListCandidateCommentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MessageSquare, StickyNote, Trash2, CornerDownRight, Loader2, Send } from "lucide-react";

interface Props {
  candidateId: number;
  jobId: number;
  /** the current user's display name */
  authorName?: string;
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

export function CandidateNotesPanel({ candidateId, jobId, authorName = "You" }: Props) {
  const qc = useQueryClient();

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
  const [author, setAuthor] = useState(authorName);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const invalidateNotes = () =>
    qc.invalidateQueries({ queryKey: getListCandidateNotesQueryKey(candidateId, { jobId }) });
  const invalidateComments = () =>
    qc.invalidateQueries({ queryKey: getListCandidateCommentsQueryKey(candidateId, { jobId }) });

  const submitNote = () => {
    if (!newNote.trim() || !author.trim()) return;
    createNote.mutate(
      { candidateId, data: { jobId, author: author.trim(), body: newNote.trim() } },
      {
        onSuccess: () => {
          setNewNote("");
          invalidateNotes();
        },
      },
    );
  };

  const submitComment = (parentId: number | null, body: string) => {
    if (!body.trim() || !author.trim()) return;
    createComment.mutate(
      { candidateId, data: { jobId, parentId, author: author.trim(), body: body.trim() } },
      {
        onSuccess: () => {
          if (parentId === null) setNewComment("");
          else {
            setReplyTo(null);
            setReplyBody("");
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
      {/* shared author input */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Posting as
        </label>
        <Input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Your name"
          className="max-w-xs"
        />
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
              disabled={!newNote.trim() || !author.trim() || createNote.isPending}
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
              · visible to everyone on the team
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-start">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Start a discussion about this candidate…"
              className="min-h-[68px] flex-1"
            />
            <Button
              size="sm"
              onClick={() => submitComment(null, newComment)}
              disabled={!newComment.trim() || !author.trim() || createComment.isPending}
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
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.body}</p>
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
                              <p className="text-sm whitespace-pre-wrap leading-relaxed pl-5">{r.body}</p>
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
                        <Textarea
                          autoFocus
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder="Write a reply…"
                          className="min-h-[52px] flex-1 text-sm"
                        />
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            onClick={() => submitComment(c.id, replyBody)}
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
