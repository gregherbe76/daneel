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
import type { AgentProvider, AgentProviderRunInput, WorkflowStep } from "./interface";
import type { JobInsightResult, CandidateMatchResult, ShortlistResult, ScoreBreakdown } from "../engine-types";

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
   *
   * To add new fields to the insight (e.g. preferredBackground, teamContext),
   * add them to the prompt and to the JobInsightResult type in engine-types.ts.
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
   * Each candidate is scored independently (concurrency: 3) across 4 weighted
   * dimensions. The weighted score is ALWAYS recomputed server-side after the
   * model responds — this prevents the model from drifting on arithmetic.
   *
   * ── SCORING RUBRIC ────────────────────────────────────────────────────────
   *
   * Dimension       Weight   What it measures
   * ─────────────────────────────────────────────────────────────────────────
   * skillsMatch      0.35    Coverage of required skills from the job description
   * experienceDepth  0.30    Evidence of seniority-appropriate, hands-on depth
   * autonomy         0.20    End-to-end ownership, self-direction, led initiatives
   * productMindset   0.15    User/business impact awareness beyond pure execution
   *
   * Recommendation thresholds (also in the prompt):
   *   80–100 → Strong Yes
   *   60–79  → Yes
   *   40–59  → Maybe
   *   0–39   → No
   *
   * To customize:
   *   - Change weights: update the prompt AND the recomputation block below
   *   - Add/rename dimensions: add to the prompt + scoreBreakdown + recomputation
   *   - Change thresholds: edit the recommendation line in the prompt
   *   - See examples/custom-scoring-rubric.md for a full walkthrough
   */
  private async runCandidateMatching(payload: CandidateMatchingPayload): Promise<CandidateMatchResult[]> {
    const { job, insight, candidates } = payload;
    const results = await batchProcess(
      candidates,
      async (candidate) => {
        const prompt = `You are a senior technical recruiter evaluating a candidate for a specific role. Be concrete and specific — never write generic statements. Every piece of reasoning must reference actual details from the candidate's profile or the job requirements.

JOB: ${job.title} (${job.seniority})
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Evaluation Criteria: ${insight.evaluationCriteria.join("; ")}
Ideal Profile: ${insight.idealCandidateProfile}
Job Description: ${job.description}

CANDIDATE: ${candidate.name}
Skills: ${candidate.skills.length > 0 ? candidate.skills.join(", ") : "none listed"}
Summary: ${candidate.summary ?? "No summary provided"}

Score this candidate across 4 weighted dimensions. Each dimension score is 0-100.
The final weighted score = (skillsMatch * 0.35) + (experienceDepth * 0.30) + (autonomy * 0.20) + (productMindset * 0.15).

Dimension definitions:
- skillsMatch (weight 0.35): How well do the candidate's listed skills cover the must-have skills and evaluation criteria? Cite specific skill matches or gaps.
- experienceDepth (weight 0.30): Does the summary/background suggest deep, hands-on experience at the required seniority level? Be explicit about what is missing or present.
- autonomy (weight 0.20): Is there evidence the candidate has owned projects end-to-end, worked without heavy direction, or led initiatives? If no evidence, say so explicitly.
- productMindset (weight 0.15): Does the candidate think about users, product impact, or business outcomes — not just technical execution? Cite specific signals or flag absence.

Rules:
- reasoning must be 1-2 specific sentences referencing actual candidate details or role requirements
- Never write "The candidate has strong skills" — always name the specific skill and how it maps to the role
- If the candidate has no summary and few skills, say so explicitly in reasoning
- strengths and gaps must be specific (e.g. "Owns React and TypeScript which are the primary must-haves" not "Good technical skills")
- risks must be concrete (e.g. "No evidence of leading a team at Senior level" not "May lack leadership")

Return only valid JSON matching this exact structure:
{
  "scoreBreakdown": {
    "skillsMatch": { "score": <0-100>, "weight": 0.35, "reasoning": "<specific 1-2 sentences>" },
    "experienceDepth": { "score": <0-100>, "weight": 0.30, "reasoning": "<specific 1-2 sentences>" },
    "autonomy": { "score": <0-100>, "weight": 0.20, "reasoning": "<specific 1-2 sentences>" },
    "productMindset": { "score": <0-100>, "weight": 0.15, "reasoning": "<specific 1-2 sentences>" }
  },
  "score": <integer 0-100, must equal round(skillsMatch*0.35 + experienceDepth*0.30 + autonomy*0.20 + productMindset*0.15)>,
  "strengths": ["<specific strength citing candidate detail>", "<specific strength>"],
  "gaps": ["<specific gap naming missing skill or evidence>"],
  "risks": ["<concrete risk with specific evidence>"],
  "recommendation": "<Strong Yes|Yes|Maybe|No based on score: 80-100=Strong Yes, 60-79=Yes, 40-59=Maybe, 0-39=No>"
}`;

        const response = await openai.chat.completions.create({
          model: "gpt-5.1",
          max_completion_tokens: 900,
          messages: [{ role: "user", content: prompt }],
        });
        const raw = json<Omit<CandidateMatchResult, "candidateId" | "candidateName"> & { scoreBreakdown: ScoreBreakdown }>(
          response.choices[0]?.message?.content ?? "{}",
        );

        // Recompute weighted score server-side to ensure arithmetic consistency.
        // If you change dimension weights in the prompt, update these multipliers too.
        const bd = raw.scoreBreakdown;
        const weightedScore = bd
          ? Math.round(
              bd.skillsMatch.score * 0.35 +
              bd.experienceDepth.score * 0.30 +
              bd.autonomy.score * 0.20 +
              bd.productMindset.score * 0.15,
            )
          : raw.score;

        return {
          ...raw,
          score: weightedScore,
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
   *
   * To change the shortlist format, edit the prompt below.
   * To change how many candidates are shortlisted, change the .slice(0, 5) limit.
   */
  private async runShortlistGeneration(payload: ShortlistPayload): Promise<ShortlistResult[]> {
    const { job, insight, evaluations } = payload;
    const top5 = [...evaluations].sort((a, b) => b.score - a.score).slice(0, 5);
    const prompt = `You are a technical recruiter creating a hiring shortlist.

JOB: ${job.title}
Ideal Profile: ${insight.idealCandidateProfile}

TOP CANDIDATES:
${top5.map((c, i) => `${i + 1}. ${c.candidateName} (Score: ${c.score}, Recommendation: ${c.recommendation})
   Strengths: ${c.strengths.join(", ")}
   Gaps: ${c.gaps.join(", ")}`).join("\n\n")}

For each candidate, provide a brief hiring summary. Return JSON array:
[
  {
    "candidateId": <number>,
    "candidateName": "<name>",
    "whyRelevant": "1-2 sentences on why they are a strong match",
    "keyRisks": "1 sentence on the main risk or gap",
    "finalRecommendation": "1 sentence final hiring recommendation"
  }
]

Return only valid JSON array.`;

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
// These define the shape of input.payload for each step handled by this provider.
// Keep in sync with the payload shapes sent by engine.ts.

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
  job: { title: string; description: string; mustHaveSkills: string[]; seniority: string };
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
