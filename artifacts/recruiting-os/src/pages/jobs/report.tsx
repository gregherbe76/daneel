import { useState, useMemo, useEffect } from "react";
import { useRoute, Link, useLocation, useSearch } from "wouter";
import { useGetJob, useListJobRuns, useImproveAndRerun, getListJobRunsQueryKey } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Download, FileText, FileDown, Loader2, MapPin,
  Star, AlertTriangle, MessageSquare, Users, Zap, TrendingUp,
  CheckCircle2, XCircle, MinusCircle, ChevronRight, GitBranch,
  ArrowUp, ArrowDown, Minus, Info, FlaskConical, Database, ShieldAlert,
  ClipboardList, CalendarClock, Sparkles, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { HumanAIComparison } from "@/components/human-ai-comparison";
import { ScoreBreakdownDisplay, ScoreBreakdownPills } from "@/components/score-breakdown";
import type { ScoreBreakdown } from "@/components/score-breakdown";

// ── types (derived from API response) ────────────────────────────────────────

type VariantCriteria = {
  seniority?: string | null;
  mustHaveSkills?: string[] | null;
  focusNote?: string | null;
};

type DataMode = "real" | "mock" | "fallback";

type ReportRunMeta = {
  id: number;
  runDate: string;
  status: string;
  dataMode: DataMode;
  runSourcing: boolean;
  variantOf?: number | null;
  variantLabel?: string | null;
  variantCriteria?: VariantCriteria | null;
};

type ReportCandidate = {
  id: number;
  name: string;
  email: string;
  headline?: string | null;
  location?: string | null;
  currentCompany?: string | null;
  skills: string[];
  source?: string | null;
};

type ReportEvaluation = {
  id: number;
  candidateId: number;
  score: number;
  fitScore?: number | null;
  dataConfidenceScore?: number | null;
  decisionScore?: number | null;
  confidenceLevel?: string | null;
  confidenceReason?: string | null;
  missingDataWarnings?: string[];
  requiresEnrichment?: boolean | null;
  strengths: string[];
  gaps: string[];
  risks: string[];
  recommendation: string;
  scoreBreakdown?: ScoreBreakdown | null;
  candidate: ReportCandidate | null;
  summary: { candidateId: number; whyRelevant: string; keyRisks: string; finalRecommendation: string } | null;
  clientFitNarrative?: string | null;
};

type JobInsight = {
  mustHaveSkills: string[];
  seniority: string;
  evaluationCriteria: string[];
  idealCandidateProfile: string;
};

type HiringReport = {
  generatedAt: string;
  run: ReportRunMeta;
  job: { id: number; title: string; description: string; location: string; seniority: string; mustHaveSkills: string[] };
  insight: JobInsight | null;
  top5: ReportEvaluation[];
  evaluations: ReportEvaluation[];
  recommendationSummary: { "Strong Yes": number; Yes: number; Maybe: number; No: number };
  interviewFocusAreas: string[];
  risks: string[];
};

// ── helpers ───────────────────────────────────────────────────────────────────

const scoreColor = (score: number) => {
  if (score >= 80) return "text-green-700";
  if (score >= 60) return "text-amber-700";
  return "text-red-700";
};

const scoreBg = (score: number) => {
  if (score >= 80) return "bg-green-500/10 border-green-200 text-green-700";
  if (score >= 60) return "bg-amber-500/10 border-amber-200 text-amber-700";
  return "bg-red-500/10 border-red-200 text-red-700";
};

const recBg = (rec: string) => {
  if (rec === "Strong Yes") return "bg-green-500/10 border-green-200 text-green-700";
  if (rec === "Yes") return "bg-emerald-500/10 border-emerald-200 text-emerald-700";
  if (rec === "Maybe") return "bg-amber-500/10 border-amber-200 text-amber-700";
  return "bg-red-500/10 border-red-200 text-red-700";
};

const RecIcon = ({ rec }: { rec: string }) => {
  if (rec === "Strong Yes" || rec === "Yes") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (rec === "Maybe") return <MinusCircle className="h-4 w-4 text-amber-600" />;
  return <XCircle className="h-4 w-4 text-red-600" />;
};

const confidenceBg = (level?: string | null) => {
  if (level === "High") return "bg-green-500/10 border-green-200 text-green-700";
  if (level === "Low") return "bg-red-500/10 border-red-200 text-red-700";
  return "bg-amber-500/10 border-amber-200 text-amber-700";
};

// ── Action label logic ────────────────────────────────────────────────────────

type ActionLabel = "Interview now" | "Review manually" | "Enrich before deciding" | "Reject / low priority";

function getActionLabel(e: ReportEvaluation): ActionLabel {
  const decisionScore = e.decisionScore ?? e.score;
  const fitScore = e.fitScore ?? decisionScore;
  const conf = e.confidenceLevel;
  // Data quality gates take priority — can't decide on sparse profiles
  if (e.requiresEnrichment || (fitScore >= 60 && conf === "Low")) return "Enrich before deciding";
  // Strong, verifiable match
  if (decisionScore >= 70 && conf === "High") return "Interview now";
  // Below threshold
  if (decisionScore < 50) return "Reject / low priority";
  // Middle ground — human review needed
  return "Review manually";
}

const ACTION_CONFIG: Record<ActionLabel, { bg: string; border: string; text: string; dot: string; darkText: string }> = {
  "Interview now":          { bg: "bg-green-500/10",  border: "border-green-300",  text: "text-green-800",  dot: "bg-green-500",  darkText: "text-green-400" },
  "Review manually":        { bg: "bg-blue-500/10",   border: "border-blue-300",   text: "text-blue-800",   dot: "bg-blue-500",   darkText: "text-blue-400" },
  "Enrich before deciding": { bg: "bg-amber-500/10",  border: "border-amber-300",  text: "text-amber-800",  dot: "bg-amber-400",  darkText: "text-amber-400" },
  "Reject / low priority":  { bg: "bg-slate-100",     border: "border-slate-300",  text: "text-slate-600",  dot: "bg-slate-400",  darkText: "text-slate-500" },
};

// ── Comparison diff helpers ────────────────────────────────────────────────────

type CandidateDiff = ReportEvaluation & {
  currentRank: number;
  baseRank: number | null;
  scoreDelta: number | null;
  rankDelta: number | null;
  recChanged: boolean;
  baseRec: string | null;
};

function buildDiff(currentReport: HiringReport, baseReport: HiringReport): CandidateDiff[] {
  const baseRankMap = new Map(
    baseReport.evaluations.map((e, i) => [e.candidateId, { rank: i + 1, score: e.score, rec: e.recommendation }]),
  );
  return currentReport.evaluations.map((e, i) => {
    const base = baseRankMap.get(e.candidateId);
    return {
      ...e,
      currentRank: i + 1,
      baseRank: base?.rank ?? null,
      scoreDelta: base !== undefined ? e.score - base.score : null,
      rankDelta: base !== undefined ? base.rank - (i + 1) : null,
      recChanged: !!base && base.rec !== e.recommendation,
      baseRec: base?.rec ?? null,
    };
  });
}

function DeltaBadge({ delta, type }: { delta: number | null; type: "rank" | "score" }) {
  if (delta === null) return <span className="text-xs text-muted-foreground">new</span>;
  if (delta === 0) return <Minus className="h-3 w-3 text-muted-foreground" />;
  const isPositive = delta > 0;
  const Icon = isPositive ? ArrowUp : ArrowDown;
  const color = isPositive ? "text-green-600" : "text-red-600";
  const label = type === "rank" ? `${Math.abs(delta)}` : `${isPositive ? "+" : ""}${delta}`;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ── CandidateActionButton ─────────────────────────────────────────────────────

function CandidateActionButton({
  evaluation,
  jobId,
  state,
  onExecute,
  compact = false,
  dark = false,
}: {
  evaluation: ReportEvaluation;
  jobId: number;
  state: "idle" | "loading" | "done" | "error";
  onExecute: (id: number, name: string, action: ActionLabel) => void;
  compact?: boolean;
  dark?: boolean;
}) {
  const action = getActionLabel(evaluation);
  const name = evaluation.candidate?.name ?? "Unknown";

  if (state === "done") {
    return (
      <span className={`flex items-center gap-1 text-xs font-medium ${dark ? "text-green-400" : "text-green-600"}`}>
        <CheckCircle2 className="h-3 w-3" />
        Done
      </span>
    );
  }

  if (action === "Review manually") {
    return (
      <Link href={`/candidates/${evaluation.candidateId}`}>
        <Button
          size="sm"
          variant="outline"
          className={`gap-1.5 font-medium ${compact ? "h-6 text-[11px] px-2.5" : "h-7 text-xs px-3"} ${
            dark
              ? "bg-transparent border-blue-500/40 text-blue-300 hover:bg-blue-500/10"
              : "text-blue-700 border-blue-200 hover:bg-blue-50"
          }`}
        >
          <ExternalLink className="h-3 w-3" />
          {compact ? name : "View Profile →"}
        </Button>
      </Link>
    );
  }

  const actionCfg = {
    "Interview now": {
      icon: CalendarClock,
      label: compact ? name : "Move to Interview",
      lightCls: "bg-green-600 hover:bg-green-700 text-white border-0",
      darkCls: "bg-transparent border-green-500/40 text-green-300 hover:bg-green-500/10",
    },
    "Enrich before deciding": {
      icon: Sparkles,
      label: compact ? name : "Trigger Enrichment",
      lightCls: "bg-amber-500 hover:bg-amber-600 text-white border-0",
      darkCls: "bg-transparent border-amber-500/40 text-amber-300 hover:bg-amber-500/10",
    },
    "Reject / low priority": {
      icon: MinusCircle,
      label: compact ? name : "Deprioritize",
      lightCls: "text-slate-500 border-slate-300 hover:bg-slate-50",
      darkCls: "bg-transparent border-slate-600 text-slate-400 hover:bg-slate-700/50",
    },
  }[action as "Interview now" | "Enrich before deciding" | "Reject / low priority"];

  if (!actionCfg) return null;
  const Icon = actionCfg.icon;
  const isLoading = state === "loading";

  return (
    <Button
      size="sm"
      variant="outline"
      className={`gap-1.5 font-medium ${compact ? "h-6 text-[11px] px-2.5" : "h-7 text-xs px-3"} ${
        dark ? actionCfg.darkCls : actionCfg.lightCls
      }`}
      disabled={isLoading}
      onClick={() => onExecute(evaluation.candidateId, name, action)}
    >
      {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {actionCfg.label}
    </Button>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function JobReportPage() {
  const [, params] = useRoute("/jobs/:id/report");
  const jobId = parseInt(params?.id || "0", 10);
  const search = useSearch();
  const queryRunId = useMemo(() => {
    const parsed = new URLSearchParams(search);
    const v = parsed.get("runId");
    return v ? parseInt(v, 10) : null;
  }, [search]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(queryRunId);

  useEffect(() => {
    if (queryRunId !== null) setSelectedRunId(queryRunId);
  }, [queryRunId]);

  const { data: job } = useGetJob(jobId, {
    query: { enabled: !!jobId, queryKey: [`/api/jobs/${jobId}`] },
  });

  const { data: allRuns } = useListJobRuns(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobRunsQueryKey(jobId) },
  });

  const { data: report, isLoading, error } = useQuery<HiringReport>({
    queryKey: selectedRunId ? ["report", jobId, selectedRunId] : ["report", jobId, "latest"],
    queryFn: async () => {
      const url = selectedRunId
        ? `/api/reports/job/${jobId}/run/${selectedRunId}`
        : `/api/reports/job/${jobId}/latest`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("No completed workflow run found");
      return res.json();
    },
    enabled: !!jobId,
  });

  const baseRunId = report?.run?.variantOf ?? null;

  const { data: baseReport } = useQuery<HiringReport>({
    queryKey: ["report", jobId, baseRunId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/job/${jobId}/run/${baseRunId}`);
      if (!res.ok) throw new Error("Base run not found");
      return res.json();
    },
    enabled: !!jobId && !!baseRunId,
  });

  const diff = useMemo(() => {
    if (!report || !baseReport) return null;
    return buildDiff(report, baseReport);
  }, [report, baseReport]);

  const actionGroups = useMemo(() => {
    if (!report) return null;
    const groups: Record<ActionLabel, ReportEvaluation[]> = {
      "Interview now": [],
      "Review manually": [],
      "Enrich before deciding": [],
      "Reject / low priority": [],
    };
    report.evaluations.forEach((e) => {
      groups[getActionLabel(e)].push(e);
    });
    return groups;
  }, [report]);

  const [actionState, setActionState] = useState<Record<number, "idle" | "loading" | "done" | "error">>({});
  const [, navigate] = useLocation();
  const improveAndRerun = useImproveAndRerun();

  const executeAction = async (candidateId: number, candidateName: string, action: ActionLabel) => {
    if (action === "Review manually") return;
    const apiAction =
      action === "Interview now" ? "interview"
      : action === "Enrich before deciding" ? "enrich"
      : "deprioritize";
    setActionState((prev) => ({ ...prev, [candidateId]: "loading" }));
    try {
      const res = await fetch(`/api/reports/job/${jobId}/candidate/${candidateId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: apiAction }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json() as { ok: boolean; enriched?: boolean; message?: string };
      setActionState((prev) => ({ ...prev, [candidateId]: "done" }));
      if (apiAction === "interview") {
        toast.success("Moved to Interview", { description: `${candidateName} is now queued for interview scheduling` });
      } else if (apiAction === "deprioritize") {
        toast("Deprioritized", { description: `${candidateName} moved to Rejected` });
      } else if (apiAction === "enrich") {
        if (data.ok && data.enriched) {
          toast.success("Profile enriched", { description: `${candidateName}'s profile has been updated` });
        } else {
          toast("Enrichment queued", { description: data.message ?? `${candidateName} will be enriched on the next run` });
        }
      }
    } catch (err) {
      setActionState((prev) => ({ ...prev, [candidateId]: "error" }));
      toast.error("Action failed", { description: String(err) });
    }
  };

  const handleImproveAndRerun = () => {
    const runId = report?.run?.id;
    if (!runId) return;
    improveAndRerun.mutate(
      { data: { runId } },
      {
        onSuccess: (result) => {
          toast.success("Improve and Rerun started", {
            description: `Enriching ${result.lowConfidenceCandidateCount} low-confidence profile${result.lowConfidenceCandidateCount === 1 ? "" : "s"} and re-scoring…`,
          });
          const newRunId = result.run.id;
          const baseRunId = runId;
          const poll = setInterval(async () => {
            const res = await fetch(`/api/workflows/runs/${newRunId}`);
            if (!res.ok) return;
            const run = await res.json() as { status: string };
            if (run.status === "completed" || run.status === "failed") {
              clearInterval(poll);
              if (run.status === "completed") {
                setSelectedRunId(newRunId);
                navigate(`/jobs/${jobId}/report`);
                toast.success("Improvement complete", {
                  description: "Showing improved run — comparing scores vs. previous run",
                });
              } else {
                toast.error("Improve and Rerun failed");
              }
            }
          }, 3000);
        },
        onError: () => {
          toast.error("Failed to start Improve and Rerun");
        },
      }
    );
  };

  const handleDownload = (type: "markdown" | "pdf") => {
    window.open(`/api/reports/job/${jobId}/latest/${type}`, "_blank");
  };

  const isVariant = !!report?.run?.variantOf;
  const isImprovedRun = report?.run?.variantLabel === "Improved Run";
  const vc = report?.run?.variantCriteria;

  const lowConfidenceCount = report
    ? report.evaluations.filter(
        (e) =>
          e.confidenceLevel === "Low" ||
          (e.dataConfidenceScore !== null && e.dataConfidenceScore !== undefined && e.dataConfidenceScore < 50) ||
          e.requiresEnrichment === true,
      ).length
    : 0;

  const completedRuns = (allRuns ?? []).filter((r) => r.status === "completed");

  // ── empty / loading states ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-48 mb-6" />
        <Skeleton className="h-32 w-full mb-4" />
        <Skeleton className="h-64 w-full mb-4" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <Link href={`/jobs/${jobId}`}>
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Job
          </Button>
        </Link>
        <div className="border-2 border-dashed border-border rounded-xl p-16 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
          <h2 className="text-xl font-semibold mb-2">No Report Available</h2>
          <p className="text-muted-foreground mb-6">
            Run the AI workflow on this client mission to generate a client shortlist report.
          </p>
          <Link href={`/jobs/${jobId}`}>
            <Button>Go to Client Mission & Run Workflow</Button>
          </Link>
        </div>
      </div>
    );
  }

  const { run, insight, top5, evaluations, recommendationSummary, interviewFocusAreas, risks, generatedAt } = report;
  const totalEvaluated = evaluations.length;

  // ── full report ───────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-auto bg-background">
      {/* ── Top Bar ── */}
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/jobs/${jobId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
          </Link>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{report.job.title}</span>
          <Badge variant="outline" className="text-xs shrink-0">Client Shortlist Report</Badge>
          {run.dataMode === "real" && (
            <Badge variant="outline" className="border-green-300 text-green-700 bg-green-500/8 text-xs shrink-0">
              <Database className="h-3 w-3 mr-1" />Real Data Run
            </Badge>
          )}
          {run.dataMode === "mock" && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-500/8 text-xs shrink-0">
              <FlaskConical className="h-3 w-3 mr-1" />Demo Run
            </Badge>
          )}
          {run.dataMode === "fallback" && (
            <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-500/8 text-xs shrink-0">
              <ShieldAlert className="h-3 w-3 mr-1" />Fallback Mode
            </Badge>
          )}
          {run.runSourcing && (
            <Badge variant="outline" className="border-purple-200 text-purple-700 bg-purple-500/5 text-xs shrink-0">
              <Zap className="h-3 w-3 mr-1" />Sourcing
            </Badge>
          )}
          {isVariant && (
            <Badge variant="outline" className="border-indigo-200 text-indigo-700 bg-indigo-500/5 text-xs shrink-0">
              <GitBranch className="h-3 w-3 mr-1" />
              {run.variantLabel ?? "Variant"}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Improve and Rerun button */}
          {lowConfidenceCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 text-amber-800 hover:bg-amber-50 gap-1.5"
              disabled={improveAndRerun.isPending}
              onClick={handleImproveAndRerun}
            >
              {improveAndRerun.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {improveAndRerun.isPending
                ? "Improving…"
                : `Improve and Rerun — ${lowConfidenceCount} low-confidence`}
            </Button>
          )}
          {/* Run switcher */}
          {completedRuns.length > 1 && (
            <Select
              value={selectedRunId !== null ? String(selectedRunId) : String(report.run.id)}
              onValueChange={(v) => setSelectedRunId(Number(v))}
            >
              <SelectTrigger className="h-8 text-xs w-52">
                <SelectValue placeholder="Select run" />
              </SelectTrigger>
              <SelectContent>
                {completedRuns.map((r) => {
                  const isVariantRun = !!r.variantOf;
                  const label = r.variantLabel
                    ? r.variantLabel
                    : isVariantRun
                    ? "Variant run"
                    : "Baseline";
                  const date = new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                  return (
                    <SelectItem key={r.id} value={String(r.id)}>
                      <span className="flex items-center gap-1.5">
                        {isVariantRun ? (
                          <GitBranch className="h-3 w-3 text-indigo-500 shrink-0" />
                        ) : (
                          <Minus className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                        <span>{label}</span>
                        <span className="text-muted-foreground text-[10px]">· {date}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" onClick={() => handleDownload("pdf")}>
            <Download className="mr-1.5 h-4 w-4" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleDownload("markdown")}>
            <FileDown className="mr-1.5 h-4 w-4" />
            Export MD
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">

        {/* ── Data Mode Banners ── */}
        {run.dataMode === "mock" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 flex items-start gap-3">
            <FlaskConical className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Demo Run — Simulated Data</p>
              <p className="text-xs text-amber-700 mt-0.5">
                This report is based on AI-generated mock candidates. Results are for demonstration purposes only and do not reflect real hiring data.
              </p>
            </div>
          </div>
        )}
        {run.dataMode === "fallback" && (
          <div className="rounded-xl border border-orange-200 bg-orange-50/70 px-5 py-4 flex items-start gap-3">
            <ShieldAlert className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-orange-800">Fallback Mode — Partial Simulation</p>
              <p className="text-xs text-orange-700 mt-0.5">
                This run started as a Real Data Run but the Twin provider failed during sourcing. Results may include simulated data. Review provider settings before relying on this report.
              </p>
            </div>
          </div>
        )}
        {run.dataMode === "real" && (
          <div className="rounded-xl border border-green-200 bg-green-50/60 px-5 py-4 flex items-start gap-3">
            <Database className="h-4 w-4 text-green-700 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">Real Data Run</p>
              <p className="text-xs text-green-700 mt-0.5">
                This report scored only imported and Twin-sourced candidates. No mock data was generated or mixed in.
              </p>
            </div>
          </div>
        )}

        {/* ── Improved Run Banner ── */}
        {isImprovedRun && (
          <div className="rounded-xl border border-teal-200 bg-teal-50/70 px-5 py-4 flex items-start gap-3">
            <Sparkles className="h-4 w-4 text-teal-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-teal-800">Improved run — low-confidence profiles enriched</p>
              <p className="text-xs text-teal-700 mt-0.5">
                Previously flagged low-confidence candidates were enriched and re-scored. The comparison table below shows score changes vs. the previous run.
              </p>
            </div>
          </div>
        )}

        {/* ── Variant Criteria Banner ── */}
        {isVariant && vc && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-5 py-4">
            <div className="flex items-start gap-3">
              <GitBranch className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-indigo-800 mb-1.5">
                  Variant run — criteria overrides
                  {run.variantLabel && <span className="ml-1.5 font-normal text-indigo-600">"{run.variantLabel}"</span>}
                </p>
                <div className="flex flex-wrap gap-3 text-xs text-indigo-700">
                  {vc.seniority && (
                    <span>
                      <span className="font-medium">Seniority:</span> {vc.seniority}
                    </span>
                  )}
                  {vc.mustHaveSkills && vc.mustHaveSkills.length > 0 && (
                    <span>
                      <span className="font-medium">Skills:</span> {vc.mustHaveSkills.join(", ")}
                    </span>
                  )}
                  {vc.focusNote && (
                    <span>
                      <span className="font-medium">Focus:</span> {vc.focusNote}
                    </span>
                  )}
                </div>
                {baseReport && (
                  <p className="text-xs text-indigo-600 mt-1.5 flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    Comparing against baseline run from{" "}
                    {new Date(baseReport.run.runDate).toLocaleDateString("en-US", { dateStyle: "medium" })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Header Card ── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="bg-gradient-to-r from-slate-900 to-slate-700 px-8 py-6 text-white">
            <h1 className="text-2xl font-bold mb-1">{report.job.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {report.job.location}
              </span>
              <span>·</span>
              <span>{vc?.seniority ?? report.job.seniority}</span>
              <span>·</span>
              <span>Run {new Date(run.runDate).toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
            </div>
          </div>
          <div className="px-8 py-4 bg-muted/20 border-t border-border flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">Total Evaluated</span>
              <p className="font-semibold text-lg">{totalEvaluated}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Report Generated</span>
              <p className="font-medium">{new Date(generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Must-Have Skills</span>
              <p className="font-medium">{(vc?.mustHaveSkills ?? report.job.mustHaveSkills).join(", ")}</p>
            </div>
          </div>
        </div>

        {/* ── Decision Summary ── */}
        {actionGroups && (
          <section className="rounded-xl border border-slate-800 bg-slate-900 text-white overflow-hidden shadow-md">
            <div className="px-7 py-5 border-b border-slate-700/80 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-slate-400 shrink-0" />
                  Decision Summary
                </h2>
                <p className="text-sm text-slate-400 mt-0.5">
                  {totalEvaluated} candidates evaluated · {actionGroups["Interview now"].length} ready to advance
                </p>
              </div>
              <p className="text-xs text-slate-600 shrink-0 mt-0.5">
                {new Date(run.runDate).toLocaleDateString("en-US", { dateStyle: "medium" })}
              </p>
            </div>

            {/* 4 action buckets */}
            <div className="grid grid-cols-2 md:grid-cols-4 divide-y divide-slate-700/60 md:divide-y-0 md:divide-x md:divide-slate-700/60">
              {([
                { key: "Interview now" as ActionLabel,          color: "#22c55e", label: "Interview Now",      sub: "High confidence match" },
                { key: "Review manually" as ActionLabel,        color: "#60a5fa", label: "Review Manually",    sub: "Needs closer look" },
                { key: "Enrich before deciding" as ActionLabel, color: "#f59e0b", label: "Enrich First",       sub: "Data too sparse" },
                { key: "Reject / low priority" as ActionLabel,  color: "#64748b", label: "Low Priority",       sub: "Below threshold" },
              ]).map(({ key, color, label, sub }) => {
                const group = actionGroups[key];
                return (
                  <div key={key} className="px-6 py-5">
                    <div className="mb-3">
                      <span className="text-3xl font-black leading-none" style={{ color }}>{group.length}</span>
                      <div className="mt-1.5">
                        <p className="text-sm font-semibold text-white leading-tight">{label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                      </div>
                    </div>
                    {group.length > 0 ? (
                      <ul className="space-y-1.5">
                        {group.map((e) => (
                          <li key={e.id} className="flex items-center gap-2">
                            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
                            <span className="text-xs text-slate-300 truncate">{e.candidate?.name ?? "Unknown"}</span>
                            <span className="text-[10px] text-slate-600 ml-auto shrink-0 tabular-nums">{e.decisionScore ?? e.score}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-600 italic">None</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Next actions */}
            <div className="px-7 py-5 border-t border-slate-700/80 space-y-3.5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-3">Recommended Next Actions</p>
              {actionGroups["Interview now"].length > 0 && (
                <div className="flex items-start gap-2.5">
                  <span className="text-green-400 font-bold text-sm shrink-0 leading-tight mt-1.5">→</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white mb-1.5">Schedule interviews:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {actionGroups["Interview now"].map((e) => (
                        <CandidateActionButton key={e.candidateId} evaluation={e} jobId={jobId} state={actionState[e.candidateId] ?? "idle"} onExecute={executeAction} compact dark />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {actionGroups["Review manually"].length > 0 && (
                <div className="flex items-start gap-2.5">
                  <span className="text-blue-400 font-bold text-sm shrink-0 leading-tight mt-1.5">→</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white mb-1.5">Review before advancing:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {actionGroups["Review manually"].map((e) => (
                        <CandidateActionButton key={e.candidateId} evaluation={e} jobId={jobId} state={actionState[e.candidateId] ?? "idle"} onExecute={executeAction} compact dark />
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">— verify experience depth and fit</p>
                  </div>
                </div>
              )}
              {actionGroups["Enrich before deciding"].length > 0 && (
                <div className="flex items-start gap-2.5">
                  <span className="text-amber-400 font-bold text-sm shrink-0 leading-tight mt-1.5">→</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white mb-1.5">Enrich profiles first:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {actionGroups["Enrich before deciding"].map((e) => (
                        <CandidateActionButton key={e.candidateId} evaluation={e} jobId={jobId} state={actionState[e.candidateId] ?? "idle"} onExecute={executeAction} compact dark />
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">— too sparse to make a reliable call</p>
                  </div>
                </div>
              )}
              {actionGroups["Reject / low priority"].length > 0 && (
                <div className="flex items-start gap-2.5">
                  <span className="text-slate-500 font-bold text-sm shrink-0 leading-tight mt-1.5">→</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-300 mb-1.5">Deprioritize:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {actionGroups["Reject / low priority"].map((e) => (
                        <CandidateActionButton key={e.candidateId} evaluation={e} jobId={jobId} state={actionState[e.candidateId] ?? "idle"} onExecute={executeAction} compact dark />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Variant Comparison Table ── */}
        {diff && (
          <section>
            <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-indigo-500" />
              Comparison vs Baseline
            </h2>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-indigo-50/40">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Candidate</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Rank</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Score</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Rec.</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground w-28">Score Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diff.map((d) => (
                        <tr
                          key={d.id}
                          className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <span className="font-medium">{d.candidate?.name ?? "Unknown"}</span>
                            {d.candidate?.headline && (
                              <p className="text-xs text-muted-foreground truncate max-w-xs">{d.candidate.headline}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">#{d.currentRank}</span>
                              <DeltaBadge delta={d.rankDelta} type="rank" />
                            </div>
                            {d.baseRank && (
                              <p className="text-[10px] text-muted-foreground">was #{d.baseRank}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`font-bold ${scoreColor(d.score)}`}>{d.score}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <Badge variant="outline" className={`text-xs w-fit ${recBg(d.recommendation)}`}>
                                {d.recommendation}
                              </Badge>
                              {d.recChanged && d.baseRec && (
                                <span className="text-[10px] text-muted-foreground line-through">{d.baseRec}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <DeltaBadge delta={d.scoreDelta} type="score" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Recommendation Summary ── */}
        <section>
          <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Recommendation Summary
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {([
              { key: "Strong Yes" as const, icon: <CheckCircle2 className="h-5 w-5 text-green-600" />, bg: "bg-green-500/5 border-green-200", text: "text-green-700" },
              { key: "Yes" as const, icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, bg: "bg-emerald-500/5 border-emerald-200", text: "text-emerald-700" },
              { key: "Maybe" as const, icon: <MinusCircle className="h-5 w-5 text-amber-600" />, bg: "bg-amber-500/5 border-amber-200", text: "text-amber-700" },
              { key: "No" as const, icon: <XCircle className="h-5 w-5 text-red-600" />, bg: "bg-red-500/5 border-red-200", text: "text-red-700" },
            ] as const).map(({ key, icon, bg, text }) => {
              const baseSummary = baseReport?.recommendationSummary;
              const delta = baseSummary ? recommendationSummary[key] - baseSummary[key] : null;
              return (
                <div key={key} className={`rounded-lg border p-4 ${bg} text-center`}>
                  <div className="flex justify-center mb-1">{icon}</div>
                  <p className={`text-3xl font-bold ${text}`}>{recommendationSummary[key]}</p>
                  {delta !== null && delta !== 0 && (
                    <p className={`text-xs font-medium ${delta > 0 ? "text-green-600" : "text-red-600"}`}>
                      {delta > 0 ? "+" : ""}{delta} vs baseline
                    </p>
                  )}
                  <p className={`text-xs font-medium mt-0.5 ${text}`}>{key}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Score Reliability ── */}
        {evaluations.some((e) => ((e.fitScore ?? e.score) >= 60 && e.confidenceLevel === "Low") || e.requiresEnrichment) && (
          <section>
            <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              Score Reliability
            </h2>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-5 py-4 mb-4 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Promising but under-verified candidates</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  The candidates below scored well on fit but have incomplete or unverified profile data. Their Decision Score has been adjusted downward. Review manually before advancing them.
                </p>
              </div>
            </div>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {evaluations
                    .filter((e) => ((e.fitScore ?? e.score) >= 60 && e.confidenceLevel === "Low") || e.requiresEnrichment)
                    .map((e) => (
                      <div key={e.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{e.candidate?.name ?? "Unknown"}</p>
                          {e.confidenceReason && (
                            <p className="text-xs text-muted-foreground mt-0.5">{e.confidenceReason}</p>
                          )}
                          {e.requiresEnrichment && (
                            <p className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1">
                              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />Low reliability — enrichment recommended
                            </p>
                          )}
                          {e.missingDataWarnings && e.missingDataWarnings.filter(w => w !== "Low reliability — enrichment recommended").length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {e.missingDataWarnings.filter(w => w !== "Low reliability — enrichment recommended").map((w, i) => (
                                <li key={i} className="text-[11px] text-amber-700 flex items-center gap-1">
                                  <AlertTriangle className="h-2.5 w-2.5 shrink-0" />{w}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Fit Score</p>
                            <p className={`text-sm font-bold ${scoreColor(e.fitScore ?? e.score)}`}>{e.fitScore ?? e.score}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Decision Score</p>
                            <p className={`text-sm font-bold ${scoreColor(e.decisionScore ?? e.score)}`}>{e.decisionScore ?? e.score}</p>
                          </div>
                          <Badge variant="outline" className={`text-xs ${confidenceBg("Low")}`}>
                            Low confidence
                          </Badge>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Client Mission Understanding ── */}
        {insight && (
          <section>
            <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Star className="h-4 w-4" />
              Client Mission Understanding
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Ideal Candidate Profile</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed">{insight.idealCandidateProfile}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Evaluation Criteria</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {insight.evaluationCriteria.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 mt-0.5 shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        {/* ── Top 5 Shortlisted Candidates ── */}
        <section>
          <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <Users className="h-4 w-4" />
            Top {top5.length} Shortlisted Candidates
          </h2>
          <div className="space-y-4">
            {top5.map((e, i) => {
              const cand = e.candidate;
              const isSourced = cand?.source === "AI Generated / Mock Sourcing";
              const baseCandEval = baseReport?.evaluations.find((be) => be.candidateId === e.candidateId);
              const scoreDelta = baseCandEval ? e.score - baseCandEval.score : null;
              return (
                <Card key={e.id} className="overflow-hidden">
                  <div className="h-1.5 w-full" style={{ background: e.score >= 80 ? "#16a34a" : e.score >= 60 ? "#f97316" : "#dc2626" }} />
                  <CardContent className="pt-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-muted-foreground">#{i + 1}</span>
                          <h3 className="font-semibold text-base">{cand?.name ?? "Unknown"}</h3>
                          {isSourced && (
                            <Badge variant="outline" className="text-[10px] h-5 py-0 bg-purple-500/10 text-purple-700 border-purple-200">
                              <Zap className="h-2.5 w-2.5 mr-1" />AI Sourced
                            </Badge>
                          )}
                        </div>
                        {cand?.headline && <p className="text-sm text-muted-foreground mt-0.5">{cand.headline}</p>}
                        {cand?.currentCompany && <p className="text-xs text-muted-foreground">{cand.currentCompany}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        <div className="flex flex-col items-end gap-0.5">
                          <Badge variant="outline" className={`font-bold text-sm px-3 py-1 ${scoreBg(e.decisionScore ?? e.score)}`}>
                            {e.decisionScore ?? e.score}/100
                          </Badge>
                          {e.fitScore != null && e.fitScore !== (e.decisionScore ?? e.score) && (
                            <span className="text-[10px] text-muted-foreground">Fit: {e.fitScore}/100</span>
                          )}
                        </div>
                        {scoreDelta !== null && scoreDelta !== 0 && (
                          <Badge variant="outline" className={`text-xs font-medium ${scoreDelta > 0 ? "border-green-200 text-green-700 bg-green-50" : "border-red-200 text-red-700 bg-red-50"}`}>
                            {scoreDelta > 0 ? "+" : ""}{scoreDelta}
                          </Badge>
                        )}
                        {e.confidenceLevel && (
                          <Badge variant="outline" className={`text-xs ${confidenceBg(e.confidenceLevel)}`}>
                            {e.confidenceLevel} conf.
                          </Badge>
                        )}
                        <Badge variant="outline" className={`${recBg(e.recommendation)}`}>
                          <RecIcon rec={e.recommendation} />
                          <span className="ml-1">{e.recommendation}</span>
                        </Badge>
                        {(() => {
                          const action = getActionLabel(e);
                          const cfg = ACTION_CONFIG[action];
                          return (
                            <Badge variant="outline" className={`text-xs font-semibold px-2.5 py-0.5 ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                              {action}
                            </Badge>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Decision score</span>
                        <span className={`font-medium ${scoreColor(e.decisionScore ?? e.score)}`}>
                          {e.decisionScore ?? e.score}%
                          {e.fitScore != null && e.fitScore !== (e.decisionScore ?? e.score) && (
                            <span className="text-muted-foreground font-normal ml-1">· fit: {e.fitScore}%</span>
                          )}
                        </span>
                      </div>
                      <Progress value={e.decisionScore ?? e.score} className="h-2" />
                    </div>
                    {e.summary?.whyRelevant && (
                      <p className="text-sm text-muted-foreground mb-3 italic border-l-2 border-primary/20 pl-3">
                        {e.summary.whyRelevant}
                      </p>
                    )}
                    {e.scoreBreakdown && (
                      <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                          Score Breakdown
                        </p>
                        <ScoreBreakdownDisplay breakdown={e.scoreBreakdown} defaultExpanded={false} showToggle />
                      </div>
                    )}
                    <div className="grid md:grid-cols-2 gap-3 text-sm">
                      {e.strengths.length > 0 && (
                        <div>
                          <p className="font-medium text-green-700 text-xs mb-1.5 uppercase tracking-wide">Strengths</p>
                          <ul className="space-y-1">
                            {e.strengths.map((s, j) => (
                              <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                <CheckCircle2 className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div>
                        {e.gaps.length > 0 && (
                          <>
                            <p className="font-medium text-red-700 text-xs mb-1.5 uppercase tracking-wide">Gaps</p>
                            <ul className="space-y-1 mb-2">
                              {e.gaps.map((g, j) => (
                                <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                  <XCircle className="h-3 w-3 text-red-600 mt-0.5 shrink-0" />
                                  {g}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {e.risks.length > 0 && (
                          <>
                            <p className="font-medium text-amber-700 text-xs mb-1.5 uppercase tracking-wide">Risks</p>
                            <ul className="space-y-1">
                              {e.risks.map((r, j) => (
                                <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                  <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 shrink-0" />
                                  {r}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    </div>
                    {e.summary?.keyRisks && (
                      <div className="mt-3 text-xs text-amber-800 bg-amber-500/5 border border-amber-200 rounded p-2">
                        <span className="font-medium">Key Risk: </span>{e.summary.keyRisks}
                      </div>
                    )}
                    {e.clientFitNarrative && (
                      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3">
                        <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-1.5">Why this candidate fits your client</p>
                        <p className="text-sm text-blue-900 leading-relaxed italic">{e.clientFitNarrative}</p>
                      </div>
                    )}
                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">Execute decision:</p>
                      <CandidateActionButton
                        evaluation={e}
                        jobId={jobId}
                        state={actionState[e.candidateId] ?? "idle"}
                        onExecute={executeAction}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* ── Human vs AI Comparison ── */}
        <HumanAIComparison
          evaluations={evaluations}
          aiTop5Ids={top5.map((e) => e.candidateId)}
        />

        {/* ── Risk Summary + Interview Focus side-by-side ── */}
        <div className="grid md:grid-cols-2 gap-6">
          {risks.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Risk Summary
              </h2>
              <Card>
                <CardContent className="pt-4">
                  <ul className="space-y-2">
                    {risks.map((r, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">{r}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          )}
          {interviewFocusAreas.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Suggested Interview Focus
              </h2>
              <Card>
                <CardContent className="pt-4">
                  <ul className="space-y-2">
                    {interviewFocusAreas.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <div className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </div>
                        <span className="text-muted-foreground">{a}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </section>
          )}
        </div>

        {/* ── Full Evaluation Table ── */}
        <section>
          <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Full Evaluation Table
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Candidate</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Decision</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-16">Fit</th>
                      {diff && <th className="text-left px-4 py-3 font-medium text-muted-foreground w-16">Δ</th>}
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Conf.</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-36">Action</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-28">Rec.</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Dimensions</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Top Strength</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Top Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(diff ?? evaluations).map((e, i) => {
                      const cand = e.candidate;
                      const isSourced = cand?.source === "AI Generated / Mock Sourcing";
                      const diffRow = diff ? (e as CandidateDiff) : null;
                      const displayScore = e.decisionScore ?? e.score;
                      return (
                        <tr key={e.id} className={`border-b border-border last:border-0 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{cand?.name ?? "Unknown"}</span>
                              {isSourced && (
                                <Badge variant="outline" className="text-[10px] h-4 py-0 bg-purple-500/10 text-purple-700 border-purple-200">
                                  <Zap className="h-2 w-2 mr-0.5" />AI
                                </Badge>
                              )}
                            </div>
                            {cand?.headline && <p className="text-xs text-muted-foreground truncate max-w-xs">{cand.headline}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`font-bold ${scoreColor(displayScore)}`}>{displayScore}/100</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-muted-foreground text-xs">{e.fitScore ?? "—"}</span>
                          </td>
                          {diff && (
                            <td className="px-4 py-3">
                              <DeltaBadge delta={diffRow?.scoreDelta ?? null} type="score" />
                            </td>
                          )}
                          <td className="px-4 py-3">
                            {e.confidenceLevel ? (
                              <Badge variant="outline" className={`text-xs ${confidenceBg(e.confidenceLevel)}`}>
                                {e.confidenceLevel}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1.5 items-start">
                              {(() => {
                                const action = getActionLabel(e);
                                const cfg = ACTION_CONFIG[action];
                                return (
                                  <Badge variant="outline" className={`text-xs font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                                    {action}
                                  </Badge>
                                );
                              })()}
                              <CandidateActionButton
                                evaluation={e}
                                jobId={jobId}
                                state={actionState[e.candidateId] ?? "idle"}
                                onExecute={executeAction}
                                compact
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs ${recBg(e.recommendation)}`}>
                              {e.recommendation}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {e.scoreBreakdown ? (
                              <ScoreBreakdownPills breakdown={e.scoreBreakdown} />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs max-w-[180px]">
                            <span className="line-clamp-2">{e.strengths[0] ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs max-w-[180px]">
                            <span className="line-clamp-2">{e.gaps[0] ?? "—"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Footer ── */}
        <div className="text-center text-xs text-muted-foreground pb-8">
          Report generated by ShortlistPro · powered by Daneel · {new Date(generatedAt).toLocaleString()}
          {" · "}
          <button onClick={() => handleDownload("pdf")} className="underline hover:text-primary">Export PDF</button>
          {" · "}
          <button onClick={() => handleDownload("markdown")} className="underline hover:text-primary">Export Markdown</button>
        </div>
      </div>
    </div>
  );
}
