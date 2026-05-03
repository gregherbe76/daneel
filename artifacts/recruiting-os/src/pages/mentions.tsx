import { useEffect } from "react";
import { Link } from "wouter";
import {
  useListTeamMembers,
  useListMentionsForMember,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AtSign, MessageSquare, Loader2, CheckCheck } from "lucide-react";
import { CommentBody } from "@/components/comment-body";
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

export default function MentionsPage() {
  const teamQuery = useListTeamMembers();
  const currentUser = useCurrentUser(teamQuery.data);
  const userId = currentUser?.id ?? "";
  const [lastRead, setLastRead] = useMentionsLastRead(userId);

  const mentionsQuery = useListMentionsForMember(userId, undefined, {
    query: {
      queryKey: ["mentions", userId],
      enabled: Boolean(userId),
      refetchInterval: 15000,
    },
  });
  const mentions = mentionsQuery.data ?? [];

  // Mark all as read on view
  useEffect(() => {
    if (mentions.length > 0) {
      const newest = mentions[0].comment.createdAt;
      const newestIso = typeof newest === "string" ? newest : new Date(newest).toISOString();
      if (!lastRead || new Date(newestIso) > new Date(lastRead)) {
        setLastRead(newestIso);
      }
    }
  }, [mentions, lastRead, setLastRead]);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <AtSign className="h-6 w-6 text-blue-600" />
            Mentions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {currentUser ? (
              <>Comments where teammates pulled <strong>{currentUser.name}</strong> into the conversation.</>
            ) : (
              <>Loading your inbox…</>
            )}
          </p>
        </div>
        {mentions.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const newest = mentions[0].comment.createdAt;
              const newestIso =
                typeof newest === "string" ? newest : new Date(newest).toISOString();
              setLastRead(newestIso);
            }}
          >
            <CheckCheck className="h-4 w-4 mr-1.5" /> Mark all read
          </Button>
        )}
      </div>

      {mentionsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading mentions…
        </div>
      ) : mentions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No mentions yet. When a teammate types{" "}
            <code className="px-1 py-0.5 bg-muted rounded">
              @{currentUser?.name ?? "you"}
            </code>{" "}
            in a candidate discussion, it will show up here.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="mentions-list">
          {mentions.map((m) => {
            const createdIso =
              typeof m.comment.createdAt === "string"
                ? m.comment.createdAt
                : new Date(m.comment.createdAt).toISOString();
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
    </div>
  );
}
