import { openai } from "@workspace/integrations-openai-ai-server";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import type { AgentProvider, AgentProviderRunInput, WorkflowStep } from "./interface";
import type { JobInsightResult, CandidateMatchResult, ShortlistResult } from "../engine-types";

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

  private async runCandidateMatching(payload: CandidateMatchingPayload): Promise<CandidateMatchResult[]> {
    const { job, insight, candidates } = payload;
    const results = await batchProcess(
      candidates,
      async (candidate) => {
        const prompt = `You are a technical recruiter. Score this candidate for the job.

JOB: ${job.title} (${job.seniority})
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
Evaluation Criteria: ${insight.evaluationCriteria.join(", ")}
Ideal Profile: ${insight.idealCandidateProfile}

CANDIDATE: ${candidate.name}
Skills: ${candidate.skills.join(", ")}
Summary: ${candidate.summary ?? "No summary provided"}

Return JSON:
{
  "score": <integer 0-100>,
  "strengths": ["strength1", "strength2"],
  "gaps": ["gap1", "gap2"],
  "risks": ["risk1"],
  "recommendation": "Strong Yes" | "Yes" | "Maybe" | "No"
}

Score guidelines: 80-100=Strong Yes, 60-79=Yes, 40-59=Maybe, 0-39=No.
Return only valid JSON.`;

        const response = await openai.chat.completions.create({
          model: "gpt-5.1",
          max_completion_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        });
        const match = json<CandidateMatchResult>(response.choices[0]?.message?.content ?? "{}");
        return { candidateId: candidate.id, candidateName: candidate.name, ...match };
      },
      { concurrency: 3, retries: 3 },
    );
    return results;
  }

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
