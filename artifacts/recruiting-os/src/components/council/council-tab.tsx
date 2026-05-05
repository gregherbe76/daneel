import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCandidateDeliberations,
  useCreateDeliberation,
  getListCandidateDeliberationsQueryKey,
} from "@workspace/api-client-react";
import type { DeliberationRecord } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Scale, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { Boardroom } from "./boardroom";

interface CouncilTabProps {
  candidateId: number;
  jobId: number;
  jobTitle?: string;
}

interface QuotaError {
  code: "QUOTA_EXCEEDED";
  error: string;
  upgradeUrl?: string | null;
}

export function CouncilTab({ candidateId, jobId, jobTitle }: CouncilTabProps) {
  const qc = useQueryClient();
  const params = { jobId } as const;
  const queryKey = getListCandidateDeliberationsQueryKey(candidateId, params);
  const { data: deliberations = [], isLoading } = useListCandidateDeliberations(candidateId, params, {
    query: { queryKey, enabled: !!candidateId && !!jobId },
  });

  const create = useCreateDeliberation();
  const [quotaError, setQuotaError] = useState<QuotaError | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const sorted = useMemo(
    () => [...(deliberations ?? [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [deliberations],
  );
  const selected: DeliberationRecord | undefined = sorted.find((d) => d.id === selectedId) ?? sorted[0];
  const isRunning = create.isPending || selected?.status === "running";

  async function runDeliberation() {
    setQuotaError(null);
    setGenericError(null);
    try {
      const created = await create.mutateAsync({ data: { candidateId, jobId } });
      qc.invalidateQueries({ queryKey });
      const id = (created as DeliberationRecord)?.id;
      if (typeof id === "number") setSelectedId(id);
    } catch (err: unknown) {
      // Orval surfaces fetch failures via thrown Response in some configs and
      // raw Error in others. Normalise both to extract a structured 402.
      const anyErr = err as { status?: number; response?: { status?: number; json?: () => Promise<unknown> }; body?: unknown; message?: string };
      const status = anyErr?.status ?? anyErr?.response?.status;
      let body: unknown = anyErr?.body;
      if (!body && typeof anyErr?.response?.json === "function") {
        try {
          body = await anyErr.response.json();
        } catch {
          /* ignore */
        }
      }
      const parsed = body as Partial<QuotaError> | undefined;
      if (status === 402 || parsed?.code === "QUOTA_EXCEEDED") {
        setQuotaError({
          code: "QUOTA_EXCEEDED",
          error: parsed?.error ?? "Council monthly quota reached.",
          upgradeUrl: parsed?.upgradeUrl ?? null,
        });
      } else {
        setGenericError(parsed?.error ?? anyErr?.message ?? "Council deliberation failed");
      }
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" />
              Council deliberation{jobTitle ? ` — ${jobTitle}` : ""}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Council deliberates with 15 named poles and returns convergence, divergence and orientations for this candidate.
            </p>
          </div>
          <Button onClick={runDeliberation} disabled={isRunning} size="sm" className="gap-1.5">
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {selected ? "Re-run" : "Run deliberation"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {quotaError && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Council quota reached</p>
                <p className="text-xs mt-0.5">{quotaError.error}</p>
                {quotaError.upgradeUrl && (
                  <a
                    href={quotaError.upgradeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium underline mt-1.5"
                  >
                    Upgrade Council Pro <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}

          {genericError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {genericError}
            </div>
          )}

          <Boardroom running={isRunning} poles={selected?.result?.poles ?? []} />

          {!selected && !isLoading && !isRunning && (
            <p className="text-sm text-muted-foreground text-center italic">
              No deliberations yet. Click <strong>Run deliberation</strong> to ask Council to weigh in on this candidate.
            </p>
          )}

          {selected?.status === "failed" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Council deliberation failed: {selected.error ?? "unknown error"}
            </div>
          )}

          {selected?.status === "completed" && selected.result && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <PanelCard title="Convergence" tone="success">
                {selected.result.convergence.verdict && (
                  <p className="text-sm font-medium text-foreground mb-1">{selected.result.convergence.verdict}</p>
                )}
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {selected.result.convergence.summary || "—"}
                </p>
              </PanelCard>
              <PanelCard title="Divergence" tone="warn">
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap mb-2">
                  {selected.result.divergence.summary || "—"}
                </p>
                <div className="flex flex-wrap gap-1">
                  {selected.result.divergence.axes.map((a: string, i: number) => (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {a}
                    </Badge>
                  ))}
                </div>
              </PanelCard>
              <PanelCard title="Orientations" tone="neutral">
                {selected.result.orientations.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No orientations.</p>
                ) : (
                  <ul className="space-y-2">
                    {selected.result.orientations.map((o: { title: string; detail: string }, i: number) => (
                      <li key={i}>
                        <p className="text-xs font-medium text-foreground">{o.title}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{o.detail}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelCard>
            </div>
          )}
        </CardContent>
      </Card>

      {sorted.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {sorted.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(d.id)}
                    className={`w-full flex items-center justify-between gap-3 py-2 text-left text-sm hover:bg-muted/40 px-2 rounded-md ${
                      d.id === (selected?.id ?? -1) ? "bg-muted/40" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <StatusDot status={d.status} />
                      <span className="text-xs text-muted-foreground">
                        {new Date(d.createdAt).toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {d.stage}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {d.result?.convergence?.verdict ?? d.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PanelCard({ title, tone, children }: { title: string; tone: "success" | "warn" | "neutral"; children: React.ReactNode }) {
  const border =
    tone === "success" ? "border-green-300/60" : tone === "warn" ? "border-amber-300/60" : "border-border";
  const bg = tone === "success" ? "bg-green-50/40" : tone === "warn" ? "bg-amber-50/40" : "bg-muted/30";
  return (
    <div className={`rounded-md border ${border} ${bg} p-3`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</p>
      {children}
    </div>
  );
}

function StatusDot({ status }: { status: DeliberationRecord["status"] }) {
  const color =
    status === "completed"
      ? "bg-green-500"
      : status === "failed"
        ? "bg-destructive"
        : status === "running"
          ? "bg-blue-500 animate-pulse"
          : "bg-muted-foreground";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />;
}
