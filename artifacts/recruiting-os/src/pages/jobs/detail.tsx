import { useState, useEffect } from "react";
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
  getListJobRunsQueryKey,
} from "@workspace/api-client-react";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Loader2, MapPin, Edit, User, Mail, ArrowRight, Play,
  Sparkles, ChevronDown, ChevronUp, ChevronRight, BrainCircuit, Zap,
  Building2, Github, Linkedin, AlertTriangle, FileText, GitBranch,
  FlaskConical, Database, Upload, Bot, Users,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { RunVariantModal } from "@/components/run-variant-modal";
import { addPendingImproveRun, markJobRunsSeen } from "@/lib/pending-runs";
import { ImportCandidatesModal } from "@/components/import-candidates-modal";
import { FindCandidatesModal } from "@/components/find-candidates-modal";
import { ImproveRerunModal, type ImproveRerunCandidate } from "@/components/improve-rerun-modal";
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
import { EmailSourceBadge } from "@/components/email-source-badge";

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

// ── main page ─────────────────────────────────────────────────────────────────

export default function JobDetailPage() {
  const [, params] = useRoute("/jobs/:id");
  const jobId = parseInt(params?.id || "0", 10);

  const { data: job, isLoading: isLoadingJob } = useGetJob(jobId, {
    query: { enabled: !!jobId, queryKey: [`/api/jobs/${jobId}`] },
  });

  const { data: applications, isLoading: isLoadingApps } = useGetJobApplications(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobApplicationsQueryKey(jobId) },
  });

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

  const runWorkflow = useRunWorkflow();
  const runVariantWorkflow = useRunVariantWorkflow();
  const improveAndRerun = useImproveAndRerun();
  const updateApp = useUpdateApplication();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (jobId) markJobRunsSeen(jobId);
  }, [jobId]);

  const [isInsightsOpen, setIsInsightsOpen] = useState(true);
  const [isAllEvalsOpen, setIsAllEvalsOpen] = useState(false);
  const [isSourcedOpen, setIsSourcedOpen] = useState(true);
  const [dataMode, setDataMode] = useState<"real" | "mock">("mock");
  const [runSourcing, setRunSourcing] = useState(false);
  const [runEnrichment, setRunEnrichment] = useState(false);
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [highlightStep2, setHighlightStep2] = useState(false);
  const [isImproveModalOpen, setIsImproveModalOpen] = useState(false);

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
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" />
                {job.location}
              </span>
              <Badge variant="secondary">{job.seniority}</Badge>
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
                {/* Data mode */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={workflowRunning}
                    onClick={() => setDataMode("mock")}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-all ${
                      dataMode === "mock"
                        ? "border-amber-300 bg-amber-500/8 ring-1 ring-amber-300"
                        : "border-border bg-muted/20 hover:bg-muted/40"
                    }`}
                  >
                    <FlaskConical className={`h-3.5 w-3.5 shrink-0 ${dataMode === "mock" ? "text-amber-600" : "text-muted-foreground"}`} />
                    <div>
                      <p className={`text-xs font-medium leading-tight ${dataMode === "mock" ? "text-amber-800" : ""}`}>Demo Run</p>
                      <p className="text-[10px] text-muted-foreground">Simulated candidates</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={workflowRunning}
                    onClick={() => setDataMode("real")}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-all ${
                      dataMode === "real"
                        ? "border-green-300 bg-green-500/8 ring-1 ring-green-300"
                        : "border-border bg-muted/20 hover:bg-muted/40"
                    }`}
                  >
                    <Database className={`h-3.5 w-3.5 shrink-0 ${dataMode === "real" ? "text-green-700" : "text-muted-foreground"}`} />
                    <div>
                      <p className={`text-xs font-medium leading-tight ${dataMode === "real" ? "text-green-800" : ""}`}>Real Data Run</p>
                      <p className="text-[10px] text-muted-foreground">Imported + Twin only</p>
                    </div>
                  </button>
                </div>
                {dataMode === "real" && (
                  <p className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    Only imported and Twin-sourced candidates will be scored.
                  </p>
                )}
                {/* Sourcing */}
                <div className={`flex items-start gap-2 px-2.5 py-2 rounded-md border transition-colors ${
                  runSourcing
                    ? dataMode === "real" ? "border-green-200 bg-green-500/5" : "border-purple-200 bg-purple-500/5"
                    : "border-border bg-muted/30"
                }`}>
                  <Checkbox id="run-sourcing" checked={runSourcing} onCheckedChange={(v) => setRunSourcing(!!v)} disabled={workflowRunning} className="mt-0.5" />
                  <div>
                    <Label htmlFor="run-sourcing" className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                      <Zap className={`h-3 w-3 ${dataMode === "real" ? "text-green-700" : "text-purple-600"}`} />
                      {dataMode === "real" ? "Source via Twin provider" : "Generate mock candidates before matching"}
                    </Label>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {dataMode === "real" ? "Requires Twin webhook in Advanced settings" : "7 mock candidates tailored to this role"}
                    </p>
                  </div>
                </div>
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
                      Run the AI workflow — we'll read every profile and rank them against this role across 3 HiringAI dimensions: autonomy, product mindset and impact.
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

                    {/* Sourcing step status */}
                    {workflowData.run.runSourcing && (() => {
                      const sourcingLog = workflowData.logs?.find((l: { step: string; status: string; output?: unknown }) => l.step === "sourcing");
                      if (!sourcingLog) return null;
                      type SourcingStats = {
                        searchTotalCount?: number;
                        consideredCount?: number;
                        droppedNoBio?: number;
                        droppedStale?: number;
                        droppedFetchError?: number;
                        returnedCount?: number;
                      };
                      const output = sourcingLog.output as {
                        generated?: number;
                        saved?: number;
                        error?: string;
                        stats?: SourcingStats | null;
                      } | null;
                      const stats = output?.stats ?? null;
                      const totalDropped =
                        (stats?.droppedNoBio ?? 0) +
                        (stats?.droppedStale ?? 0) +
                        (stats?.droppedFetchError ?? 0);
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
                                ? `Sourcing complete — ${output?.saved ?? 0} new candidates generated`
                                : "Sourcing step failed"}
                            </p>
                            {sourcingLog.status === "failed" && output?.error && (
                              <p className="text-xs text-destructive mt-1">{output.error}</p>
                            )}
                            {sourcingLog.status === "completed" && !stats && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                All profiles are AI-generated mock candidates and clearly labelled.
                              </p>
                            )}
                            {sourcingLog.status === "completed" && stats && (
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
                                  {(stats.droppedFetchError ?? 0) > 0 && (
                                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                                      {stats.droppedFetchError} dropped: fetch error
                                    </Badge>
                                  )}
                                </div>
                                {totalDropped > 0 && (output?.saved ?? 0) === 0 && (
                                  <p className="text-xs text-amber-800">
                                    Quality filters dropped every candidate. Loosen the “require bio” or
                                    “active within” settings on the GitHub provider to widen the pool.
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

                    {/* Job Understanding */}
                    {workflowData.insight && (
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Job Understanding</h3>
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
                    )}

                    {/* Top Candidates */}
                    {workflowData.shortlist?.summaries && workflowData.shortlist.summaries.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Top Candidates</h3>
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
                    )}

                    {/* All Evaluations Collapsible */}
                    {workflowData.evaluations && workflowData.evaluations.length > 0 && (
                      <Collapsible open={isAllEvalsOpen} onOpenChange={setIsAllEvalsOpen} className="border border-border rounded-md">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" className="w-full justify-between p-4 h-auto font-medium hover:bg-muted/50">
                            All Evaluations ({workflowData.evaluations.length})
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
                    )}

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
            <h2 className="text-lg font-semibold mb-4">Pipeline</h2>
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
                const appsInStage = applications?.filter((app) => app.stage === stage) || [];
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
                          }`}>
                            <div className="flex justify-between items-start mb-1">
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
                              {evalData && (
                                <Badge variant="outline" className={`ml-2 shrink-0 ${getScoreColor(evalData.score)}`}>
                                  {evalData.score}
                                </Badge>
                              )}
                            </div>
                            
                            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mb-2 min-w-0">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{app.candidate.email}</span>
                              <EmailSourceBadge source={app.candidate.emailSource} className="shrink-0" />
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
