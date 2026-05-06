import { describe, expect, it } from "vitest";
import {
  computeBoostedShortlist,
  type RankingInputEvaluation,
  type RankingInputTechnical,
} from "./shortlist-ranking";

// Helper: build an evaluation row with sensible defaults.
function evalRow(
  candidateId: number,
  candidateName: string,
  score: number,
): RankingInputEvaluation {
  return {
    candidateId,
    candidateName,
    score,
    recommendation: "Yes",
    strengths: [],
    gaps: [],
  };
}

describe("computeBoostedShortlist (Phase 4.3)", () => {
  it("test 1: 3 candidates, no technical evals — ranking matches matching_score DESC and bonus is 0 everywhere", () => {
    const evaluations: RankingInputEvaluation[] = [
      evalRow(1, "Alice", 85),
      evalRow(2, "Bob", 60),
      evalRow(3, "Carol", 72),
    ];
    const tech = new Map<number, RankingInputTechnical>();

    const result = computeBoostedShortlist(evaluations, tech);

    expect(result.map((r) => r.candidateId)).toEqual([1, 3, 2]);
    expect(result.every((r) => r.bonusApplied === 0)).toBe(true);
    expect(result.every((r) => r.techEvaluated === false)).toBe(true);
    expect(result.every((r) => r.codematchOverall === null)).toBe(true);
    // Final score equals matching score when no boost is applied.
    expect(result.map((r) => r.finalScore)).toEqual([85, 72, 60]);
  });

  it("test 2: tied matching_score (70) — candidate with codematch 80 ranks above the unevaluated one", () => {
    const evaluations: RankingInputEvaluation[] = [
      evalRow(1, "WithTech", 70),
      evalRow(2, "NoTech", 70),
    ];
    const tech = new Map<number, RankingInputTechnical>([
      [1, { evaluated: true, overall: 80 }],
    ]);

    const result = computeBoostedShortlist(evaluations, tech);

    expect(result[0].candidateId).toBe(1);
    expect(result[0].finalScore).toBe(86); // 70 + (80/100)*20 = 70 + 16
    expect(result[0].bonusApplied).toBe(16);
    expect(result[0].techEvaluated).toBe(true);
    expect(result[0].codematchOverall).toBe(80);

    expect(result[1].candidateId).toBe(2);
    expect(result[1].finalScore).toBe(70);
    expect(result[1].bonusApplied).toBe(0);
    expect(result[1].techEvaluated).toBe(false);
  });

  it("test 3: matching 85 + codematch 100 caps final_score at 100 (the min(100, ...) clamp)", () => {
    const evaluations: RankingInputEvaluation[] = [evalRow(1, "TopGun", 85)];
    const tech = new Map<number, RankingInputTechnical>([
      [1, { evaluated: true, overall: 100 }],
    ]);

    const result = computeBoostedShortlist(evaluations, tech);

    // Raw bonus would be (100/100)*20 = 20, raw sum = 105 → clamped to 100.
    expect(result[0].bonusApplied).toBe(20);
    expect(result[0].finalScore).toBe(100);
    expect(result[0].matchingScore).toBe(85);
    expect(result[0].codematchOverall).toBe(100);
  });

  it("test 4: technical_evaluation row with evaluated=false → bonus 0, final = matching", () => {
    const evaluations: RankingInputEvaluation[] = [evalRow(1, "Skipped", 60)];
    const tech = new Map<number, RankingInputTechnical>([
      // Provider returned but couldn't score the candidate (e.g. premium gate).
      [1, { evaluated: false, overall: null }],
    ]);

    const result = computeBoostedShortlist(evaluations, tech);

    expect(result[0].finalScore).toBe(60);
    expect(result[0].bonusApplied).toBe(0);
    expect(result[0].techEvaluated).toBe(false);
    expect(result[0].codematchOverall).toBe(null);
  });

  it("test 5: rate-limited eval (evaluated=false + overall=null with stored error) → bonus 0", () => {
    const evaluations: RankingInputEvaluation[] = [evalRow(1, "RateLimited", 60)];
    // Mirrors the persisted shape when CodeMatch returns rate_limited:
    // the engine writes evaluated=false, scores=null, error="rate_limited".
    const tech = new Map<number, RankingInputTechnical>([
      [1, { evaluated: false, overall: null }],
    ]);

    const result = computeBoostedShortlist(evaluations, tech);

    expect(result[0].finalScore).toBe(60);
    expect(result[0].bonusApplied).toBe(0);
    expect(result[0].techEvaluated).toBe(false);
    expect(result[0].matchingScore).toBe(60);
  });

  // ── Bonus regression coverage ─────────────────────────────────────────────

  it("regression: candidate with evaluated=true but overall=NaN is treated as no-eval (bonus 0)", () => {
    const evaluations: RankingInputEvaluation[] = [evalRow(1, "Garbage", 50)];
    const tech = new Map<number, RankingInputTechnical>([
      [1, { evaluated: true, overall: Number.NaN }],
    ]);

    const result = computeBoostedShortlist(evaluations, tech);

    expect(result[0].techEvaluated).toBe(false);
    expect(result[0].bonusApplied).toBe(0);
    expect(result[0].finalScore).toBe(50);
  });

  it("regression: tech-evaluated candidate with overall=0 still counts as evaluated (bonus 0, badge shown)", () => {
    const evaluations: RankingInputEvaluation[] = [evalRow(1, "ZeroScore", 60)];
    const tech = new Map<number, RankingInputTechnical>([
      [1, { evaluated: true, overall: 0 }],
    ]);

    const result = computeBoostedShortlist(evaluations, tech);

    expect(result[0].techEvaluated).toBe(true);
    expect(result[0].codematchOverall).toBe(0);
    expect(result[0].bonusApplied).toBe(0);
    expect(result[0].finalScore).toBe(60);
  });
});
