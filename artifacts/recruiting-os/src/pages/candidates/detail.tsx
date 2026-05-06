import { useRoute, Link } from "wouter";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCandidate,
  useGetCandidateApplications,
  useListJobs,
  useRecheckCandidateEmail,
  useListEmailStatusChanges,
  useMarkEmailStatusChangeRead,
  getGetCandidateQueryKey,
  getGetCandidateApplicationsQueryKey,
  getListEmailStatusChangesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Mail,
  Linkedin,
  Github,
  MapPin,
  Building2,
  Loader2,
  User,
  RefreshCw,
  MailWarning,
  X,
} from "lucide-react";
import { CandidateNotesPanel } from "@/components/candidate-notes-panel";
import { EmailValidationBadge } from "@/components/email-validation-badge";
import { EmailSourceBadge } from "@/components/email-source-badge";
import { EmailStatusHistoryCard } from "@/components/email-status-history-card";
import { RealSourcingPill } from "@/components/real-sourcing-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CouncilTab } from "@/components/council/council-tab";
import { TechnicalEvaluationTab } from "@/components/technical-evaluation-tab";

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

export default function CandidateDetailPage() {
  const [, params] = useRoute("/candidates/:id");
  const candidateId = parseInt(params?.id ?? "0", 10);

  const { data: candidate, isLoading } = useGetCandidate(candidateId, {
    query: {
      enabled: !!candidateId,
      queryKey: getGetCandidateQueryKey(candidateId),
    },
  });
  const { data: applications } = useGetCandidateApplications(candidateId, {
    query: {
      enabled: !!candidateId,
      queryKey: getGetCandidateApplicationsQueryKey(candidateId),
    },
  });
  const { data: jobs } = useListJobs();
  const queryClient = useQueryClient();
  const recheckEmail = useRecheckCandidateEmail({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCandidateQueryKey(candidateId) });
        queryClient.invalidateQueries({ queryKey: ["/api/email-status-changes"] });
      },
    },
  });

  const candidateRegressionParams = {
    unread: true,
    candidateId,
    limit: 1,
  } as const;
  const regressionsQuery = useListEmailStatusChanges(candidateRegressionParams, {
    query: {
      queryKey: getListEmailStatusChangesQueryKey(candidateRegressionParams),
      enabled: !!candidateId,
    },
  });
  const candidateRegression = regressionsQuery.data?.[0];
  const dismissRegression = useMarkEmailStatusChangeRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/email-status-changes"] });
      },
    },
  });

  const candidateHistoryParams = { candidateId, limit: 1000 } as const;
  const historyQuery = useListEmailStatusChanges(candidateHistoryParams, {
    query: {
      queryKey: getListEmailStatusChangesQueryKey(candidateHistoryParams),
      enabled: !!candidateId,
    },
  });
  const emailHistory = historyQuery.data ?? [];

  const appJobIds = new Set((applications ?? []).map((a) => a.jobId));
  const linkedJobs = (jobs ?? []).filter((j) => appJobIds.has(j.id));
  const firstJobId = linkedJobs[0]?.id ?? jobs?.[0]?.id ?? 0;
  const [selectedJobId, setSelectedJobId] = useState<number>(firstJobId);
  const activeJobId = selectedJobId || firstJobId;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-200px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!candidate) {
    return <div className="p-8">Candidate not found.</div>;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <Link href="/candidates">
          <Button variant="ghost" size="sm" className="mb-3 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to candidates
          </Button>
        </Link>

        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center shrink-0">
            <User className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">{candidate.name}</h1>
            {candidate.headline && (
              <p className="text-sm text-muted-foreground mt-0.5">{candidate.headline}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
              {candidate.email && (
                <span className="flex items-center gap-1.5">
                  <a
                    href={`mailto:${candidate.email}`}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    <Mail className="h-3.5 w-3.5" /> {candidate.email}
                  </a>
                  <EmailSourceBadge source={candidate.emailSource} />
                  <EmailValidationBadge
                    status={candidate.emailValidationStatus}
                    reason={candidate.emailValidationReason}
                  />
                  {candidate.emailValidatedAt && (
                    <span
                      className="text-muted-foreground/80"
                      title={new Date(candidate.emailValidatedAt).toLocaleString()}
                    >
                      checked {formatRelativeTime(candidate.emailValidatedAt)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => recheckEmail.mutate({ id: candidateId })}
                    disabled={recheckEmail.isPending}
                    className="inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
                    title="Re-run the email deliverability check now"
                  >
                    {recheckEmail.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Re-check
                  </button>
                </span>
              )}
              {candidateRegression && (
                <div
                  className="basis-full mt-1 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
                  data-testid="candidate-email-regression-callout"
                >
                  <MailWarning className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <span>Email status changed:</span>
                  <EmailValidationBadge status={candidateRegression.previousStatus} />
                  <span>→</span>
                  <EmailValidationBadge
                    status={candidateRegression.newStatus}
                    reason={candidateRegression.newReason}
                  />
                  <span className="text-amber-800/80">
                    on {new Date(candidateRegression.changedAt).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => dismissRegression.mutate({ id: candidateRegression.id })}
                    disabled={dismissRegression.isPending}
                    className="ml-1 inline-flex items-center gap-0.5 text-amber-800 hover:text-amber-950 disabled:opacity-50"
                    title="Dismiss this email status alert"
                    data-testid="dismiss-candidate-regression"
                  >
                    <X className="h-3 w-3" /> Dismiss
                  </button>
                </div>
              )}
              {candidate.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {candidate.location}
                </span>
              )}
              {candidate.currentCompany && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> {candidate.currentCompany}
                </span>
              )}
              {candidate.linkedIn && (
                <a href={candidate.linkedIn} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                  <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                </a>
              )}
              {candidate.githubUrl && (
                <a href={candidate.githubUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                  <Github className="h-3.5 w-3.5" /> GitHub
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="technical-evaluation" data-testid="tab-technical-evaluation">
            Technical Evaluation
          </TabsTrigger>
          <TabsTrigger value="council">Council</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {candidate.summary && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {candidate.summary}
                </p>
              </CardContent>
            </Card>
          )}

          {candidate.skills && candidate.skills.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Skills</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {candidate.skills.map((s) => (
                    <Badge key={s} variant="outline" className="bg-background">{s}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <EmailStatusHistoryCard
            candidateEmail={candidate.email}
            rows={emailHistory}
          />

          {/* Per-pipeline summary cards. One card per job this candidate is
              applied to, each showing the same "Real sourcing ready" /
              "Demo mode" pill from the jobs list — so recruiters can see at
              a glance which of this candidate's pipelines will produce real
              vs mock candidates without bouncing into each job page. */}
          {linkedJobs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">In Pipelines</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Jobs this candidate is currently in the pipeline for.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {linkedJobs.map((j) => (
                    <Link key={j.id} href={`/jobs/${j.id}`}>
                      <div
                        className="rounded-md border border-border bg-card hover:border-primary/50 transition-colors p-3 cursor-pointer h-full flex flex-col gap-2"
                        data-testid={`pipeline-summary-card-${j.id}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold truncate">
                            {j.title}
                          </span>
                          <RealSourcingPill
                            hasRealSourcingProvider={j.hasRealSourcingProvider}
                          />
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {j.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {j.location}
                            </span>
                          )}
                          {j.seniority && (
                            <Badge variant="secondary" className="text-[10px]">
                              {j.seniority}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes & comments scoped to a job */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notes &amp; team discussion</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Notes and comments are scoped to one job at a time so each role keeps its own conversation.
              </p>
            </CardHeader>
            <CardContent>
              {(jobs ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  Create a job first to start a discussion about this candidate.
                </p>
              ) : (
                <>
                  <div className="mb-4">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Discussing for which role?
                    </label>
                    <Select
                      value={String(activeJobId)}
                      onValueChange={(v) => setSelectedJobId(parseInt(v, 10))}
                    >
                      <SelectTrigger className="max-w-md">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(jobs ?? []).map((j) => (
                          <SelectItem key={j.id} value={String(j.id)}>
                            {j.title} · {j.location}
                            {appJobIds.has(j.id) ? " (applied)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {activeJobId > 0 && (
                    <CandidateNotesPanel
                      candidateId={candidateId}
                      jobId={activeJobId}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="technical-evaluation" className="space-y-4">
          {(jobs ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground italic text-center">
                  Create a job first — technical evaluations are scoped to a (candidate, job) pair.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Evaluation for which role?
                </label>
                <Select
                  value={String(activeJobId)}
                  onValueChange={(v) => setSelectedJobId(parseInt(v, 10))}
                >
                  <SelectTrigger className="max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.title} · {j.location}
                        {appJobIds.has(j.id) ? " (applied)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {activeJobId > 0 && (
                <TechnicalEvaluationTab
                  candidateId={candidateId}
                  jobId={activeJobId}
                  candidateGithubUsername={candidate.githubUsername ?? null}
                />
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="council" className="space-y-4">
          {(jobs ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground italic text-center">
                  Create a job first — Council deliberations are always scoped to a (candidate, job) pair.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Deliberating for which role?
                </label>
                <Select
                  value={String(activeJobId)}
                  onValueChange={(v) => setSelectedJobId(parseInt(v, 10))}
                >
                  <SelectTrigger className="max-w-md">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(jobs ?? []).map((j) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.title} · {j.location}
                        {appJobIds.has(j.id) ? " (applied)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {activeJobId > 0 && (
                <CouncilTab
                  candidateId={candidateId}
                  jobId={activeJobId}
                  jobTitle={(jobs ?? []).find((j) => j.id === activeJobId)?.title}
                />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
