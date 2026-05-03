import { useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTeamMembers,
  useListMentionsForMember,
  useListEmailStatusChanges,
  useMarkEmailStatusChangeRead,
  useMarkAllEmailStatusChangesRead,
  getListEmailStatusChangesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AtSign, MessageSquare, Loader2, CheckCheck, MailWarning, X } from "lucide-react";
import { CommentBody } from "@/components/comment-body";
import { EmailValidationBadge } from "@/components/email-validation-badge";
import {
  useCurrentUser,
  useMentionsLastRead,
} from "@/lib/current-user";

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function toIso(input: string | Date): string {
  return typeof input === "string" ? input : new Date(input).toISOString();
}

export default function MentionsPage() {
  const teamQuery = useListTeamMembers();
  const currentUser = useCurrentUser(teamQuery.data);
  const userId = currentUser?.id ?? "";
  const [lastRead, setLastRead] = useMentionsLastRead(userId);
  const queryClient = useQueryClient();

  const mentionsQuery = useListMentionsForMember(userId, undefined, {
    query: {
      queryKey: ["mentions", userId],
      enabled: Boolean(userId),
      refetchInterval: 15000,
    },
  });
  const mentions = mentionsQuery.data ?? [];

  const regressionsQuery = useListEmailStatusChanges(
    { unread: true, limit: 50 },
    {
      query: {
        queryKey: getListEmailStatusChangesQueryKey({ unread: true, limit: 50 }),
        refetchInterval: 15000,
      },
    },
  );
  const regressions = regressionsQuery.data ?? [];

  const refreshRegressions = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/email-status-changes"] });
  };

  const markOne = useMarkEmailStatusChangeRead({
    mutation: { onSuccess: refreshRegressions },
  });
  const markAllRegressions = useMarkAllEmailStatusChangesRead({
    mutation: { onSuccess: refreshRegressions },
  });

  // Mark all mentions as read on view (matches existing behavior)
  useEffect(() => {
    if (mentions.length > 0) {
      const newest = toIso(mentions[0].comment.createdAt);
      if (!lastRead || new Date(newest) > new Date(lastRead)) {
        setLastRead(newest);
      }
    }
  }, [mentions, lastRead, setLastRead]);

  const hasAnyUnread = mentions.length > 0 || regressions.length > 0;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <AtSign className="h-6 w-6 text-blue-600" />
            Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {currentUser ? (
              <>Mentions and email regressions for <strong>{currentUser.name}</strong>.</>
            ) : (
              <>Loading your inbox…</>
            )}
          </p>
        </div>
        {hasAnyUnread && (
          <div className="flex gap-2">
            {regressions.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllRegressions.mutate()}
                disabled={markAllRegressions.isPending}
                data-testid="dismiss-all-regressions"
              >
                <CheckCheck className="h-4 w-4 mr-1.5" /> Dismiss all email alerts
              </Button>
            )}
            {mentions.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const newest = toIso(mentions[0].comment.createdAt);
                  setLastRead(newest);
                }}
              >
                <CheckCheck className="h-4 w-4 mr-1.5" /> Mark mentions read
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Email regressions section */}
      {regressionsQuery.isLoading ? null : regressions.length > 0 ? (
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <MailWarning className="h-3.5 w-3.5 text-amber-600" /> Email regressions
          </h2>
          <ul className="space-y-3" data-testid="email-regressions-list">
            {regressions.map((r) => {
              const changedIso = toIso(r.changedAt);
              return (
                <li key={r.id}>
                  <Card className="border-amber-300 bg-amber-50/40">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                        <MailWarning className="h-4 w-4 text-amber-600" />
                        <span className="text-muted-foreground font-normal">Email status changed for</span>
                        <Link
                          href={`/candidates/${r.candidateId}`}
                          className="text-primary hover:underline font-medium"
                        >
                          {r.candidateName}
                        </Link>
                        {r.candidateEmail && (
                          <span className="text-muted-foreground font-normal text-xs">
                            ({r.candidateEmail})
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground font-normal ml-auto">
                          {timeAgo(changedIso)}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <EmailValidationBadge status={r.previousStatus} />
                        <span className="text-muted-foreground">→</span>
                        <EmailValidationBadge status={r.newStatus} reason={r.newReason} />
                        {r.newReason && (
                          <span className="text-xs text-muted-foreground">— {r.newReason}</span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markOne.mutate({ id: r.id })}
                        disabled={markOne.isPending}
                        data-testid={`dismiss-regression-${r.id}`}
                      >
                        <X className="h-3.5 w-3.5 mr-1" /> Dismiss
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Mentions section */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-blue-600" /> Mentions
        </h2>
        {mentionsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading mentions…
          </div>
        ) : mentions.length === 0 && regressions.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Your inbox is empty. Mentions from teammates and email status alerts will show up here.
            </CardContent>
          </Card>
        ) : mentions.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No mentions yet.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3" data-testid="mentions-list">
            {mentions.map((m) => {
              const createdIso = toIso(m.comment.createdAt);
              const isUnread = !lastRead || new Date(createdIso) > new Date(lastRead);
              return (
                <li key={m.comment.id}>
                  <Card className={isUnread ? "border-blue-300 bg-blue-50/40" : ""}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                        <MessageSquare className="h-4 w-4 text-blue-600" />
                        <span className="font-medium">{m.comment.author}</span>
                        <span className="text-muted-foreground font-normal">mentioned you on</span>
                        <Link
                          href={`/candidates/${m.comment.candidateId}`}
                          className="text-primary hover:underline font-medium"
                        >
                          {m.candidateName}
                        </Link>
                        <span className="text-muted-foreground font-normal">for</span>
                        <span className="font-medium">{m.jobTitle}</span>
                        <span className="text-xs text-muted-foreground font-normal ml-auto">
                          {timeAgo(createdIso)}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm">
                      <CommentBody body={m.comment.body} mentions={m.comment.mentions} />
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
