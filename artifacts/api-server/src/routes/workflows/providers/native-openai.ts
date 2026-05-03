/**
 * NativeOpenAIProvider
 *
 * The built-in provider for all core workflow steps. Uses OpenAI GPT via
 * the shared integrations package. This is where the recruiting logic lives:
 * prompts, scoring rubric, recommendation thresholds, and shortlist format.
 *
 * CUSTOMIZATION GUIDE:
 *   - To change prompt copy / tone           → edit lib/branding/src/templates/<APP_TEMPLATE>/prompts.ts
 *   - To change scoring dimensions or weights → edit runCandidateMatching() + matching prompt
 *   - To change recommendation thresholds    → edit the recommendation line in the matching prompt
 *   - For role-specific rubrics              → see examples/custom-scoring-rubric.md
 *   - To swap the model                      → change the `model` field in openai.chat.completions.create()
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "@workspace/db";
import { prompts } from "@workspace/branding";
import type { AgentProvider, AgentProviderRunInput, WorkflowStep } from "./interface";
import type { JobInsightResult, CandidateMatchResult, ShortlistResult, ScoreBreakdown } from "../engine-types";

/** Convert integer percent weights (0-100) into 0-1 fractions used by the scoring math. */
function toFractions(w: ScoringWeights): Record<keyof ScoringWeights, number> {
  return {
    autonomy: w.autonomy / 100,
    productMindset: w.productMindset / 100,
    impact: w.impact / 100,
  };
}

/** Parse JSON from model output, stripping markdown code fences if present. */
function json<T>(content: string): T {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(match ? match[1] : content);
}

export class NativeOpenAIProvider implements AgentProvider {
  readonly id: number;
  readonly name: string;
  readonly type = "native_openai";

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }

  async run(input: AgentProviderRunInput): Promise<unknown> {
    const { step, payload } = input;
    switch (step as WorkflowStep) {
      case "job_understanding":
        return this.runJobUnderstanding(payload as JobUnderstandingPayload);
      case "candidate_matching":
        return this.runCandidateMatching(payload as CandidateMatchingPayload);
      case "shortlist_generation":
        return this.runShortlistGeneration(payload as ShortlistPayload);
      case "sourcing_later":
        return { message: "sourcing_later not yet implemented" };
      default:
        throw new Error(`Unknown step: ${step}`);
    }
  }

  /**
   * Step 1: Job Understanding
   *
   * Converts a raw job description into structured evaluation criteria.
   * Output is stored in job_insights and used by the matching step.
   */
  private async runJobUnderstanding(payload: JobUnderstandingPayload): Promise<JobInsightResult> {
    const { job } = payload;
    const prompt = prompts.jobUnderstanding({ job });

    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    return json<JobInsightResult>(response.choices[0]?.message?.content ?? "{}");
  }

  /**
   * Step 2: Candidate Matching — the core scoring logic.
   *
   * Each candidate is scored independently (concurrency: 3) across 3 weighted
   * dimensions. The weighted score is ALWAYS recomputed server-side after the
   * model responds — this prevents the model from drifting on arithmetic.
   *
   * ── HIRINGAI SCORING RUBRIC (3 dimensions, sum to 1.00) ───────────────────
   *
   * Dimension          Weight   What it measures
   * ─────────────────────────────────────────────────────────────────────────
   * autonomy            0.35    End-to-end ownership, self-direction, led initiatives
   * productMindset      0.30    User/business impact awareness beyond pure execution
   * impact              0.35    Concrete shipped outcomes, measurable results, scope
   *
   * Recommendation thresholds:
   *   80–100 → Strong Yes
   *   60–79  → Yes
   *   40–59  → Maybe
   *   0–39   → No
   */
  private async runCandidateMatching(payload: CandidateMatchingPayload): Promise<CandidateMatchResult[]> {
    const { job, insight, candidates } = payload;
    const weights = toFractions(job.scoringWeights ?? DEFAULT_SCORING_WEIGHTS);
    const results = await batchProcess(
      candidates,
      async (candidate) => {
        const prompt = prompts.candidateMatching({ job, insight, candidate, weights });

        const response = await openai.chat.completions.create({
          model: "gpt-5.1",
          max_completion_tokens: 1400,
          messages: [{ role: "user", content: prompt }],
        });
        const raw = json<{
          scoreBreakdown: ScoreBreakdown;
          fitScore?: number;
          score?: number; // backward-compat fallback
          strengths: string[];
          gaps: string[];
          risks: string[];
          recommendation: CandidateMatchResult["recommendation"];
          confidenceReason?: string;
          missingDataWarnings?: string[];
        }>(response.choices[0]?.message?.content ?? "{}");

        // Recompute fit score server-side to ensure arithmetic consistency.
        const bd = raw.scoreBreakdown;
        const fitScore = bd
          ? Math.round(
              (bd.autonomy?.score ?? 0) * weights.autonomy +
              (bd.productMindset?.score ?? 0) * weights.productMindset +
              (bd.impact?.score ?? 0) * weights.impact,
            )
          : (raw.fitScore ?? raw.score ?? 0);

        return {
          scoreBreakdown: raw.scoreBreakdown,
          fitScore,
          score: fitScore, // will be overridden to decisionScore by engine.ts
          strengths: raw.strengths,
          gaps: raw.gaps,
          risks: raw.risks,
          recommendation: raw.recommendation,
          confidenceReason: raw.confidenceReason,
          missingDataWarnings: raw.missingDataWarnings ?? [],
          candidateId: candidate.id,
          candidateName: candidate.name,
        };
      },
      { concurrency: 3, retries: 3 },
    );
    return results;
  }

  /**
   * Step 3: Shortlist Generation
   *
   * Takes the top-5 evaluated candidates and generates a hiring summary for
   * each. This is the final output shown to the hiring manager in the report.
   */
  private async runShortlistGeneration(payload: ShortlistPayload): Promise<ShortlistResult[]> {
    const { job, insight, evaluations } = payload;
    const top5 = [...evaluations].sort((a, b) => b.score - a.score).slice(0, 5);
    const prompt = prompts.shortlistGeneration({ job, insight, topCandidates: top5 });

    const response = await openai.chat.completions.create({
      model: "gpt-5.1",
      max_completion_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    return json<ShortlistResult[]>(response.choices[0]?.message?.content ?? "[]");
  }

  async validateConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await openai.chat.completions.create({
        model: "gpt-5.1",
        max_completion_tokens: 5,
        messages: [{ role: "user", content: "ping" }],
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// ── Payload types ────────────────────────────────────────────────────────────

export type JobUnderstandingPayload = {
  job: {
    title: string;
    description: string;
    location: string;
    seniority: string;
    mustHaveSkills: string[];
  };
};

export type CandidateMatchingPayload = {
  job: { title: string; description: string; mustHaveSkills: string[]; seniority: string; scoringWeights?: ScoringWeights };
  insight: JobInsightResult;
  candidates: Array<{ id: number; name: string; email: string; skills: string[]; summary: string | null }>;
};

export type ShortlistPayload = {
  job: { title: string; description: string };
  insight: JobInsightResult;
  evaluations: Array<{
    candidateId: number;
    candidateName: string;
    score: number;
    recommendation: string;
    strengths: string[];
    gaps: string[];
  }>;
};
