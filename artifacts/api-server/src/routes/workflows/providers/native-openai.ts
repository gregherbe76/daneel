/**
 * NativeOpenAIProvider
 *
 * The built-in provider for all core workflow steps. Uses OpenAI GPT via
 * the shared integrations package. This is where the recruiting logic lives:
 * prompts, scoring rubric, recommendation thresholds, and shortlist format.
 *
 * CUSTOMIZATION GUIDE:
 *   - To change scoring dimensions or weights → edit runCandidateMatching()
 *   - To change recommendation thresholds    → edit the recommendation line in the matching prompt
 *   - To change job understanding output     → edit runJobUnderstanding()
 *   - To change shortlist summaries          → edit runShortlistGeneration()
 *   - For role-specific rubrics              → see examples/custom-scoring-rubric.md
 *   - To swap the model                      → change the `model` field in openai.chat.completions.create()
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "@workspace/db";
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
    const prompt = `You are a technical recruiter assistant. Analyze this job posting and return a JSON object.

Job Title: ${job.title}
Location: ${job.location}
Seniority: ${job.seniority}
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Description:
${job.description}

Return a JSON object with exactly these fields:
{
  "mustHaveSkills": ["skill1", "skill2", ...],
  "seniority": "exact seniority level",
  "evaluationCriteria": ["criterion1", "criterion2", ...],
  "idealCandidateProfile": "2-3 sentence description of the ideal candidate"
}

Keep it concise and accurate. Return only valid JSON, no other text.`;

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
    const fmt = (v: number) => v.toFixed(2);
    const results = await batchProcess(
      candidates,
      async (candidate) => {
        const prompt = `You are an experienced HR partner evaluating a candidate for a role. Be concrete and specific — never write generic statements. Every piece of reasoning must reference actual details from the candidate's profile or the job requirements.

JOB: ${job.title} (${job.seniority})
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Evaluation Criteria: ${insight.evaluationCriteria.join("; ")}
Ideal Profile: ${insight.idealCandidateProfile}
Job Description: ${job.description}

CANDIDATE: ${candidate.name}
Skills: ${candidate.skills.length > 0 ? candidate.skills.join(", ") : "none listed"}
Summary: ${candidate.summary ?? "No summary provided"}

Score this candidate's FIT for the role across 3 weighted dimensions. Each dimension score is 0-100.
The fitScore = round(
  autonomy*${fmt(weights.autonomy)} + productMindset*${fmt(weights.productMindset)} + impact*${fmt(weights.impact)}
).

IMPORTANT — Scoring rules:
- Score ONLY based on evidence present in the profile. Do NOT assume or invent qualifications.
- Do NOT penalize for missing data. Instead, score conservatively on that dimension and flag the gap in missingDataWarnings.
- If a dimension has no evidence at all, score it at 20-30 (not 0) and flag it.
- Never fabricate experience or skills that are not explicitly listed.
- Treat must-have skills as a baseline expectation: weave skill coverage into Impact reasoning rather than as a standalone dimension.

Dimension definitions:
- autonomy (${fmt(weights.autonomy)}): End-to-end ownership, led initiatives, worked without heavy direction. Cite specific evidence of self-direction.
- productMindset (${fmt(weights.productMindset)}): Evidence the candidate thinks about users, product impact, or business outcomes — not just code or tasks.
- impact (${fmt(weights.impact)}): Concrete shipped outcomes, measurable results, scope of work, and how their must-have skill coverage translates into tangible impact for this role.

Additional rules:
- reasoning must be 1-2 specific sentences referencing actual candidate details
- strengths, gaps and risks must be specific, not generic
- confidenceReason: 1 sentence explaining data limitations that reduce scoring confidence (or "Profile provides sufficient data for reliable scoring" if data is complete)
- missingDataWarnings: list 0-3 specific data gaps that affect scoring reliability (empty array if none)

Return only valid JSON matching this exact structure:
{
  "scoreBreakdown": {
    "autonomy":       { "score": <0-100>, "weight": ${fmt(weights.autonomy)}, "reasoning": "<specific 1-2 sentences>" },
    "productMindset": { "score": <0-100>, "weight": ${fmt(weights.productMindset)}, "reasoning": "<specific 1-2 sentences>" },
    "impact":         { "score": <0-100>, "weight": ${fmt(weights.impact)}, "reasoning": "<specific 1-2 sentences>" }
  },
  "fitScore": <integer 0-100, must equal round(weighted sum above)>,
  "strengths": ["<specific strength citing candidate detail>", "<specific strength>"],
  "gaps": ["<specific gap naming missing skill or evidence>"],
  "risks": ["<concrete risk with specific evidence>"],
  "recommendation": "<Strong Yes|Yes|Maybe|No based on fitScore: 80-100=Strong Yes, 60-79=Yes, 40-59=Maybe, 0-39=No>",
  "confidenceReason": "<1 sentence on data limitations, or 'Profile provides sufficient data for reliable scoring'>",
  "missingDataWarnings": ["<specific data gap>"]
}`;

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
    const prompt = `You are creating a startup hiring shortlist for a founder. Be ultra-direct: no jargon, no filler, no diplomatic hedging. Founders want a verdict and the evidence behind it — nothing more.

JOB: ${job.title}
Ideal Profile: ${insight.idealCandidateProfile}

TOP CANDIDATES:
${top5.map((c, i) => `${i + 1}. ${c.candidateName} (Score: ${c.score}, Recommendation: ${c.recommendation})
   Strengths: ${c.strengths.join(", ")}
   Gaps: ${c.gaps.join(", ")}`).join("\n\n")}

For each candidate, return:
- whyRelevant: ONE short sentence verdict — the headline reason to talk to them. No preamble.
- keyRisks: ONE short sentence naming the single biggest risk. No softening language.
- finalRecommendation: ONE short imperative sentence ("Interview now.", "Pass.", "Phone screen first to verify X.").

Hard limits: each field <= 25 words. Reference concrete evidence from strengths/gaps. Do NOT repeat the candidate's name inside the fields. Do NOT use phrases like "this candidate", "appears to", "seems to be", "could be a great fit".

Return only a valid JSON array:
[
  {
    "candidateId": <number>,
    "candidateName": "<name>",
    "whyRelevant": "<one short verdict sentence>",
    "keyRisks": "<one short risk sentence>",
    "finalRecommendation": "<one short imperative sentence>"
  }
]`;

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
