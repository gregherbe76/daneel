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
import { resolveProvider } from "./providers";
import type { JobInsightResult, CandidateMatchResult, ShortlistResult } from "./engine-types";

export type { JobInsightResult, CandidateMatchResult, ShortlistResult };

// ── helpers ──────────────────────────────────────────────────────────────────

async function logStep(
  runId: number,
  step: string,
  status: "pending" | "running" | "completed" | "failed",
  input?: unknown,
  output?: unknown,
) {
  await db
    .insert(agentLogsTable)
    .values({ runId, step, status, input: input ?? null, output: output ?? null });
}

async function setRunStatus(runId: number, status: "running" | "completed" | "failed") {
  await db
    .update(agentRunsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(agentRunsTable.id, runId));
}

// ── STEP 1: Job Understanding ─────────────────────────────────────────────────

async function runJobUnderstanding(
  runId: number,
  jobId: number,
  job: { title: string; description: string; location: string; seniority: string; mustHaveSkills: string[] },
): Promise<JobInsightResult> {
  await logStep(runId, "job_understanding", "running", { jobTitle: job.title });

  const provider = await resolveProvider("job_understanding");
  logger.info({ runId, step: "job_understanding", provider: provider.name }, "Step dispatched");

  try {
    const result = (await provider.run({
      step: "job_understanding",
      runId,
      jobId,
      payload: { job },
    })) as JobInsightResult;

    await logStep(runId, "job_understanding", "completed", { jobTitle: job.title, provider: provider.name }, result);
    return result;
  } catch (err) {
    await logStep(runId, "job_understanding", "failed", { jobTitle: job.title, provider: provider.name }, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── STEP 2: Candidate Matching ────────────────────────────────────────────────

async function runCandidateMatching(
  runId: number,
  jobId: number,
  job: { title: string; description: string; mustHaveSkills: string[]; seniority: string },
  insight: JobInsightResult,
  candidates: Array<{ id: number; name: string; email: string; skills: string[]; summary: string | null }>,
): Promise<void> {
  await logStep(runId, "candidate_matching", "running", { candidateCount: candidates.length });

  const provider = await resolveProvider("candidate_matching");
  logger.info({ runId, step: "candidate_matching", provider: provider.name }, "Step dispatched");

  try {
    const results = (await provider.run({
      step: "candidate_matching",
      runId,
      jobId,
      payload: { job, insight, candidates },
    })) as CandidateMatchResult[];

    await Promise.all(
      results.map((r) =>
        db.insert(aiEvaluationsTable).values({
          runId,
          jobId,
          candidateId: r.candidateId,
          score: r.score,
          strengths: r.strengths,
          gaps: r.gaps,
          risks: r.risks,
          recommendation: r.recommendation,
        }),
      ),
    );

    await logStep(runId, "candidate_matching", "completed", { candidateCount: candidates.length, provider: provider.name }, {
      scores: results.map((r) => ({ name: r.candidateName, score: r.score, rec: r.recommendation })),
    });
  } catch (err) {
    await logStep(runId, "candidate_matching", "failed", { candidateCount: candidates.length, provider: provider.name }, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── STEP 3: Shortlist ─────────────────────────────────────────────────────────

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

  const provider = await resolveProvider("shortlist_generation");
  logger.info({ runId, step: "shortlist_generation", provider: provider.name }, "Step dispatched");

  try {
    const top5 = [...evaluations].sort((a, b) => b.score - a.score).slice(0, 5);
    const summaries = (await provider.run({
      step: "shortlist_generation",
      runId,
      jobId,
      payload: { job, insight, evaluations: top5 },
    })) as ShortlistResult[];

    await db.insert(shortlistsTable).values({
      runId,
      jobId,
      rankedCandidateIds: top5.map((c) => c.candidateId),
      summaries,
    });

    await logStep(runId, "shortlist", "completed", { top5Count: top5.length, provider: provider.name }, { summaries });
  } catch (err) {
    await logStep(runId, "shortlist", "failed", {}, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── MAIN RUNNER ───────────────────────────────────────────────────────────────

export async function runWorkflowEngine(runId: number, jobId: number) {
  try {
    await setRunStatus(runId, "running");
    logger.info({ runId, jobId }, "Workflow started");

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) throw new Error(`Job ${jobId} not found`);

    const candidates = await db.select().from(candidatesTable);
    if (candidates.length === 0) {
      logger.warn({ runId }, "No candidates found — skipping matching");
    }

    // Step 1
    const insight = await runJobUnderstanding(runId, jobId, job);
    await db.insert(jobInsightsTable).values({
      runId,
      jobId,
      mustHaveSkills: insight.mustHaveSkills,
      seniority: insight.seniority,
      evaluationCriteria: insight.evaluationCriteria,
      idealCandidateProfile: insight.idealCandidateProfile,
    });

    // Step 2
    if (candidates.length > 0) {
      await runCandidateMatching(runId, jobId, job, insight, candidates);
    }

    // Step 3
    const evaluations = await db
      .select()
      .from(aiEvaluationsTable)
      .where(eq(aiEvaluationsTable.runId, runId));

    const candidateMap = new Map(candidates.map((c) => [c.id, c]));
    const evalWithNames = evaluations.map((e) => ({
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
