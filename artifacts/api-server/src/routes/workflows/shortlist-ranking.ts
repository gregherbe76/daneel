/**
 * Phase 4.3 — CodeMatch ranking boost.
 *
 * Pure, side-effect-free ranking helper used by `runShortlist` in engine.ts.
 * Kept in its own module so the formula can be unit-tested without spinning
 * up the full workflow engine + database.
 *
 * Formula (arbitrated in Phase 4.3 design doc):
 *
 *     bonus      = (codematchOverall / 100) * 20      // 0..20
 *     finalScore = min(100, matchingScore + bonus)
 *
 * Candidates without a valid technical evaluation receive `bonus = 0`. There
 * is NO penalty for being unevaluated — the design decision is "boost
 * winners, don't punish the unscored".
 *
 * A "valid" technical evaluation is one where:
 *   - the row exists (i.e. the candidate was actually sent to the provider)
 *   - `evaluated = true` (provider returned scores, not an error)
 *   - `scores.overall` is a finite number (not null/NaN/undefined)
 *
 * Anything else (no row, evaluated=false, overall=null because of a provider
 * error like rate_limited / premium_required / no_github_username) → bonus 0.
 */

export type RankingInputEvaluation = {
  candidateId: number;
  candidateName: string;
  /** = ai_evaluations.score (decisionScore) — the existing matching base. */
  score: number;
  recommendation: string;
  strengths: string[];
  gaps: string[];
};

export type RankingInputTechnical = {
  evaluated: boolean;
  /** technical_evaluations.scores.overall, 0-100. May be null on failed evals. */
  overall: number | null;
};

export type BoostedEvaluation = {
  candidateId: number;
  candidateName: string;
  matchingScore: number;
  codematchOverall: number | null;
  bonusApplied: number;
  finalScore: number;
  techEvaluated: boolean;
  // Pass-through for the LLM provider call.
  recommendation: string;
  strengths: string[];
  gaps: string[];
};

/**
 * Computes the boosted final score per candidate and returns the list sorted
 * by `finalScore` DESC. Stable: ties are broken by original order (which is
 * already insertion order from the DB query).
 */
export function computeBoostedShortlist(
  evaluations: ReadonlyArray<RankingInputEvaluation>,
  technicalByCandidate: ReadonlyMap<number, RankingInputTechnical>,
): BoostedEvaluation[] {
  const boosted: BoostedEvaluation[] = evaluations.map((e) => {
    const tech = technicalByCandidate.get(e.candidateId);
    const hasValidTech =
      !!tech &&
      tech.evaluated === true &&
      typeof tech.overall === "number" &&
      Number.isFinite(tech.overall);

    const codematchOverall = hasValidTech ? (tech!.overall as number) : null;
    const bonusApplied = hasValidTech ? (codematchOverall! / 100) * 20 : 0;
    const finalScore = Math.min(100, e.score + bonusApplied);

    return {
      candidateId: e.candidateId,
      candidateName: e.candidateName,
      matchingScore: e.score,
      codematchOverall,
      bonusApplied,
      finalScore,
      techEvaluated: hasValidTech,
      recommendation: e.recommendation,
      strengths: e.strengths,
      gaps: e.gaps,
    };
  });

  // Sort by finalScore DESC. Use a stable comparator (return 0 on ties) so
  // the original DB order is preserved for equally-scored candidates.
  return boosted.sort((a, b) => b.finalScore - a.finalScore);
}

/**
 * Rounds the noisy float fields to 2 decimals before persisting to JSONB.
 * Keeps the DB stable & the UI tooltip readable. Does NOT change ranking.
 */
export function roundForPersistence(b: BoostedEvaluation): BoostedEvaluation {
  return {
    ...b,
    bonusApplied: Math.round(b.bonusApplied * 100) / 100,
    finalScore: Math.round(b.finalScore * 100) / 100,
  };
}
