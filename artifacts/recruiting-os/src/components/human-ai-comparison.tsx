import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Users,
  Bot,
  User,
  GitMerge,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ── shared types (mirrored from report.tsx) ──────────────────────────────────

type ReportCandidate = {
  id: number;
  name: string;
  email: string;
  headline?: string | null;
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
  summary?: {
    candidateId: number;
    whyRelevant: string;
    keyRisks: string;
    finalRecommendation: string;
  } | null;
};

interface Props {
  evaluations: ReportEvaluation[];
  aiTop5Ids: number[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

const scoreColor = (score: number) =>
  score >= 80 ? "text-green-700" : score >= 60 ? "text-amber-700" : "text-red-700";

const scoreBg = (score: number) =>
  score >= 80
    ? "bg-green-500/10 border-green-200 text-green-700"
    : score >= 60
    ? "bg-amber-500/10 border-amber-200 text-amber-700"
    : "bg-red-500/10 border-red-200 text-red-700";

const recBg = (rec: string) => {
  if (rec === "Strong Yes") return "bg-green-500/10 border-green-200 text-green-700";
  if (rec === "Yes") return "bg-emerald-500/10 border-emerald-200 text-emerald-700";
  if (rec === "Maybe") return "bg-amber-500/10 border-amber-200 text-amber-700";
  return "bg-red-500/10 border-red-200 text-red-700";
};

const RecIcon = ({ rec }: { rec: string }) => {
  if (rec === "Strong Yes" || rec === "Yes")
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
  if (rec === "Maybe") return <MinusCircle className="h-3.5 w-3.5 text-amber-600" />;
  return <XCircle className="h-3.5 w-3.5 text-red-600" />;
};

function deltaLabel(delta: number) {
  if (Math.abs(delta) <= 3) return "Aligned";
  if (delta > 0) return `You ranked +${delta} pts higher`;
  return `AI ranked ${Math.abs(delta)} pts higher`;
}

function generateDisagreementReason(eval_: ReportEvaluation, humanChose: boolean): string {
  const score = eval_.score;
  const name = eval_.candidate?.name?.split(" ")[0] ?? "This candidate";
  const topStrength = (eval_.strengths as string[])[0];
  const topGap = (eval_.gaps as string[])[0];
  const topRisk = (eval_.risks as string[])[0];

  if (humanChose && score < 50) {
    const reason = topGap
      ? `The AI flagged a significant gap: ${topGap.toLowerCase()}.`
      : `The AI score of ${score}/100 suggests limited alignment with the role's core criteria.`;
    return reason;
  }

  if (!humanChose && score >= 80) {
    const reason = topStrength
      ? `${name} scored ${score}/100 — the AI highlighted: ${topStrength.toLowerCase()}.`
      : `${name} scored ${score}/100, placing them in the top tier for this role.`;
    return reason;
  }

  if (!humanChose && score >= 60) {
    const reason = topStrength
      ? `A solid match (${score}/100). Key strength: ${topStrength.toLowerCase()}.`
      : `The AI rated this candidate ${score}/100 — solid but not exceptional.`;
    return reason;
  }

  if (humanChose && score >= 60 && score < 80) {
    const caveats = topRisk
      ? ` One risk to consider: ${topRisk.toLowerCase()}.`
      : "";
    return `The AI agrees this is a reasonable pick (${score}/100).${caveats}`;
  }

  return `Score: ${score}/100. ${topStrength ? `Strength: ${topStrength.toLowerCase()}.` : ""} ${topGap ? `Gap: ${topGap.toLowerCase()}.` : ""}`.trim();
}

// ── candidate selector chip ──────────────────────────────────────────────────

function CandidateChip({
  evaluation,
  selected,
  onToggle,
}: {
  evaluation: ReportEvaluation;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = evaluation.candidate?.name ?? "Unknown";
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
        selected
          ? "border-primary bg-primary/10 text-primary font-medium"
          : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-muted/50"
      }`}
    >
      <div
        className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
          selected ? "bg-primary border-primary" : "border-muted-foreground/40"
        }`}
      >
        {selected && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <span className="truncate max-w-[140px]">{name}</span>
      <span className={`text-xs font-semibold ml-auto ${scoreColor(evaluation.score)}`}>
        {evaluation.score}
      </span>
    </button>
  );
}

// ── candidate card in comparison columns ─────────────────────────────────────

function ComparisonCard({
  evaluation,
  rank,
  tag,
  tagColor,
  showDisagreement,
  humanChose,
}: {
  evaluation: ReportEvaluation;
  rank: number;
  tag: string;
  tagColor: string;
  showDisagreement: boolean;
  humanChose: boolean;
}) {
  const name = evaluation.candidate?.name ?? "Unknown";
  const headline = evaluation.candidate?.headline;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div
        className="h-1 w-full"
        style={{
          background:
            evaluation.score >= 80
              ? "#16a34a"
              : evaluation.score >= 60
              ? "#f97316"
              : "#dc2626",
        }}
      />
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground font-semibold">#{rank}</span>
              <span className="font-semibold text-sm truncate">{name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tagColor}`}>
                {tag}
              </span>
            </div>
            {headline && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{headline}</p>
            )}
          </div>
          <Badge
            variant="outline"
            className={`text-xs font-bold shrink-0 ${scoreBg(evaluation.score)}`}
          >
            {evaluation.score}
          </Badge>
        </div>
        <Progress value={evaluation.score} className="h-1.5 mb-2" />
        <Badge variant="outline" className={`text-xs ${recBg(evaluation.recommendation)}`}>
          <RecIcon rec={evaluation.recommendation} />
          <span className="ml-1">{evaluation.recommendation}</span>
        </Badge>
        {showDisagreement && (
          <div
            className={`mt-2 text-xs rounded p-2 leading-relaxed ${
              humanChose
                ? "bg-violet-500/5 border border-violet-200 text-violet-800"
                : "bg-blue-500/5 border border-blue-200 text-blue-800"
            }`}
          >
            {generateDisagreementReason(evaluation, humanChose)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function HumanAIComparison({ evaluations, aiTop5Ids }: Props) {
  const [humanIds, setHumanIds] = useState<Set<number>>(new Set());
  const [showTable, setShowTable] = useState(false);

  const toggle = (id: number) =>
    setHumanIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const aiSet = useMemo(() => new Set(aiTop5Ids), [aiTop5Ids]);

  const overlapIds = useMemo(
    () => [...humanIds].filter((id) => aiSet.has(id)),
    [humanIds, aiSet],
  );

  const humanOnlyIds = useMemo(
    () => [...humanIds].filter((id) => !aiSet.has(id)),
    [humanIds, aiSet],
  );

  const aiOnlyIds = useMemo(
    () => aiTop5Ids.filter((id) => !humanIds.has(id)),
    [humanIds, aiTop5Ids],
  );

  const evalById = useMemo(
    () => new Map(evaluations.map((e) => [e.candidateId, e])),
    [evaluations],
  );

  const aiRankMap = useMemo(() => {
    const m = new Map<number, number>();
    aiTop5Ids.forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [aiTop5Ids]);

  const humanRankMap = useMemo(() => {
    const sorted = [...humanIds]
      .map((id) => evalById.get(id))
      .filter(Boolean)
      .sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0));
    const m = new Map<number, number>();
    sorted.forEach((e, i) => e && m.set(e.candidateId, i + 1));
    return m;
  }, [humanIds, evalById]);

  const hasSelection = humanIds.size > 0;
  const agreementPct =
    hasSelection ? Math.round((overlapIds.length / Math.max(humanIds.size, 1)) * 100) : 0;

  // Score delta table rows (all human-selected candidates)
  const deltaRows = useMemo(
    () =>
      [...humanIds]
        .map((id) => {
          const e = evalById.get(id);
          if (!e) return null;
          const humanRank = humanRankMap.get(id) ?? 0;
          const aiRank = aiRankMap.get(id);
          const aiScore = e.score;
          return { e, humanRank, aiRank, aiScore };
        })
        .filter(Boolean)
        .sort((a, b) => (a!.humanRank ?? 99) - (b!.humanRank ?? 99)),
    [humanIds, evalById, humanRankMap, aiRankMap],
  );

  return (
    <section className="space-y-4">
      {/* heading */}
      <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <GitMerge className="h-4 w-4" />
        Compare with Your Picks
      </h2>

      {/* instruction card */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <p className="text-sm text-muted-foreground mb-3">
            Select the candidates <strong>you</strong> would shortlist. The system will compare
            your picks against the AI shortlist — showing overlap, gaps, and where you disagree.
          </p>

          <div className="flex flex-wrap gap-2">
            {evaluations.map((e) => (
              <CandidateChip
                key={e.candidateId}
                evaluation={e}
                selected={humanIds.has(e.candidateId)}
                onToggle={() => toggle(e.candidateId)}
              />
            ))}
          </div>

          {hasSelection && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {humanIds.size} selected · {overlapIds.length} overlap with AI
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => setHumanIds(new Set())}
              >
                Clear
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* comparison panel */}
      {hasSelection && (
        <>
          {/* agreement score */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p
                className={`text-3xl font-bold ${
                  agreementPct >= 60
                    ? "text-green-700"
                    : agreementPct >= 40
                    ? "text-amber-700"
                    : "text-red-700"
                }`}
              >
                {agreementPct}%
              </p>
              <p className="text-xs text-muted-foreground mt-1 font-medium">Agreement</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-3xl font-bold text-primary">{overlapIds.length}</p>
              <p className="text-xs text-muted-foreground mt-1 font-medium">In Both</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 text-center">
              <p className="text-3xl font-bold text-muted-foreground">
                {humanOnlyIds.length + aiOnlyIds.length}
              </p>
              <p className="text-xs text-muted-foreground mt-1 font-medium">Disagreements</p>
            </div>
          </div>

          {/* three-column comparison */}
          <div className="grid grid-cols-3 gap-4">
            {/* AI Only */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold text-blue-700">AI Only</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {aiOnlyIds.length}
                </span>
              </div>
              <div className="space-y-2">
                {aiOnlyIds.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-4 text-center">
                    No AI-only candidates
                  </p>
                ) : (
                  aiOnlyIds.map((id, i) => {
                    const e = evalById.get(id);
                    if (!e) return null;
                    return (
                      <ComparisonCard
                        key={id}
                        evaluation={e}
                        rank={aiRankMap.get(id) ?? i + 1}
                        tag="AI Pick"
                        tagColor="bg-blue-100 text-blue-700"
                        showDisagreement
                        humanChose={false}
                      />
                    );
                  })
                )}
              </div>
            </div>

            {/* Overlap */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-green-600" />
                <span className="text-sm font-semibold text-green-700">Overlap</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {overlapIds.length}
                </span>
              </div>
              <div className="space-y-2">
                {overlapIds.length === 0 ? (
                  <div className="border-2 border-dashed border-border rounded-lg py-8 text-center">
                    <p className="text-xs text-muted-foreground">No overlap yet</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Select AI shortlisted candidates to see agreement
                    </p>
                  </div>
                ) : (
                  overlapIds.map((id, i) => {
                    const e = evalById.get(id);
                    if (!e) return null;
                    return (
                      <ComparisonCard
                        key={id}
                        evaluation={e}
                        rank={aiRankMap.get(id) ?? i + 1}
                        tag="Both"
                        tagColor="bg-green-100 text-green-700"
                        showDisagreement={false}
                        humanChose
                      />
                    );
                  })
                )}
              </div>
            </div>

            {/* Human Only */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4 text-violet-600" />
                <span className="text-sm font-semibold text-violet-700">Your Picks Only</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {humanOnlyIds.length}
                </span>
              </div>
              <div className="space-y-2">
                {humanOnlyIds.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-4 text-center">
                    No unique picks yet
                  </p>
                ) : (
                  humanOnlyIds.map((id, i) => {
                    const e = evalById.get(id);
                    if (!e) return null;
                    return (
                      <ComparisonCard
                        key={id}
                        evaluation={e}
                        rank={humanRankMap.get(id) ?? i + 1}
                        tag="Your Pick"
                        tagColor="bg-violet-100 text-violet-700"
                        showDisagreement
                        humanChose
                      />
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* score delta table (collapsible) */}
          <Card>
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors rounded-lg"
              onClick={() => setShowTable((v) => !v)}
            >
              <span className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Score Comparison Table
              </span>
              {showTable ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {showTable && (
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                          Candidate
                        </th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs w-20">
                          Your Rank
                        </th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs w-20">
                          AI Rank
                        </th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs w-24">
                          AI Score
                        </th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                          View
                        </th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs">
                          AI Take
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {deltaRows.map((row, i) => {
                        if (!row) return null;
                        const { e, humanRank, aiRank, aiScore } = row;
                        const inAiTop5 = aiSet.has(e.candidateId);
                        const aiRankDisplay = aiRank ? `#${aiRank}` : "Outside top 5";
                        // score from human pov: human picked them, so their "human score" is implied by picking
                        // We use AI score as the objective signal
                        const DeltaIcon = !inAiTop5
                          ? TrendingDown
                          : humanRank <= (aiRank ?? 99)
                          ? TrendingUp
                          : Minus;
                        const deltaColor = !inAiTop5
                          ? "text-red-600"
                          : humanRank < (aiRank ?? 99)
                          ? "text-violet-600"
                          : "text-green-600";

                        return (
                          <tr
                            key={e.candidateId}
                            className={`border-b border-border last:border-0 hover:bg-muted/20 ${
                              i % 2 === 0 ? "" : "bg-muted/10"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <p className="font-medium text-sm">
                                {e.candidate?.name ?? "Unknown"}
                              </p>
                              {e.candidate?.headline && (
                                <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                                  {e.candidate.headline}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-semibold text-violet-700">#{humanRank}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  inAiTop5 ? "font-semibold text-blue-700" : "text-muted-foreground text-xs"
                                }
                              >
                                {aiRankDisplay}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`font-bold ${scoreColor(aiScore)}`}>
                                {aiScore}/100
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className={`flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
                                <DeltaIcon className="h-3 w-3" />
                                {!inAiTop5
                                  ? "Not in AI top 5"
                                  : humanRank === aiRank
                                  ? "Same rank"
                                  : deltaLabel(
                                      (aiRank ?? 0) - humanRank,
                                    )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px]">
                              <span className="line-clamp-2">
                                {(e.strengths as string[])[0] ?? "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Summary insight */}
          <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            {agreementPct === 100 ? (
              <p>
                <strong className="text-green-700">Full agreement.</strong> Your picks and the AI
                shortlist are identical. High confidence in this shortlist.
              </p>
            ) : agreementPct >= 60 ? (
              <p>
                <strong className="text-amber-700">Mostly aligned.</strong> You agreed on{" "}
                {overlapIds.length} of {Math.max(humanIds.size, aiTop5Ids.length)} candidates. Review the{" "}
                {humanOnlyIds.length + aiOnlyIds.length} disagreements before finalising your shortlist.
              </p>
            ) : agreementPct > 0 ? (
              <p>
                <strong className="text-red-700">Significant divergence.</strong> You and the AI
                agreed on only {overlapIds.length} candidate{overlapIds.length !== 1 ? "s" : ""}. Check the
                AI reasoning — or your criteria — for the candidates you disagree on.
              </p>
            ) : (
              <p>
                <strong className="text-red-700">No overlap.</strong> Your shortlist and the AI's
                don't share any candidates. This is worth investigating — either the AI's scoring
                criteria don't match your judgment, or there are candidates the AI ranked highly
                that deserve a second look.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
