import { useState, useEffect, useMemo, useRef } from "react";
import { branding } from "@workspace/branding";
import { useKickoffDefaults } from "./use-kickoff-defaults";
import { KickoffWorkflowToggles } from "./kickoff-workflow-toggles";
import {
  useGetJob,
  useGetJobApplications,
  ApplicationStage,
  useUpdateApplication,
  getGetJobApplicationsQueryKey,
  useRunWorkflow,
  useGetLatestJobWorkflow,
  getGetLatestJobWorkflowQueryKey,
  useRunVariantWorkflow,
  useImproveAndRerun,
  useListJobRuns,
  getListJobRunsQueryKey,
  useListProviderStepSettings,
  usePreviewGithubQuery,
} from "@workspace/api-client-react";
import { useRoute, Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Loader2, MapPin, Edit, User, Mail, ArrowRight, Play,
  Sparkles, ChevronDown, ChevronUp, ChevronRight, BrainCircuit, Zap,
  Building2, Github, Linkedin, AlertTriangle, FileText, GitBranch,
  Upload, Bot, Users, Eye, Search, FlaskConical,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { RunVariantModal } from "@/components/run-variant-modal";
import { addPendingImproveRun, markJobRunsSeen } from "@/lib/pending-runs";
import { track as trackTelemetry } from "@/lib/telemetry";
import { ImportCandidatesModal } from "@/components/import-candidates-modal";
import { FindCandidatesModal } from "@/components/find-candidates-modal";
import { ImproveRerunModal, type ImproveRerunCandidate } from "@/components/improve-rerun-modal";
import { CompareRuns } from "@/components/compare-runs";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CandidateNotesIndicator } from "@/components/candidate-notes-indicator";
import { BulkActionBar } from "@/components/bulk-action-bar";
import { RealSourcingPill } from "@/components/real-sourcing-pill";
import { EmailSourceBadge } from "@/components/email-source-badge";
import { EmailValidationBadge } from "@/components/email-validation-badge";
import {
  EmailStatusFilter,
  EmailStatusFilterValue,
  isEmailStatusFilterValue,
  matchesEmailStatusFilter,
  getStoredEmailStatusFilter,
  setStoredEmailStatusFilter,
} from "@/components/email-status-filter";
import {
  EmailSourceFilter,
  EMAIL_SOURCE_VALUES,
  parseEmailSourceParam,
  serializeEmailSourceParam,
  matchesEmailSourceFilter,
  getStoredEmailSourceFilter,
  setStoredEmailSourceFilter,
} from "@/components/email-source-filter";

// ── color helpers ────────────────────────────────────────────────────────────

const getRecommendationColor = (rec?: string) => {
  if (rec === "Strong Yes") return "bg-green-500/10 text-green-700 hover:bg-green-500/20 border-green-200";
  if (rec === "Yes") return "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 border-emerald-200";
  if (rec === "Maybe") return "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-amber-200";
  if (rec === "No") return "bg-red-500/10 text-red-700 hover:bg-red-500/20 border-red-200";
  return "bg-secondary text-secondary-foreground";
};

const getScoreColor = (score?: number) => {
  if (!score) return "bg-secondary";
  if (score >= 80) return "bg-green-500/10 text-green-700 border-green-200";
  if (score >= 60) return "bg-amber-500/10 text-amber-700 border-amber-200";
  return "bg-red-500/10 text-red-700 border-red-200";
};

// ── Sourced Candidate Card ────────────────────────────────────────────────────

type SourcedCandidate = {
  id: number;
  name: string;
  headline?: string | null;
  location?: string | null;
  currentCompany?: string | null;
  email: string;
  linkedIn?: string | null;
  githubUrl?: string | null;
  skills: string[];
  summary?: string | null;
  source?: string | null;
};

function SourcedCandidateCard({ candidate }: { candidate: SourcedCandidate }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold truncate">{candidate.name}</CardTitle>
            {candidate.headline && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{candidate.headline}</p>
            )}
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0 bg-purple-500/10 text-purple-700 border-purple-200 whitespace-nowrap">
            <Zap className="h-2.5 w-2.5 mr-1" />
            AI Sourced
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-1">
          {candidate.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />{candidate.location}
            </span>
          )}
          {candidate.currentCompany && (
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />{candidate.currentCompany}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 text-xs">
        {candidate.summary && (
          <p className="text-muted-foreground line-clamp-3">{candidate.summary}</p>
        )}
        {candidate.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {candidate.skills.slice(0, 5).map((s) => (
              <span key={s} className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground border border-border">{s}</span>
            ))}
            {candidate.skills.length > 5 && (
              <span className="px-1.5 py-0.5 text-muted-foreground">+{candidate.skills.length - 5}</span>
            )}
          </div>
        )}
        <div className="flex gap-2 mt-auto pt-2 border-t border-border">
          {candidate.linkedIn && (
            <a href={candidate.linkedIn} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
              <Linkedin className="h-3.5 w-3.5" />
            </a>
          )}
          {candidate.githubUrl && (
            <a href={candidate.githubUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
              <Github className="h-3.5 w-3.5" />
            </a>
          )}
          <Link href={`/candidates/${candidate.id}`} className="ml-auto">
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2">View Profile</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── job-scoped GitHub query preview ──────────────────────────────────────────
//
// Shown inline on the job kickoff area when sourcing is enabled and a GitHub
// provider is assigned to the sourcing step. Lets the recruiter sanity-check
// the assembled `q=` for THIS job before clicking Run.
function JobGithubQueryPreview({
  jobId,
  jobTitle,
  jobLocation,
  jobMustHaveSkills,
}: {
  jobId: number;
  jobTitle?: string | null;
  jobLocation?: string | null;
  jobMustHaveSkills?: string[] | null;
}) {
  const { data: stepSettings = [] } = useListProviderStepSettings();
  const previewMutation = usePreviewGithubQuery();

  const sourcingSetting = stepSettings.find(
    (s) => s.workflowStep === "sourcing" && s.enabled,
  );
  const sourcingProvider = sourcingSetting?.provider;
  const isGithub = sourcingProvider?.type === "github";

  const [result, setResult] = useState<{
    query: string;
    totalCount?: number | null;
    totalCountError?: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable signature of the job fields that affect the assembled query, so
  // edits made in another tab (title/location/must-have skills) refresh the
  // preview instead of leaving a stale `q=` on screen.
  const jobQuerySignature = JSON.stringify([
    jobTitle ?? "",
    jobLocation ?? "",
    [...(jobMustHaveSkills ?? [])].sort(),
  ]);

  // Auto-build the assembled query as soon as the panel renders for a github
  // provider — no extra clicks needed for the common "just show me" case.
  useEffect(() => {
    if (!isGithub || !sourcingProvider) return;
    let cancelled = false;
    setError(null);
    // Clear the previous query so a stale `q=` is never shown while the
    // refreshed preview is in flight after a job edit.
    setResult(null);
    previewMutation
      .mutateAsync({ data: { jobId, providerId: sourcingProvider.id, runMatches: false } })
      .then((res) => {
        if (!cancelled) setResult(res as typeof result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Preview failed");
      });
    return () => {
      cancelled = true;
    };
    // Intentionally re-run only when job or assigned provider changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, sourcingProvider?.id, isGithub, jobQuerySignature]);

  if (!isGithub || !sourcingProvider) return null;

  async function runMatches() {
    if (!sourcingProvider) return;
    setError(null);
    try {
      const res = await previewMutation.mutateAsync({
        data: { jobId, providerId: sourcingProvider.id, runMatches: true },
      });
      setResult(res as typeof result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    }
  }

  const isPending = previewMutation.isPending;

  return (
    <div className="rounded-md border border-purple-200 bg-purple-500/5 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Github className="h-3 w-3 text-purple-700" />
        <p className="text-[11px] font-semibold text-purple-900">
          GitHub Agent query — {sourcingProvider.name}
        </p>
      </div>
      {!result && isPending && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Building query…
        </div>
      )}
      {result && (
        <>
          <pre className="rounded bg-background border border-border p-1.5 text-[10px] font-mono whitespace-pre-wrap break-all text-foreground max-h-24 overflow-auto">
            {result.query}
          </pre>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              disabled={isPending}
              onClick={runMatches}
              className="inline-flex items-center gap-1 text-[10px] text-purple-800 hover:underline disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Search className="h-2.5 w-2.5" />
              )}
              Preview matches
            </button>
            {result.totalCount != null && (
              <span className="text-[10px] text-foreground">
                <strong className="font-semibold">{result.totalCount.toLocaleString()}</strong>{" "}
                matching GitHub user{result.totalCount === 1 ? "" : "s"}
              </span>
            )}
            {result.totalCountError && (
              <span className="text-[10px] text-destructive truncate" title={result.totalCountError}>
                Match lookup failed
              </span>
            )}
          </div>
        </>
      )}
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Eye className="h-2.5 w-2.5" />
        Tune in Settings → Providers → {sourcingProvider.name}
      </p>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const jobId = parseInt(params?.id || "0", 10);

  const { data: job, isLoading: isLoadingJob } = useGetJob(jobId, {
    query: { enabled: !!jobId, queryKey: [`/api/jobs/${jobId}`] },
  });

  const { data: applications, isLoading: isLoadingApps, dataUpdatedAt: appsUpdatedAt } = useGetJobApplications(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobApplicationsQueryKey(jobId) },
  });
  // Selection of candidate ids inside the Pipeline. Resets on filter change,
  // job route change, or list refetch so the bulk bar can never reflect a
  // stale set.
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<number>>(new Set());

  const { data: workflowData, isLoading: isLoadingWorkflow } = useGetLatestJobWorkflow(jobId, {
    query: {
      enabled: !!jobId,
      queryKey: getGetLatestJobWorkflowQueryKey(jobId),
      refetchInterval: (query) => {
        const status = query.state.data?.run?.status;
        return (status === 'running' || status === 'pending') ? 3000 : false;
      }
    }
  });

  // All runs for this job — used to show the sourcing filter breakdown for
  // *historical* runs too, not just the latest one. The list is descending by
  // createdAt; we drop the most recent so we don't duplicate the latest-run
  // panel rendered above.
  const { data: jobRuns } = useListJobRuns(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobRunsQueryKey(jobId) },
  });

  // Fire `workflow_completed` once when the latest run transitions to
  // completed. Tracks the runId we've already reported to avoid duplicates
  // across re-renders and refetches.
  const [lastReportedCompletedRunId, setLastReportedCompletedRunId] = useState<number | null>(null);
  useEffect(() => {
    const runId = workflowData?.run?.id;
    const status = workflowData?.run?.status;
    if (runId && status === "completed" && lastReportedCompletedRunId !== runId) {
      trackTelemetry("workflow_completed", { workflow_step: "candidate_matching" });
      setLastReportedCompletedRunId(runId);
    }
  }, [workflowData?.run?.id, workflowData?.run?.status, lastReportedCompletedRunId]);

  const runWorkflow = useRunWorkflow();
  const runVariantWorkflow = useRunVariantWorkflow();
  const improveAndRerun = useImproveAndRerun();
  const updateApp = useUpdateApplication();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isInsightsOpen, setIsInsightsOpen] = useState(true);
  const [isAllEvalsOpen, setIsAllEvalsOpen] = useState(false);
  const [isSourcedOpen, setIsSourcedOpen] = useState(true);
  // Workflow kickoff defaults — the hook auto-promotes to Real + Run
  // Sourcing on once the job loads with a real sourcing provider
  // configured (GitHub Agent or Web Search), and freezes the moment
  // the user explicitly clicks either toggle. See use-kickoff-defaults.ts.
  const realSourcingAvailable = job?.hasRealSourcingProvider ?? false;
  const {
    dataMode,
    runSourcing,
    userTouched: userTouchedToggles,
    setDataMode,
    setRunSourcing,
    resetTouchFlag,
  } = useKickoffDefaults(realSourcingAvailable, !!job);
  const [runEnrichment, setRunEnrichment] = useState(false);

  useEffect(() => {
    if (jobId) markJobRunsSeen(jobId);
    // Reset the "user explicitly chose toggle values" flag when switching
    // to a different job, so the new job's defaulting kicks in fresh.
    resetTouchFlag();
    // resetTouchFlag is a stable closure-bound setter; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [highlightStep2, setHighlightStep2] = useState(false);
  const [isImproveModalOpen, setIsImproveModalOpen] = useState(false);

  const search = useSearch();
  const [, navigate] = useLocation();
  const emailFilter: EmailStatusFilterValue = useMemo(() => {
    const parsed = new URLSearchParams(search);
    const v = parsed.get("email");
    return isEmailStatusFilterValue(v) ? v : "all";
  }, [search]);
  const selectedSources: Set<string> = useMemo(
    () => parseEmailSourceParam(search),
    [search],
  );
  // Keep the latest search string in a ref so back-to-back updateUrl calls
  // within the same render compose correctly. Without this, both calls would
  // read the same stale `search` from the closure and the second navigate()
  // would clobber the first (e.g. clearing both `email` and `emailSource` in
  // a single tick).
  const searchRef = useRef(search);
  searchRef.current = search;
  const updateUrl = (mutate: (params: URLSearchParams) => void) => {
    const parsed = new URLSearchParams(searchRef.current);
    mutate(parsed);
    const qs = parsed.toString();
    searchRef.current = qs;
    navigate(`/jobs/${jobId}${qs ? `?${qs}` : ""}`, { replace: true });
  };
  const setEmailFilter = (value: EmailStatusFilterValue) => {
    setStoredEmailStatusFilter(value);
    updateUrl((p) => {
      if (value === "all") p.delete("email");
      else p.set("email", value);
    });
  };
  useEffect(() => {
    const parsed = new URLSearchParams(search);
    if (parsed.get("email")) return;
    const stored = getStoredEmailStatusFilter();
    if (stored && stored !== "all") {
      parsed.set("email", stored);
      const qs = parsed.toString();
      navigate(`/jobs/${jobId}${qs ? `?${qs}` : ""}`, { replace: true });
    }
    // Restore saved preference once on mount when URL has no explicit value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setSelectedSources = (next: Set<string>) => {
    setStoredEmailSourceFilter(next);
    const serialized = serializeEmailSourceParam(next);
    updateUrl((p) => {
      if (serialized) p.set("emailSource", serialized);
      else p.delete("emailSource");
    });
  };
  useEffect(() => {
    const parsed = new URLSearchParams(search);
    if (parsed.get("emailSource")) return;
    const stored = getStoredEmailSourceFilter();
    if (stored && stored.size > 0) {
      parsed.set("emailSource", serializeEmailSourceParam(stored));
      const qs = parsed.toString();
      navigate(`/jobs/${jobId}${qs ? `?${qs}` : ""}`, { replace: true });
    }
    // Restore saved preference once on mount when URL has no explicit value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const availableSources = useMemo(() => {
    const set = new Set<string>();
    let hasUnknown = false;
    for (const app of applications ?? []) {
      const s = app.candidate.emailSource;
      if (s && EMAIL_SOURCE_VALUES.has(s)) set.add(s);
      else hasUnknown = true;
    }
    return { set, hasUnknown };
  }, [applications]);
  const emailFilteredApplications = useMemo(
    () =>
      applications?.filter(
        (app) =>
          matchesEmailSourceFilter(app.candidate.emailSource, selectedSources) &&
          matchesEmailStatusFilter(app.candidate.emailValidationStatus, emailFilter),
      ),
    [applications, emailFilter, selectedSources],
  );

  // Reset selection on filter / job / refetch changes.
  useEffect(() => {
    setSelectedCandidateIds(new Set());
  }, [jobId, emailFilter, selectedSources, appsUpdatedAt]);

  const filteredCandidateIds = useMemo(
    () => (emailFilteredApplications ?? []).map((app) => app.candidate.id),
    [emailFilteredApplications],
  );
  const allFilteredSelected =
    filteredCandidateIds.length > 0 &&
    filteredCandidateIds.every((id) => selectedCandidateIds.has(id));
  const someFilteredSelected =
    !allFilteredSelected &&
    filteredCandidateIds.some((id) => selectedCandidateIds.has(id));
  const headerCheckedState: boolean | "indeterminate" = allFilteredSelected
    ? true
    : someFilteredSelected
      ? "indeterminate"
      : false;
  const togglePipelineHeader = () => {
    setSelectedCandidateIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const id of filteredCandidateIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of filteredCandidateIds) next.add(id);
      return next;
    });
  };
  const togglePipelineRow = (id: number) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const emailCounts = useMemo(() => {
    const c: Partial<Record<EmailStatusFilterValue, number>> = {
      all: 0,
      valid: 0,
      risky: 0,
      invalid: 0,
      unchecked: 0,
    };
    applications?.forEach((app) => {
      if (!matchesEmailSourceFilter(app.candidate.emailSource, selectedSources)) return;
      c.all! += 1;
      const s = app.candidate.emailValidationStatus;
      if (s === "valid") c.valid! += 1;
      else if (s === "risky") c.risky! += 1;
      else if (s === "invalid") c.invalid! += 1;
      else c.unchecked! += 1;
    });
    return c;
  }, [applications, selectedSources]);

  const stages = Object.values(ApplicationStage);

  const handleStageChange = (appId: number, newStage: typeof ApplicationStage[keyof typeof ApplicationStage]) => {
    updateApp.mutate(
      { id: appId, data: { stage: newStage } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetJobApplicationsQueryKey(jobId) });
          toast({ title: "Stage updated successfully" });
        },
      }
    );
  };

  const handleRunWorkflow = () => {
    trackTelemetry("workflow_started", { workflow_step: "candidate_matching" });
    runWorkflow.mutate({ data: { jobId, dataMode, runSourcing, runEnrichment } }, {
      onSuccess: () => {
        const modeLabel = dataMode === "real" ? "Real Data Run" : "Demo Run (Mock Data)";
        const parts: string[] = [modeLabel];
        if (runSourcing) parts.push("sourcing");
        if (runEnrichment) parts.push("enrichment");
        toast({
          title: `Workflow started — ${modeLabel}`,
          description: dataMode === "real"
            ? "Matching against imported and Twin-sourced candidates only…"
            : runSourcing
            ? "Generating mock candidates before matching…"
            : runEnrichment
            ? "Enriching candidate profiles before matching…"
            : "Analysing mock candidates against the job…",
        });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: getGetLatestJobWorkflowQueryKey(jobId) });
          queryClient.invalidateQueries({ queryKey: getGetJobApplicationsQueryKey(jobId) });
          queryClient.invalidateQueries({ queryKey: getListJobRunsQueryKey(jobId) });
        }, 2000);
      }
    });
  };

  const handleImproveAndRerun = () => {
    const runId = workflowData?.run?.id;
    if (!runId || !job) return;
    improveAndRerun.mutate(
      { data: { runId } },
      {
        onSuccess: (result) => {
          setIsImproveModalOpen(false);
          toast({
            title: "Improve and Rerun started",
            description: `Enriching ${result.lowConfidenceCandidateCount} low-confidence profile${result.lowConfidenceCandidateCount === 1 ? "" : "s"} and re-scoring. We'll notify you when it's ready — you can navigate away.`,
          });
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: getGetLatestJobWorkflowQueryKey(jobId) });
            queryClient.invalidateQueries({ queryKey: getListJobRunsQueryKey(jobId) });
          }, 2000);
          addPendingImproveRun({
            runId: result.run.id,
            jobId,
            jobTitle: job.title,
            startedAt: Date.now(),
          });
        },
        onError: () => {
          toast({ title: "Failed to start Improve and Rerun", variant: "destructive" });
        },
      }
    );
  };

  const handleRunVariant = (label: string, criteria: { seniority?: string | null; mustHaveSkills?: string[] | null; focusNote?: string | null }) => {
    const baseRunId = workflowData?.run?.id;
    if (!baseRunId) return;
    runVariantWorkflow.mutate(
      { data: { jobId, baseRunId, variantLabel: label, variantCriteria: criteria } },
      {
        onSuccess: () => {
          setIsVariantModalOpen(false);
          toast({
            title: "Variant run started",
            description: label ? `"${label}" is now running…` : "Variant workflow is running…",
          });
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: getGetLatestJobWorkflowQueryKey(jobId) });
            queryClient.invalidateQueries({ queryKey: getListJobRunsQueryKey(jobId) });
          }, 2000);
        },
        onError: () => {
          toast({ title: "Failed to start variant", variant: "destructive" });
        },
      }
    );
  };

  if (isLoadingJob || isLoadingApps) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-200px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!job) {
    return <div className="p-8">Job not found</div>;
  }

  const workflowRunning = workflowData?.run?.status === 'pending' || workflowData?.run?.status === 'running';
  const sourcedCandidates = (workflowData?.sourcedCandidates ?? []) as SourcedCandidate[];
  const hadSourcingRun = workflowData?.run?.runSourcing && sourcedCandidates.length > 0;

  const lowConfidenceEvaluations = workflowData?.run?.status === "completed"
    ? (workflowData.evaluations ?? []).filter(
        (e: { confidenceLevel?: string | null; dataConfidenceScore?: number | null; requiresEnrichment?: boolean | null }) =>
          e.confidenceLevel === "Low" ||
          (e.dataConfidenceScore !== null && e.dataConfidenceScore !== undefined && e.dataConfidenceScore < 50) ||
          e.requiresEnrichment === true,
      )
    : [];
  const lowConfidenceCount = lowConfidenceEvaluations.length;

  const lowConfidenceCandidates: ImproveRerunCandidate[] = lowConfidenceEvaluations.map(
    (e: {
      candidateId: number;
      confidenceLevel?: string | null;
      dataConfidenceScore?: number | null;
      requiresEnrichment?: boolean | null;
      confidenceReason?: string | null;
      missingDataWarnings?: string[] | null;
      candidate?: { name?: string | null; headline?: string | null } | null;
    }) => ({
      candidateId: e.candidateId,
      name: e.candidate?.name ?? `Candidate #${e.candidateId}`,
      headline: e.candidate?.headline ?? null,
      confidenceLevel: e.confidenceLevel ?? "Low",
      dataConfidenceScore: e.dataConfidenceScore ?? null,
      missingDataWarnings: e.missingDataWarnings ?? [],
      requiresEnrichment: e.requiresEnrichment ?? null,
      confidenceReason: e.confidenceReason ?? null,
    }),
  );

  const isImproving = improveAndRerun.isPending || (
    workflowData?.run?.variantLabel === "Improved Run" && workflowRunning
  );

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ── */}
      <div className="p-8 border-b border-border bg-card flex-shrink-0">
        <div className="max-w-7xl mx-auto flex justify-between items-start gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">{job.title}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4 flex-wrap">
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {job.location}
              </span>
              <Badge variant="secondary">{job.seniority}</Badge>
              <RealSourcingPill hasRealSourcingProvider={job.hasRealSourcingProvider} />
            </div>
            <div className="flex gap-2 flex-wrap">
              {job.mustHaveSkills?.map((skill) => (
                <Badge key={skill} variant="outline" className="bg-background">
                  {skill}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            {/* ── 3-step action row ── */}
            <div className="flex items-start gap-2">

              {/* Step 1 */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Step 1</span>
                <Button variant="outline" onClick={() => setIsImportOpen(true)} className="whitespace-nowrap">
                  <Users className="mr-2 h-4 w-4" />
                  Add Candidates
                </Button>
                <button
                  type="button"
                  onClick={() => setIsFindOpen(true)}
                  className="text-[11px] text-primary hover:underline underline-offset-2"
                >
                  or find with AI
                </button>
              </div>

              <ChevronRight className="h-4 w-4 text-muted-foreground mt-7 shrink-0" />

              {/* Step 2 */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Step 2</span>
                <Button
                  onClick={handleRunWorkflow}
                  disabled={runWorkflow.isPending || workflowRunning}
                  className={`bg-primary/90 hover:bg-primary whitespace-nowrap transition-all ${
                    highlightStep2
                      ? "ring-4 ring-primary/40 ring-offset-2 scale-105 shadow-lg"
                      : ""
                  }`}
                >
                  {workflowRunning ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {workflowRunning ? "Running…" : "Run AI Workflow"}
                </Button>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-[11px] text-muted-foreground hover:underline underline-offset-2"
                >
                  {showAdvanced ? "Hide" : "Advanced"} options
                </button>
              </div>

              <ChevronRight className="h-4 w-4 text-muted-foreground mt-7 shrink-0" />

              {/* Step 3 */}
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Step 3</span>
                {workflowData?.run?.status === "completed" ? (
                  <Link href={`/jobs/${job.id}/report`}>
                    <Button variant="outline" className="whitespace-nowrap border-green-300 text-green-800 hover:bg-green-50">
                      <FileText className="mr-2 h-4 w-4" />
                      View Shortlist
                    </Button>
                  </Link>
                ) : (
                  <Button variant="outline" disabled className="opacity-40 whitespace-nowrap">
                    <FileText className="mr-2 h-4 w-4" />
                    View Shortlist
                  </Button>
                )}
                {workflowData?.run?.status === "completed" && (
                  <button
                    type="button"
                    onClick={() => setIsVariantModalOpen(true)}
                    className="text-[11px] text-muted-foreground hover:underline underline-offset-2"
                  >
                    Run Variant
                  </button>
                )}
              </div>
            </div>

            {/* ── Advanced options (collapsed by default) ── */}
            {showAdvanced && (
              <div className="mt-1 pt-3 border-t border-border w-full space-y-2 min-w-[420px]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Advanced Options</p>
                {/* Data mode + Run Sourcing toggles + auto-default hint.
                    Extracted into KickoffWorkflowToggles so the auto-defaulting
                    integration with useKickoffDefaults can be unit-tested
                    in isolation (see kickoff-workflow-toggles.test.tsx). */}
                <KickoffWorkflowToggles
                  dataMode={dataMode}
                  runSourcing={runSourcing}
                  userTouchedToggles={userTouchedToggles}
                  realSourcingAvailable={realSourcingAvailable}
                  workflowRunning={workflowRunning}
                  setDataMode={setDataMode}
                  setRunSourcing={setRunSourcing}
                />
                {runSourcing && (
                  <JobGithubQueryPreview
                    jobId={jobId}
                    jobTitle={job.title}
                    jobLocation={job.location}
                    jobMustHaveSkills={job.mustHaveSkills}
                  />
                )}
                {/* Enrichment */}
                <div className={`flex items-start gap-2 px-2.5 py-2 rounded-md border transition-colors ${
                  runEnrichment ? "border-blue-200 bg-blue-500/5" : "border-border bg-muted/30"
                }`}>
                  <Checkbox id="run-enrichment" checked={runEnrichment} onCheckedChange={(v) => setRunEnrichment(!!v)} disabled={workflowRunning} className="mt-0.5" />
                  <div>
                    <Label htmlFor="run-enrichment" className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                      <Sparkles className="h-3 w-3 text-blue-600" />
                      Enrichment before scoring
                    </Label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Pulls richer details on each candidate (skills, headline, summary). Needs an Enrichment provider configured in Settings.</p>
                  </div>
                </div>
                {/* Edit job */}
                <div className="pt-1">
                  <Link href={`/jobs/${job.id}/edit`}>
                    <button type="button" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                      <Edit className="h-3 w-3" />
                      Edit job details
                    </button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-background">
        <div className="p-8 max-w-7xl mx-auto space-y-8">

          {/* ── Persistent guided wizard ── */}
          {!isLoadingWorkflow && (
            <OnboardingWizard
              jobId={jobId}
              hasProviders={true}
              hasCandidates={(applications?.length ?? 0) > 0}
              hasCompletedRun={workflowData?.run?.status === "completed"}
              onAddCandidates={() => setIsImportOpen(true)}
              onRunScreening={handleRunWorkflow}
              onConfigureProviders={() => { window.location.href = `${import.meta.env.BASE_URL}settings/providers`; }}
            />
          )}

          {/* ── SMART SCREENING INSIGHTS ── */}
          <Collapsible open={isInsightsOpen} onOpenChange={setIsInsightsOpen} className="border border-border rounded-lg bg-card shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20">
              <div className="flex items-center gap-2 flex-wrap">
                <BrainCircuit className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">AI Workflow Insights</h2>
                {workflowData?.run && (
                  <Badge variant="outline" className={`ml-2 capitalize ${
                    workflowData.run.status === 'completed' ? 'border-green-500 text-green-600' :
                    workflowData.run.status === 'failed' ? 'border-red-500 text-red-600' :
                    workflowData.run.status === 'running' ? 'border-blue-500 text-blue-600' :
                    'border-amber-500 text-amber-600'
                  }`}>
                    {workflowData.run.status}
                  </Badge>
                )}
                {workflowData?.run?.runSourcing && (
                  <Badge variant="outline" className="border-purple-300 text-purple-700 bg-purple-500/5">
                    <Zap className="h-3 w-3 mr-1" />
                    Sourcing enabled
                  </Badge>
                )}
                {lowConfidenceCount > 0 && !workflowRunning && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-1 border-amber-300 text-amber-800 hover:bg-amber-50 gap-1.5"
                    disabled={isImproving}
                    onClick={() => setIsImproveModalOpen(true)}
                  >
                    {isImproving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {isImproving
                      ? "Improving…"
                      : `Improve and Rerun — ${lowConfidenceCount} low-confidence profile${lowConfidenceCount === 1 ? "" : "s"}`}
                  </Button>
                )}
              </div>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-8 h-8 p-0">
                  {isInsightsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
            </div>
            
            <CollapsibleContent>
              <div className="p-6">
                {!workflowData?.run ? (
                  <div className="text-center py-12 space-y-3">
                    <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                      <Sparkles className="h-7 w-7 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg">Ready to find your best candidates?</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Run the AI workflow — we'll read every profile and rank them against this role across 3 {branding.productName} dimensions: autonomy, product mindset and impact.
                    </p>
                    <Button
                      onClick={handleRunWorkflow}
                      disabled={runWorkflow.isPending || workflowRunning}
                      className="mt-2 bg-primary/90 hover:bg-primary"
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      Run AI Workflow
                    </Button>
                  </div>
                ) : workflowRunning ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {workflowData.run.runSourcing
                        ? "Sourcing candidates, then matching and shortlisting…"
                        : "Analysing job and matching candidates…"}
                    </div>
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-32 w-full" />
                    <div className="flex gap-4">
                      <Skeleton className="h-48 w-1/3" />
                      <Skeleton className="h-48 w-1/3" />
                      <Skeleton className="h-48 w-1/3" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">

                    {/* ── Step timeline strip ──
                        Lists every step the latest run executed with its
                        status + the provider that produced the result.
                        Engine denormalizes providerName onto each step's
                        completed log output (see engine.ts logStep calls)
                        so we don't have to re-resolve provider settings.
                        Covers enrichment + decision too — those steps don't
                        get their own dedicated section card below. */}
                    {(() => {
                      type StepLog = { step: string; status: string; output?: unknown };
                      const logs = (workflowData.logs ?? []) as StepLog[];
                      if (logs.length === 0) return null;
                      const STEP_ORDER = [
                        "job_understanding",
                        "sourcing",
                        "enrichment",
                        "candidate_matching",
                        "shortlist",
                        "decision",
                      ];
                      const STEP_LABELS: Record<string, string> = {
                        job_understanding: "Job Understanding",
                        sourcing: "Sourcing",
                        enrichment: "Enrichment",
                        candidate_matching: "Candidate Matching",
                        shortlist: "Shortlist",
                        decision: "Decision (Council)",
                      };
                      // Pick the most recent log per step so a "running" log
                      // doesn't shadow a later "completed" / "failed" log.
                      const latestByStep = new Map<string, StepLog>();
                      for (const l of logs) latestByStep.set(l.step, l);
                      const rendered = STEP_ORDER
                        .map((s) => latestByStep.get(s))
                        .filter((l): l is StepLog => !!l);
                      if (rendered.length === 0) return null;
                      return (
                        <div className="rounded-md border border-border bg-muted/20 p-3">
                          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                            Run Timeline
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {rendered.map((l) => {
                              const providerName =
                                (l.output as { providerName?: string } | null)?.providerName ?? null;
                              const tone =
                                l.status === "completed"
                                  ? "border-purple-200 bg-purple-500/10 text-purple-700"
                                  : l.status === "failed"
                                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                                    : "border-border bg-background text-muted-foreground";
                              return (
                                <div
                                  key={l.step}
                                  data-testid={`workflow-step-${l.step}`}
                                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${tone}`}
                                >
                                  <span className="font-medium">{STEP_LABELS[l.step] ?? l.step}</span>
                                  {providerName && (
                                    <span
                                      data-testid={`workflow-step-${l.step}-provider`}
                                      className="font-normal opacity-80"
                                    >
                                      via {providerName}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Sourcing step status */}
                    {workflowData.run.runSourcing && (() => {
                      const sourcingLog = workflowData.logs?.find((l: { step: string; status: string; output?: unknown }) => l.step === "sourcing");
                      if (!sourcingLog) return null;
                      type SourcingStats = {
                        searchTotalCount?: number;
                        consideredCount?: number;
                        extractedCount?: number;
                        droppedNoBio?: number;
                        droppedStale?: number;
                        droppedFetchError?: number;
                        droppedInvalid?: number;
                        droppedNoProfile?: number;
                        droppedFabricated?: number;
                        returnedCount?: number;
                      };
                      const output = sourcingLog.output as {
                        generated?: number;
                        saved?: number;
                        error?: string;
                        stats?: SourcingStats | null;
                        providerName?: string;
                        providerType?: string;
                      } | null;
                      const stats = output?.stats ?? null;
                      const providerName = output?.providerName ?? null;
                      const totalDropped =
                        (stats?.droppedNoBio ?? 0) +
                        (stats?.droppedStale ?? 0) +
                        (stats?.droppedFetchError ?? 0) +
                        (stats?.droppedInvalid ?? 0) +
                        (stats?.droppedNoProfile ?? 0) +
                        (stats?.droppedFabricated ?? 0);
                      // Search-style providers (Web Search, Apify) report
                      // searchTotalCount = 0 when the upstream search returned
                      // zero organic results. In that case every other counter
                      // is also 0, so showing a row of "0 search hits / 0
                      // inspected / 0 returned" badges is just noise — surface
                      // a plain-English explanation instead.
                      // Gate on searchTotalCount being explicitly present so
                      // non-search providers that omit the field aren't
                      // misclassified as "empty search".
                      const isEmptySearch =
                        stats != null &&
                        stats.searchTotalCount != null &&
                        stats.searchTotalCount === 0 &&
                        (stats.returnedCount ?? 0) === 0 &&
                        (stats.extractedCount ?? 0) === 0 &&
                        totalDropped === 0;
                      return (
                        <div className={`rounded-md border p-4 flex items-start gap-3 ${
                          sourcingLog.status === "completed"
                            ? "border-purple-200 bg-purple-500/5"
                            : "border-destructive/30 bg-destructive/5"
                        }`}>
                          {sourcingLog.status === "completed" ? (
                            <Zap className="h-5 w-5 text-purple-600 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1">
                            <p className="text-sm font-medium">
                              {sourcingLog.status === "completed"
                                ? isEmptySearch
                                  ? "Sourcing complete — no organic results"
                                  : `Sourcing complete — ${output?.saved ?? 0} new candidates generated`
                                : "Sourcing step failed"}
                              {providerName && (
                                <span
                                  className="ml-2 text-xs font-normal text-muted-foreground"
                                  data-testid="sourcing-provider-name"
                                >
                                  via {providerName}
                                </span>
                              )}
                            </p>
                            {sourcingLog.status === "failed" && output?.error && (
                              <p className="text-xs text-destructive mt-1">{output.error}</p>
                            )}
                            {sourcingLog.status === "completed" && !stats && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                All profiles are AI-generated mock candidates and clearly labelled.
                              </p>
                            )}
                            {sourcingLog.status === "completed" && stats && isEmptySearch && (
                              <p className="text-xs text-muted-foreground mt-1">
                                The upstream search returned no organic results for this query.
                                Try widening the job's must-have skills, loosening the location filter,
                                or adjusting your provider's target sites and extra keywords.
                              </p>
                            )}
                            {sourcingLog.status === "completed" && stats && !isEmptySearch && (
                              <div className="mt-2 space-y-1.5">
                                <div className="flex flex-wrap gap-1.5 text-[11px]">
                                  {stats.searchTotalCount != null && (
                                    <Badge variant="outline" className="bg-background">
                                      {stats.searchTotalCount.toLocaleString()} search hits
                                    </Badge>
                                  )}
                                  {stats.consideredCount != null && (
                                    <Badge variant="outline" className="bg-background">
                                      {stats.consideredCount} inspected
                                    </Badge>
                                  )}
                                  {stats.extractedCount != null &&
                                    stats.extractedCount !== stats.consideredCount && (
                                      <Badge variant="outline" className="bg-background">
                                        {stats.extractedCount} extracted
                                      </Badge>
                                    )}
                                  {stats.returnedCount != null && (
                                    <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-200">
                                      {stats.returnedCount} returned
                                    </Badge>
                                  )}
                                  {(stats.droppedNoBio ?? 0) > 0 && (
                                    <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                      {stats.droppedNoBio} dropped: empty bio
                                    </Badge>
                                  )}
                                  {(stats.droppedStale ?? 0) > 0 && (
                                    <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                      {stats.droppedStale} dropped: stale activity
                                    </Badge>
                                  )}
                                  {(stats.droppedNoProfile ?? 0) > 0 && (
                                    <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                      {stats.droppedNoProfile} dropped: no profile URL
                                    </Badge>
                                  )}
                                  {(stats.droppedFabricated ?? 0) > 0 && (
                                    <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                      {stats.droppedFabricated} dropped: fabricated
                                    </Badge>
                                  )}
                                  {(stats.droppedInvalid ?? 0) > 0 && (
                                    <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                      {stats.droppedInvalid} dropped: invalid row
                                    </Badge>
                                  )}
                                  {(stats.droppedFetchError ?? 0) > 0 && (
                                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                                      {stats.droppedFetchError} dropped: fetch error
                                    </Badge>
                                  )}
                                </div>
                                {totalDropped > 0 && (output?.saved ?? 0) === 0 && (
                                  <p className="text-xs text-amber-800">
                                    Quality filters dropped every candidate. Loosen your provider's
                                    quality settings (e.g. “require bio”, “active within”, target sites)
                                    to widen the pool.
                                  </p>
                                )}
                                {totalDropped > 0 && (output?.saved ?? 0) > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    {totalDropped} candidate{totalDropped === 1 ? " was" : "s were"} filtered out by your provider's quality settings.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Past sourcing runs — same filter breakdown as the
                        latest-run panel above, but for historical runs so
                        recruiters can compare which filter was the bottleneck
                        across runs (e.g. did loosening activeWithinMonths help?). */}
                    {(() => {
                      const latestRunId = workflowData.run.id;
                      const pastSourcingRuns = (jobRuns ?? []).filter(
                        (r) => r.id !== latestRunId && r.runSourcing,
                      );
                      if (pastSourcingRuns.length === 0) return null;
                      return (
                        <div>
                          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                            Past Sourcing Runs
                          </h3>
                          <div className="space-y-2">
                            {pastSourcingRuns.map((r) => {
                              const stats = r.sourcingStats ?? null;
                              const status = r.sourcingStatus ?? r.status;
                              const saved = r.sourcingSaved ?? null;
                              const totalDropped =
                                (stats?.droppedNoBio ?? 0) +
                                (stats?.droppedStale ?? 0) +
                                (stats?.droppedFetchError ?? 0) +
                                (stats?.droppedInvalid ?? 0) +
                                (stats?.droppedNoProfile ?? 0) +
                                (stats?.droppedFabricated ?? 0);
                              const isEmptySearch =
                                stats != null &&
                                stats.searchTotalCount != null &&
                                stats.searchTotalCount === 0 &&
                                (stats.returnedCount ?? 0) === 0 &&
                                (stats.extractedCount ?? 0) === 0 &&
                                totalDropped === 0;
                              const date = new Date(r.createdAt).toLocaleString(
                                "en-US",
                                { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
                              );
                              const isVariantRun = !!r.variantOf;
                              const label = r.variantLabel
                                ? r.variantLabel
                                : isVariantRun
                                ? "Variant run"
                                : "Baseline";
                              return (
                                <div
                                  key={r.id}
                                  className={`rounded-md border p-3 ${
                                    status === "failed"
                                      ? "border-destructive/30 bg-destructive/5"
                                      : "border-border bg-muted/20"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <div className="flex items-center gap-2 min-w-0">
                                      {isVariantRun ? (
                                        <GitBranch className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                                      ) : (
                                        <Zap className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                                      )}
                                      <span className="text-xs font-medium truncate">{label}</span>
                                      <span className="text-[11px] text-muted-foreground shrink-0">· {date}</span>
                                      {r.sourcingProviderName && (
                                        <span
                                          className="text-[11px] text-muted-foreground shrink-0"
                                          data-testid={`past-sourcing-provider-${r.id}`}
                                        >
                                          · {r.sourcingProviderName}
                                        </span>
                                      )}
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] capitalize shrink-0 ${
                                        status === "completed"
                                          ? "bg-green-500/10 text-green-700 border-green-200"
                                          : status === "failed"
                                          ? "bg-destructive/10 text-destructive border-destructive/30"
                                          : "bg-muted text-muted-foreground"
                                      }`}
                                    >
                                      {status === "completed" && saved != null
                                        ? `${saved} saved`
                                        : status}
                                    </Badge>
                                  </div>
                                  {status === "failed" && r.sourcingError && (
                                    <p className="text-[11px] text-destructive">{r.sourcingError}</p>
                                  )}
                                  {stats && isEmptySearch ? (
                                    <p className="text-[11px] text-muted-foreground">
                                      No organic results returned for this query.
                                    </p>
                                  ) : stats ? (
                                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                                      {stats.searchTotalCount != null && (
                                        <Badge variant="outline" className="bg-background">
                                          {stats.searchTotalCount.toLocaleString()} search hits
                                        </Badge>
                                      )}
                                      {stats.consideredCount != null && (
                                        <Badge variant="outline" className="bg-background">
                                          {stats.consideredCount} inspected
                                        </Badge>
                                      )}
                                      {stats.extractedCount != null &&
                                        stats.extractedCount !== stats.consideredCount && (
                                          <Badge variant="outline" className="bg-background">
                                            {stats.extractedCount} extracted
                                          </Badge>
                                        )}
                                      {stats.returnedCount != null && (
                                        <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-200">
                                          {stats.returnedCount} returned
                                        </Badge>
                                      )}
                                      {(stats.droppedNoBio ?? 0) > 0 && (
                                        <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                          {stats.droppedNoBio} dropped: empty bio
                                        </Badge>
                                      )}
                                      {(stats.droppedStale ?? 0) > 0 && (
                                        <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                          {stats.droppedStale} dropped: stale activity
                                        </Badge>
                                      )}
                                      {(stats.droppedNoProfile ?? 0) > 0 && (
                                        <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                          {stats.droppedNoProfile} dropped: no profile URL
                                        </Badge>
                                      )}
                                      {(stats.droppedFabricated ?? 0) > 0 && (
                                        <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                          {stats.droppedFabricated} dropped: fabricated
                                        </Badge>
                                      )}
                                      {(stats.droppedInvalid ?? 0) > 0 && (
                                        <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-200">
                                          {stats.droppedInvalid} dropped: invalid row
                                        </Badge>
                                      )}
                                      {(stats.droppedFetchError ?? 0) > 0 && (
                                        <Badge variant="outline" className="bg-muted text-muted-foreground">
                                          {stats.droppedFetchError} dropped: fetch error
                                        </Badge>
                                      )}
                                      {totalDropped > 0 && (saved ?? 0) === 0 && (
                                        <span className="basis-full text-[11px] text-amber-800 mt-0.5">
                                          Quality filters dropped every candidate.
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    status === "completed" && (
                                      <p className="text-[11px] text-muted-foreground">
                                        No filter breakdown reported by this provider.
                                      </p>
                                    )
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Compare any two past sourcing runs side-by-side. Hidden
                        automatically when there aren't at least two sourcing
                        runs to compare. */}
                    <CompareRuns runs={jobRuns ?? []} jobId={jobId} />

                    {/* Job Understanding */}
                    {workflowData.insight && (() => {
                      // Engine writes providerName onto every completed
                      // step's log output so the timeline can label "via X"
                      // without re-resolving provider settings.
                      const log = workflowData.logs?.find(
                        (l: { step: string; status: string; output?: unknown }) =>
                          l.step === "job_understanding" && l.status === "completed",
                      );
                      const providerName = (log?.output as { providerName?: string } | null)?.providerName ?? null;
                      return (
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                          <span>Job Understanding</span>
                          {providerName && (
                            <span
                              className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
                              data-testid="job-understanding-provider-name"
                            >
                              via {providerName}
                            </span>
                          )}
                        </h3>
                        <div className="grid md:grid-cols-2 gap-6">
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Ideal Candidate Profile</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm">{workflowData.insight.idealCandidateProfile}</p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Evaluation Criteria</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <ul className="list-disc pl-4 text-sm space-y-1">
                                {workflowData.insight.evaluationCriteria.map((crit: string, i: number) => (
                                  <li key={i}>{crit}</li>
                                ))}
                              </ul>
                            </CardContent>
                          </Card>
                        </div>
                      </div>
                      );
                    })()}

                    {/* Top Candidates */}
                    {workflowData.shortlist?.summaries && workflowData.shortlist.summaries.length > 0 && (() => {
                      const log = workflowData.logs?.find(
                        (l: { step: string; status: string; output?: unknown }) =>
                          l.step === "shortlist" && l.status === "completed",
                      );
                      const providerName = (log?.output as { providerName?: string } | null)?.providerName ?? null;
                      return (
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                          <span>Top Candidates</span>
                          {providerName && (
                            <span
                              className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
                              data-testid="shortlist-provider-name"
                            >
                              via {providerName}
                            </span>
                          )}
                        </h3>
                        <div className="grid md:grid-cols-3 gap-4">
                          {workflowData.shortlist.summaries.map((summary: { candidateId: number; candidateName: string; whyRelevant: string; keyRisks?: string }) => {
                            const evalData = workflowData.evaluations.find((e: { candidateId: number }) => e.candidateId === summary.candidateId);
                            const isSourced = sourcedCandidates.some((c) => c.id === summary.candidateId);
                            return (
                              <Card key={summary.candidateId} className="flex flex-col">
                                <CardHeader className="pb-2">
                                  <div className="flex justify-between items-start">
                                    <div className="min-w-0">
                                      <CardTitle className="text-base truncate">{summary.candidateName}</CardTitle>
                                      {isSourced && (
                                        <Badge variant="outline" className="mt-1 text-[10px] bg-purple-500/10 text-purple-700 border-purple-200">
                                          <Zap className="h-2.5 w-2.5 mr-1" />AI Sourced
                                        </Badge>
                                      )}
                                    </div>
                                    {evalData && (
                                      <div className="ml-2 shrink-0 flex flex-col items-end gap-1">
                                        <Badge variant="outline" className={`${getScoreColor(evalData.decisionScore ?? evalData.score)}`}>
                                          {evalData.decisionScore ?? evalData.score}
                                        </Badge>
                                        {evalData.confidenceLevel && (
                                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                                            evalData.confidenceLevel === "High" ? "bg-green-500/10 border-green-200 text-green-700" :
                                            evalData.confidenceLevel === "Low" ? "bg-red-500/10 border-red-200 text-red-700" :
                                            "bg-amber-500/10 border-amber-200 text-amber-700"
                                          }`}>
                                            {evalData.confidenceLevel} conf.
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  {evalData && (
                                    <CardDescription>
                                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                        <Badge variant="outline" className={`${getRecommendationColor(evalData.recommendation)}`}>
                                          {evalData.recommendation}
                                        </Badge>
                                        {evalData.fitScore != null && evalData.fitScore !== (evalData.decisionScore ?? evalData.score) && (
                                          <span className="text-[10px] text-muted-foreground">Fit: {evalData.fitScore}</span>
                                        )}
                                        {evalData.requiresEnrichment && (
                                          <Badge variant="outline" className="text-[10px] py-0 h-5 bg-amber-500/10 border-amber-200 text-amber-700">
                                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Enrich
                                          </Badge>
                                        )}
                                      </div>
                                    </CardDescription>
                                  )}
                                </CardHeader>
                                <CardContent className="flex-1 flex flex-col text-sm space-y-3">
                                  <div>
                                    <span className="font-semibold block mb-1">Why Relevant</span>
                                    <p className="text-muted-foreground">{summary.whyRelevant}</p>
                                  </div>
                                  {summary.keyRisks && (
                                    <div>
                                      <span className="font-semibold block mb-1">Key Risks</span>
                                      <p className="text-muted-foreground">{summary.keyRisks}</p>
                                    </div>
                                  )}
                                  <div className="mt-auto pt-4 border-t border-border flex items-center justify-between gap-2">
                                    <CandidateNotesIndicator
                                      candidateId={summary.candidateId}
                                      jobId={jobId}
                                      candidateName={summary.candidateName}
                                      variant="compact"
                                    />
                                    <Link href={`/candidates/${summary.candidateId}`}>
                                      <Button variant="ghost" size="sm">View Profile</Button>
                                    </Link>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })()}

                    {/* All Evaluations Collapsible */}
                    {workflowData.evaluations && workflowData.evaluations.length > 0 && (() => {
                      const log = workflowData.logs?.find(
                        (l: { step: string; status: string; output?: unknown }) =>
                          l.step === "candidate_matching" && l.status === "completed",
                      );
                      const providerName = (log?.output as { providerName?: string } | null)?.providerName ?? null;
                      return (
                      <Collapsible open={isAllEvalsOpen} onOpenChange={setIsAllEvalsOpen} className="border border-border rounded-md">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" className="w-full justify-between p-4 h-auto font-medium hover:bg-muted/50">
                            <span className="flex items-center gap-2">
                              <span>All Evaluations ({workflowData.evaluations.length})</span>
                              {providerName && (
                                <span
                                  className="text-[11px] font-normal text-muted-foreground"
                                  data-testid="candidate-matching-provider-name"
                                >
                                  via {providerName}
                                </span>
                              )}
                            </span>
                            {isAllEvalsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="p-0 border-t border-border">
                          <div className="divide-y divide-border">
                            {workflowData.evaluations.map((ev: {
                              id: number; candidateId: number; score: number;
                              fitScore?: number | null; decisionScore?: number | null; confidenceLevel?: string | null;
                              requiresEnrichment?: boolean | null;
                              recommendation: string;
                              strengths: string[]; gaps: string[];
                              candidate: { name: string; source?: string | null };
                            }) => {
                              const isSourced = ev.candidate?.source === "AI Generated / Mock Sourcing";
                              const displayScore = ev.decisionScore ?? ev.score;
                              const fitScore = ev.fitScore;
                              const confLevel = ev.confidenceLevel;
                              return (
                                <div key={ev.id} className="p-4 flex flex-col md:flex-row gap-4 md:items-center justify-between hover:bg-muted/10">
                                  <div className="min-w-[220px]">
                                    <div className="flex items-center gap-2">
                                      <Link href={`/candidates/${ev.candidateId}`}>
                                        <span className="font-semibold hover:text-primary cursor-pointer">{ev.candidate?.name}</span>
                                      </Link>
                                      {isSourced && (
                                        <Badge variant="outline" className="text-[10px] py-0 h-5 bg-purple-500/10 text-purple-700 border-purple-200">
                                          <Zap className="h-2.5 w-2.5 mr-1" />AI
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                      <Badge variant="outline" className={getRecommendationColor(ev.recommendation)}>
                                        {ev.recommendation}
                                      </Badge>
                                      {confLevel && (
                                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${
                                          confLevel === "High" ? "bg-green-500/10 border-green-200 text-green-700" :
                                          confLevel === "Low" ? "bg-red-500/10 border-red-200 text-red-700" :
                                          "bg-amber-500/10 border-amber-200 text-amber-700"
                                        }`}>
                                          {confLevel}
                                        </span>
                                      )}
                                      {ev.requiresEnrichment && (
                                        <Badge variant="outline" className="text-[9px] py-0 h-5 bg-amber-500/10 border-amber-200 text-amber-700">
                                          <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Enrich recommended
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex-1 w-full max-w-md">
                                    <div className="flex justify-between text-xs mb-1">
                                      <span className="text-muted-foreground">Decision Score</span>
                                      <span className="font-medium">
                                        {displayScore}/100
                                        {fitScore != null && fitScore !== displayScore && (
                                          <span className="text-muted-foreground ml-1">(fit: {fitScore})</span>
                                        )}
                                      </span>
                                    </div>
                                    <Progress value={displayScore} className="h-2" />
                                  </div>
                                  <div className="flex-1 flex gap-2 flex-wrap text-xs">
                                    {ev.strengths.slice(0, 2).map((s, i) => (
                                      <span key={i} className="px-2 py-1 bg-green-500/10 text-green-700 rounded-full border border-green-200/50 truncate max-w-[150px]">+ {s}</span>
                                    ))}
                                    {ev.gaps.slice(0, 1).map((g, i) => (
                                      <span key={i} className="px-2 py-1 bg-red-500/10 text-red-700 rounded-full border border-red-200/50 truncate max-w-[150px]">- {g}</span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                      );
                    })()}

                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* ── GENERATED CANDIDATES ── */}
          {hadSourcingRun && (
            <Collapsible open={isSourcedOpen} onOpenChange={setIsSourcedOpen} className="border border-purple-200 rounded-lg bg-card shadow-sm">
              <div className="p-4 border-b border-purple-200 flex items-center justify-between bg-purple-500/5">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-purple-600" />
                  <h2 className="text-lg font-semibold">Generated Candidates</h2>
                  <Badge variant="outline" className="border-purple-200 text-purple-700 bg-purple-500/10">
                    {sourcedCandidates.length} AI-sourced
                  </Badge>
                </div>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-8 h-8 p-0">
                    {isSourcedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="p-6">
                  <div className="flex items-start gap-2 mb-4 p-3 rounded-md bg-amber-500/5 border border-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      These are AI-generated mock profiles created to demonstrate sourcing capability.
                      All emails, LinkedIn URLs, and GitHub handles are placeholders — verify before outreach.
                    </p>
                  </div>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {sourcedCandidates.map((c) => (
                      <SourcedCandidateCard key={c.id} candidate={c} />
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* ── PIPELINE BOARD ── */}
          <div className="flex-1 overflow-x-auto pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Pipeline</h2>
                <RealSourcingPill hasRealSourcingProvider={job.hasRealSourcingProvider} />
                {filteredCandidateIds.length > 0 && (
                  <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                    <Checkbox
                      checked={headerCheckedState}
                      onCheckedChange={togglePipelineHeader}
                      aria-label="Select all visible pipeline candidates"
                      data-testid="select-all-pipeline"
                    />
                    <span>
                      {headerCheckedState === true
                        ? `All ${filteredCandidateIds.length} selected`
                        : selectedCandidateIds.size > 0
                          ? `${selectedCandidateIds.size} selected`
                          : `Select all visible (${filteredCandidateIds.length})`}
                    </span>
                  </label>
                )}
              </div>
              {(applications?.length ?? 0) > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <EmailStatusFilter
                    value={emailFilter}
                    onChange={setEmailFilter}
                    counts={emailCounts}
                  />
                  <EmailSourceFilter
                    selected={selectedSources}
                    onChange={setSelectedSources}
                    availableSources={availableSources}
                  />
                </div>
              )}
            </div>
            {applications?.length === 0 && (
              <div className="border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center mb-4">
                <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Users className="h-7 w-7 text-muted-foreground/60" />
                </div>
                <h3 className="text-lg font-semibold mb-1">No candidates yet</h3>
                <p className="text-sm text-muted-foreground mb-5 max-w-sm">
                  Add candidates to start building your pipeline. The AI workflow will score and rank them automatically.
                </p>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setIsImportOpen(true)}>
                    <Upload className="mr-2 h-4 w-4" />
                    Add Candidates
                  </Button>
                  <Button variant="outline" onClick={() => setIsFindOpen(true)}>
                    <Bot className="mr-2 h-4 w-4" />
                    Find with AI
                  </Button>
                </div>
              </div>
            )}
            <div className="h-full min-w-max flex gap-4">
              {stages.map((stage) => {
                const appsInStage = emailFilteredApplications?.filter((app) => app.stage === stage) || [];
                return (
                  <div key={stage} className="flex-shrink-0 w-80 flex flex-col bg-muted/30 rounded-lg border border-border overflow-hidden">
                    <div className="p-3 border-b border-border bg-muted/50 font-medium flex justify-between items-center">
                      <span>{stage}</span>
                      <Badge variant="secondary">{appsInStage.length}</Badge>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {appsInStage.map((app) => {
                        const evalData = workflowData?.evaluations?.find((e: { candidateId: number }) => e.candidateId === app.candidate.id);
                        const isSourced = app.candidate.source === "AI Generated / Mock Sourcing" || app.candidate.source === "Mock";
                        const enrichmentStatus = app.candidate.enrichmentStatus ?? null;
                        const isLinkedInImport = app.candidate.source === "LinkedIn Paste";
                        const showNotEnriched =
                          !enrichmentStatus &&
                          (isLinkedInImport || !app.candidate.summary || (app.candidate.skills?.length ?? 0) === 0);
                        return (
                          <div key={app.id} className={`bg-card border rounded-md p-4 shadow-sm hover:border-primary/50 transition-colors ${
                            isSourced ? "border-purple-200" : "border-border"
                          } ${selectedCandidateIds.has(app.candidate.id) ? "ring-2 ring-primary/60 bg-primary/5" : ""}`}>
                            <div className="flex justify-between items-start mb-1">
                              <div className="min-w-0 flex items-start gap-2">
                                <Checkbox
                                  className="mt-1 shrink-0"
                                  checked={selectedCandidateIds.has(app.candidate.id)}
                                  onCheckedChange={() => togglePipelineRow(app.candidate.id)}
                                  aria-label={`Select ${app.candidate.name}`}
                                  data-testid={`select-pipeline-candidate-${app.candidate.id}`}
                                />
                                <div className="min-w-0">
                                <Link href={`/candidates/${app.candidate.id}`}>
                                  <div className="font-medium hover:text-primary transition-colors cursor-pointer truncate">
                                    {app.candidate.name}
                                  </div>
                                </Link>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {isSourced && (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 bg-purple-500/10 text-purple-700 border-purple-200">
                                      <Zap className="h-2.5 w-2.5 mr-1" />AI Sourced
                                    </Badge>
                                  )}
                                  {enrichmentStatus === "enriched" && (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 bg-blue-500/10 text-blue-700 border-blue-200">
                                      <Sparkles className="h-2.5 w-2.5 mr-1" />Enriched
                                    </Badge>
                                  )}
                                  {enrichmentStatus === "partial" && (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 bg-amber-500/10 text-amber-700 border-amber-200">
                                      <Sparkles className="h-2.5 w-2.5 mr-1" />Partial
                                    </Badge>
                                  )}
                                  {enrichmentStatus === "failed" && (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 bg-red-500/10 text-red-700 border-red-200">
                                      <Sparkles className="h-2.5 w-2.5 mr-1" />Enrichment failed
                                    </Badge>
                                  )}
                                  {showNotEnriched && (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 bg-muted text-muted-foreground border-border">
                                      <Sparkles className="h-2.5 w-2.5 mr-1" />Not enriched
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              </div>
                              {evalData && (
                                <Badge variant="outline" className={`ml-2 shrink-0 ${getScoreColor(evalData.score)}`}>
                                  {evalData.score}
                                </Badge>
                              )}
                            </div>
                            
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1 min-w-0">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{app.candidate.email}</span>
                              <EmailSourceBadge source={app.candidate.emailSource} className="shrink-0" />
                            </div>
                            <div className="mb-2">
                              <EmailValidationBadge
                                status={app.candidate.emailValidationStatus}
                                reason={app.candidate.emailValidationReason}
                              />
                            </div>
                            
                            {evalData && (
                              <div className="mb-3 flex flex-wrap gap-1">
                                <Badge variant="outline" className={`text-[10px] py-0 h-5 ${getRecommendationColor(evalData.recommendation)}`}>
                                  {evalData.recommendation}
                                </Badge>
                                {evalData.requiresEnrichment && (
                                  <Badge variant="outline" className="text-[10px] py-0 h-5 bg-amber-500/10 border-amber-200 text-amber-700">
                                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />Enrich recommended
                                  </Badge>
                                )}
                              </div>
                            )}
                            
                            <div className="flex justify-between items-center mt-2 border-t border-border pt-3">
                              <Link href={`/candidates/${app.candidate.id}`}>
                                <Button variant="ghost" size="sm" className="h-7 text-xs px-2">
                                  <User className="mr-1 h-3 w-3" />
                                  Profile
                                </Button>
                              </Link>
                              
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 text-xs px-2">
                                    Move <ArrowRight className="ml-1 h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {stages.filter(s => s !== stage).map((s) => (
                                    <DropdownMenuItem key={s} onClick={() => handleStageChange(app.id, s)}>
                                      Move to {s}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        );
                      })}
                      {appsInStage.length === 0 && (
                        <div className="text-center py-8 text-sm text-muted-foreground italic border-2 border-dashed border-border rounded-md bg-card/50">
                          Empty
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {job && isVariantModalOpen && workflowData?.run && (
        <RunVariantModal
          open={isVariantModalOpen}
          onOpenChange={setIsVariantModalOpen}
          jobId={jobId}
          baseRunId={workflowData.run.id}
          defaultSeniority={job.seniority}
          defaultSkills={job.mustHaveSkills ?? []}
          onSubmit={handleRunVariant}
          isSubmitting={runVariantWorkflow.isPending}
        />
      )}

      {job && (
        <ImportCandidatesModal
          open={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          jobId={jobId}
          jobTitle={job.title}
          onImported={({ created }) => {
            queryClient.invalidateQueries({ queryKey: getGetJobApplicationsQueryKey(jobId) });
            if (created > 0) {
              setDataMode("real");
              setHighlightStep2(true);
              setTimeout(() => setHighlightStep2(false), 3000);
              toast({
                title: `${created} candidate${created !== 1 ? "s" : ""} added`,
                description: "Pipeline refreshed. Run the AI workflow to score them.",
              });
            }
          }}
          onRunRequested={() => {
            setDataMode("real");
            setHighlightStep2(true);
            setTimeout(() => setHighlightStep2(false), 3000);
          }}
        />
      )}

      <ImproveRerunModal
        open={isImproveModalOpen}
        onOpenChange={setIsImproveModalOpen}
        candidates={lowConfidenceCandidates}
        onConfirm={handleImproveAndRerun}
        isSubmitting={improveAndRerun.isPending}
      />

      <BulkActionBar
        jobId={jobId}
        selectedIds={Array.from(selectedCandidateIds)}
        onClear={() => setSelectedCandidateIds(new Set())}
        onAfterChange={() => {
          queryClient.invalidateQueries({ queryKey: getGetJobApplicationsQueryKey(jobId) });
        }}
      />

      {job && (
        <FindCandidatesModal
          open={isFindOpen}
          onOpenChange={setIsFindOpen}
          jobId={jobId}
          jobTitle={job.title}
          jobSeniority={job.seniority}
          jobLocation={job.location}
          onFound={({ created }) => {
            queryClient.invalidateQueries({ queryKey: getGetJobApplicationsQueryKey(jobId) });
            if (created > 0) {
              toast({
                title: `${created} candidate${created !== 1 ? "s" : ""} sourced`,
                description: "They've been added to your pipeline. Run the AI workflow to score them.",
              });
            }
          }}
        />
      )}
    </div>
  );
}
