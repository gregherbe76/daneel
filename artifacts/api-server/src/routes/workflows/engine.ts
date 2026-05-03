import { openai } from "@workspace/integrations-openai-ai-server";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import {
  db,
  agentRunsTable,
  agentLogsTable,
  aiEvaluationsTable,
  jobInsightsTable,
  shortlistsTable,
  jobsTable,
  candidatesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";

// ── helpers ─────────────────────────────────────────────────────────────────

async function logStep(
  runId: number,
  step: string,
  status: "pending" | "running" | "completed" | "failed",
  input?: unknown,
  output?: unknown,
) {
  await db.insert(agentLogsTable).values({ runId, step, status, input: input ?? null, output: output ?? null });
}

async function setRunStatus(runId: number, status: "running" | "completed" | "failed") {
  await db.update(agentRunsTable).set({ status, updatedAt: new Date() }).where(eq(agentRunsTable.id, runId));
}

function json<T>(content: string): T {
  const match = content.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(match ? match[1] : content);
}

// ── STEP 1: Job Understanding ────────────────────────────────────────────────

export type JobInsightResult = {
  mustHaveSkills: string[];
  seniority: string;
  evaluationCriteria: string[];
  idealCandidateProfile: string;
};

async function runJobUnderstanding(
  runId: number,
  job: { title: string; description: string; location: string; seniority: string; mustHaveSkills: string[] },
): Promise<JobInsightResult> {
  await logStep(runId, "job_understanding", "running", { jobTitle: job.title });

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

  const content = response.choices[0]?.message?.content ?? "{}";
  const result = json<JobInsightResult>(content);

  await logStep(runId, "job_understanding", "completed", { jobTitle: job.title }, result);
  return result;
}

// ── STEP 2: Candidate Matching ───────────────────────────────────────────────

export type CandidateMatchResult = {
  score: number;
  strengths: string[];
  gaps: string[];
  risks: string[];
  recommendation: "Strong Yes" | "Yes" | "Maybe" | "No";
};

async function matchCandidate(
  job: { title: string; description: string; mustHaveSkills: string[]; seniority: string },
  insight: JobInsightResult,
  candidate: { id: number; name: string; email: string; skills: string[]; summary: string | null },
): Promise<CandidateMatchResult> {
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

  return json<CandidateMatchResult>(response.choices[0]?.message?.content ?? "{}");
}

async function runCandidateMatching(
  runId: number,
  jobId: number,
  job: { title: string; description: string; mustHaveSkills: string[]; seniority: string },
  insight: JobInsightResult,
  candidates: Array<{ id: number; name: string; email: string; skills: string[]; summary: string | null }>,
): Promise<void> {
  await logStep(runId, "candidate_matching", "running", { candidateCount: candidates.length });

  const results = await batchProcess(
    candidates,
    async (candidate) => {
      const match = await matchCandidate(job, insight, candidate);
      return { candidateId: candidate.id, candidateName: candidate.name, match };
    },
    { concurrency: 3, retries: 3 },
  );

  // Persist evaluations
  await Promise.all(
    results.map(({ candidateId, match }) =>
      db.insert(aiEvaluationsTable).values({
        runId,
        jobId,
        candidateId,
        score: match.score,
        strengths: match.strengths,
        gaps: match.gaps,
        risks: match.risks,
        recommendation: match.recommendation,
      }),
    ),
  );

  await logStep(runId, "candidate_matching", "completed", { candidateCount: candidates.length }, {
    scores: results.map(r => ({ name: r.candidateName, score: r.match.score, rec: r.match.recommendation })),
  });
}

// ── STEP 3: Shortlist ────────────────────────────────────────────────────────

export type ShortlistResult = {
  candidateId: number;
  candidateName: string;
  whyRelevant: string;
  keyRisks: string;
  finalRecommendation: string;
};

async function runShortlist(
  runId: number,
  jobId: number,
  job: { title: string; description: string },
  insight: JobInsightResult,
  evaluations: Array<{
    candidateId: number;
    candidateName: string;
    score: number;
    recommendation: string;
    strengths: string[];
    gaps: string[];
  }>,
): Promise<void> {
  await logStep(runId, "shortlist", "running", { totalEvaluated: evaluations.length });

  // Sort by score, take top 5
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

  const summaries = json<ShortlistResult[]>(response.choices[0]?.message?.content ?? "[]");

  await db.insert(shortlistsTable).values({
    runId,
    jobId,
    rankedCandidateIds: top5.map(c => c.candidateId),
    summaries,
  });

  await logStep(runId, "shortlist", "completed", { top5Count: top5.length }, { summaries });
}

// ── MAIN RUNNER ───────────────────────────────────────────────────────────────

export async function runWorkflowEngine(runId: number, jobId: number) {
  try {
    await setRunStatus(runId, "running");
    logger.info({ runId, jobId }, "Workflow started");

    // Fetch job
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) throw new Error(`Job ${jobId} not found`);

    // Fetch all candidates
    const candidates = await db.select().from(candidatesTable);
    if (candidates.length === 0) {
      logger.warn({ runId }, "No candidates found — skipping matching");
    }

    // Step 1: Job Understanding
    const insight = await runJobUnderstanding(runId, job);

    // Persist insight
    await db.insert(jobInsightsTable).values({
      runId,
      jobId,
      mustHaveSkills: insight.mustHaveSkills,
      seniority: insight.seniority,
      evaluationCriteria: insight.evaluationCriteria,
      idealCandidateProfile: insight.idealCandidateProfile,
    });

    // Step 2: Candidate Matching
    if (candidates.length > 0) {
      await runCandidateMatching(runId, jobId, job, insight, candidates);
    }

    // Step 3: Shortlist (fetch fresh evaluations)
    const evaluations = await db
      .select()
      .from(aiEvaluationsTable)
      .where(eq(aiEvaluationsTable.runId, runId));

    const candidateMap = new Map(candidates.map(c => [c.id, c]));
    const evalWithNames = evaluations.map(e => ({
      candidateId: e.candidateId,
      candidateName: candidateMap.get(e.candidateId)?.name ?? "Unknown",
      score: e.score,
      recommendation: e.recommendation,
      strengths: (e.strengths ?? []) as string[],
      gaps: (e.gaps ?? []) as string[],
    }));

    if (evalWithNames.length > 0) {
      await runShortlist(runId, jobId, job, insight, evalWithNames);
    }

    await setRunStatus(runId, "completed");
    logger.info({ runId, jobId }, "Workflow completed");
  } catch (err) {
    logger.error({ runId, jobId, err }, "Workflow failed");
    await setRunStatus(runId, "failed");
    await logStep(runId, "error", "failed", null, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
