import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { EmailValidationBadge } from "@/components/email-validation-badge";

export type EmailStatusHistoryRow = {
  id: number;
  previousStatus: string;
  newStatus: string;
  previousReason?: string | null;
  newReason?: string | null;
  changedAt: string;
};

type Props = {
  candidateEmail: string | null | undefined;
  rows: EmailStatusHistoryRow[];
};

function formatRelativeTime(input: string | Date): string {
  const ts = typeof input === "string" ? new Date(input).getTime() : input.getTime();
  const diffMs = Date.now() - ts;
  if (Number.isNaN(diffMs)) return "";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(days / 365);
  return `${years}y ago`;
}

export function EmailStatusHistoryCard({ candidateEmail, rows }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!candidateEmail || rows.length === 0) {
    return null;
  }

  return (
    <Card data-testid="email-status-history-card">
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-6 py-4 text-left hover:bg-muted/40 rounded-t-lg"
            data-testid="toggle-email-status-history"
          >
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Email status history</span>
              <Badge
                variant="outline"
                className="ml-1 font-normal"
                data-testid="email-status-history-count"
              >
                {rows.length}
              </Badge>
            </div>
            {historyOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <ul className="divide-y" data-testid="email-status-history-list">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="py-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                  data-testid={`email-status-history-row-${row.id}`}
                >
                  <EmailValidationBadge
                    status={row.previousStatus}
                    reason={row.previousReason}
                  />
                  <span className="text-muted-foreground">→</span>
                  <EmailValidationBadge
                    status={row.newStatus}
                    reason={row.newReason}
                  />
                  {row.newReason && (
                    <span
                      className="text-muted-foreground italic truncate max-w-xs"
                      title={row.newReason}
                      data-testid={`email-status-history-row-${row.id}-reason`}
                    >
                      · {row.newReason}
                    </span>
                  )}
                  <span
                    className="ml-auto text-muted-foreground"
                    title={new Date(row.changedAt).toLocaleString()}
                    data-testid={`email-status-history-row-${row.id}-timestamp`}
                  >
                    {new Date(row.changedAt).toLocaleDateString()} ·{" "}
                    {formatRelativeTime(row.changedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
