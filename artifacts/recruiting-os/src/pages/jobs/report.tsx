import { useRoute, Link } from "wouter";
import { useGetJob } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Download, FileText, FileDown, Loader2, MapPin,
  Star, AlertTriangle, MessageSquare, Users, Zap, TrendingUp,
  CheckCircle2, XCircle, MinusCircle, ChevronRight
} from "lucide-react";
import { HumanAIComparison } from "@/components/human-ai-comparison";

// ── types (derived from API response) ────────────────────────────────────────

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
  strengths: string[];
  gaps: string[];
  risks: string[];
  recommendation: string;
  candidate: ReportCandidate | null;
  summary: { candidateId: number; whyRelevant: string; keyRisks: string; finalRecommendation: string } | null;
};

type JobInsight = {
  mustHaveSkills: string[];
  seniority: string;
  evaluationCriteria: string[];
  idealCandidateProfile: string;
};

type HiringReport = {
  generatedAt: string;
  run: { id: number; runDate: string; status: string; runSourcing: boolean };
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

// ── main component ────────────────────────────────────────────────────────────

export default function JobReportPage() {
  const [, params] = useRoute("/jobs/:id/report");
  const jobId = parseInt(params?.id || "0", 10);

  const { data: job } = useGetJob(jobId, {
    query: { enabled: !!jobId, queryKey: [`/api/jobs/${jobId}`] },
  });

  const { data: report, isLoading, error } = useQuery<HiringReport>({
    queryKey: ["report", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/job/${jobId}/latest`);
      if (!res.ok) throw new Error("No completed workflow run found");
      return res.json();
    },
    enabled: !!jobId,
  });

  const handleDownload = (type: "markdown" | "pdf") => {
    window.open(`/api/reports/job/${jobId}/latest/${type}`, "_blank");
  };

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
            Run the AI workflow on this job to generate a hiring manager report.
          </p>
          <Link href={`/jobs/${jobId}`}>
            <Button>Go to Job & Run Workflow</Button>
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
          <Badge variant="outline" className="text-xs shrink-0">Hiring Manager Report</Badge>
          {run.runSourcing && (
            <Badge variant="outline" className="border-purple-200 text-purple-700 bg-purple-500/5 text-xs shrink-0">
              <Zap className="h-3 w-3 mr-1" />Sourcing
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => handleDownload("markdown")}>
            <FileDown className="mr-1.5 h-4 w-4" />
            Export MD
          </Button>
          <Button size="sm" onClick={() => handleDownload("pdf")}>
            <Download className="mr-1.5 h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">

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
              <span>{report.job.seniority}</span>
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
              <p className="font-medium">{report.job.mustHaveSkills.join(", ")}</p>
            </div>
          </div>
        </div>

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
            ] as const).map(({ key, icon, bg, text }) => (
              <div key={key} className={`rounded-lg border p-4 ${bg} text-center`}>
                <div className="flex justify-center mb-1">{icon}</div>
                <p className={`text-3xl font-bold ${text}`}>{recommendationSummary[key]}</p>
                <p className={`text-xs font-medium mt-0.5 ${text}`}>{key}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Job Understanding ── */}
        {insight && (
          <section>
            <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Star className="h-4 w-4" />
              Job Understanding
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
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={`font-bold text-sm px-3 py-1 ${scoreBg(e.score)}`}>
                          {e.score}/100
                        </Badge>
                        <Badge variant="outline" className={`${recBg(e.recommendation)}`}>
                          <RecIcon rec={e.recommendation} />
                          <span className="ml-1">{e.recommendation}</span>
                        </Badge>
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Match score</span>
                        <span className={`font-medium ${scoreColor(e.score)}`}>{e.score}%</span>
                      </div>
                      <Progress value={e.score} className="h-2" />
                    </div>
                    {e.summary?.whyRelevant && (
                      <p className="text-sm text-muted-foreground mb-3 italic border-l-2 border-primary/20 pl-3">
                        {e.summary.whyRelevant}
                      </p>
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
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">Score</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">Rec.</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Top Strength</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Top Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evaluations.map((e, i) => {
                      const cand = e.candidate;
                      const isSourced = cand?.source === "AI Generated / Mock Sourcing";
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
                            <span className={`font-bold ${scoreColor(e.score)}`}>{e.score}/100</span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className={`text-xs ${recBg(e.recommendation)}`}>
                              {e.recommendation}
                            </Badge>
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
          Report generated by Recruiting OS · {new Date(generatedAt).toLocaleString()}
          {" · "}
          <button onClick={() => handleDownload("pdf")} className="underline hover:text-primary">Export PDF</button>
          {" · "}
          <button onClick={() => handleDownload("markdown")} className="underline hover:text-primary">Export Markdown</button>
        </div>
      </div>
    </div>
  );
}
