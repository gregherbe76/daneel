import { afterEach, describe, expect, it, vi } from "vitest";

// ── Mocks must be installed before importing engine.ts ────────────────────────
const create = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: { completions: { create: (...args: unknown[]) => create(...args) } },
  },
}));
vi.mock("@workspace/integrations-openai-ai-server/batch", () => ({
  batchProcess: async <T, R>(items: T[], fn: (i: T) => Promise<R>) =>
    Promise.all(items.map((i) => fn(i))),
}));

import { eq, inArray } from "drizzle-orm";
import {
  db,
  candidatesTable,
  jobsTable,
  applicationsTable,
  agentRunsTable,
  agentLogsTable,
  aiEvaluationsTable,
  jobInsightsTable,
  shortlistsTable,
} from "@workspace/db";
import { runWorkflowEngine } from "./engine";
import { getLowConfidenceCandidates } from "./index";

const TEST_MARKER = "engine.test:";

const seededJobIds: number[] = [];
const seededCandidateIds: number[] = [];
const seededRunIds: number[] = [];

afterEach(async () => {
  if (seededRunIds.length > 0) {
    await db
      .delete(agentRunsTable)
      .where(inArray(agentRunsTable.id, seededRunIds));
    seededRunIds.length = 0;
  }
  if (seededCandidateIds.length > 0) {
    await db
      .delete(candidatesTable)
      .where(inArray(candidatesTable.id, seededCandidateIds));
    seededCandidateIds.length = 0;
  }
  if (seededJobIds.length > 0) {
    await db.delete(jobsTable).where(inArray(jobsTable.id, seededJobIds));
    seededJobIds.length = 0;
  }
  create.mockReset();
});

function makeOpenAIResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

/**
 * Smart mock that responds to each engine step based on content of the prompt.
 * The engine calls openai.chat.completions.create for:
 *   1. job_understanding (1 call)
 *   2. candidate_matching (one call per candidate, via batchProcess)
 *   3. shortlist_generation (1 call)
 *
 * Note: the matching step pulls EVERY active mock-source candidate in the DB,
 * not just the ones this test seeded — other parallel test files may leave
 * mock candidates around. The mock therefore returns a valid generic match
 * for any prompt it doesn't explicitly recognise so unrelated candidates
 * insert successfully and the test only asserts on its own seeded ids.
 */
function installSmartOpenAIMock() {
  create.mockImplementation(async (args: { messages: { content: string }[] }) => {
    const prompt = args.messages?.[0]?.content ?? "";

    // Job understanding prompt — match on its specific schema marker.
    if (/idealCandidateProfile/.test(prompt) && /mustHaveSkills/.test(prompt)) {
      return makeOpenAIResponse(
        JSON.stringify({
          mustHaveSkills: ["typescript"],
          seniority: "Mid",
          evaluationCriteria: ["criterion"],
          idealCandidateProfile: "ideal",
        }),
      );
    }

    // Shortlist prompt — match on its specific schema marker.
    if (/whyRelevant/.test(prompt) || /finalRecommendation/.test(prompt)) {
      return makeOpenAIResponse(JSON.stringify([]));
    }

    // Otherwise treat as candidate matching — return a valid match shape.
    return makeOpenAIResponse(
      JSON.stringify({
        scoreBreakdown: {
          autonomy: { score: 70, evidence: "e", confidence: 1 },
          productMindset: { score: 70, evidence: "e", confidence: 1 },
          impact: { score: 70, evidence: "e", confidence: 1 },
        },
        fitScore: 70,
        strengths: ["s"],
        gaps: [],
        risks: [],
        recommendation: "Yes",
        confidenceReason: "ok",
        missingDataWarnings: [],
      }),
    );
  });
}

async function seedJob(name: string) {
  const [job] = await db
    .insert(jobsTable)
    .values({
      title: `${TEST_MARKER}${name}`,
      description: "d",
      location: "Remote",
      seniority: "Mid",
      mustHaveSkills: ["typescript"],
    })
    .returning();
  seededJobIds.push(job!.id);
  return job!;
}

async function seedMockCandidate(
  name: string,
  opts: { trashed?: boolean } = {},
) {
  const [c] = await db
    .insert(candidatesTable)
    .values({
      name: `${TEST_MARKER}${name}`,
      skills: ["typescript"],
      summary: "Built and shipped several side projects with measurable user growth.",
      headline: "Senior Engineer",
      source: "Mock",
      ...(opts.trashed
        ? {
            deletedAt: new Date(),
            deletionBatchId: "engine-test-batch",
          }
        : {}),
    })
    .returning();
  seededCandidateIds.push(c!.id);
  return c!;
}

describe("runWorkflowEngine — candidate matching excludes soft-deleted candidates", () => {
  it("only writes ai_evaluations for live candidates, never for trashed ones", async () => {
    const job = await seedJob("matching");
    const live = await seedMockCandidate("live");
    const trashed = await seedMockCandidate("trashed", { trashed: true });

    installSmartOpenAIMock();

    const [run] = await db
      .insert(agentRunsTable)
      .values({ jobId: job.id, status: "pending", dataMode: "mock" })
      .returning();
    seededRunIds.push(run!.id);

    await runWorkflowEngine(run!.id, job.id, {
      dataMode: "mock",
      runSourcing: false,
      runEnrichment: false,
    });

    const evals = await db
      .select()
      .from(aiEvaluationsTable)
      .where(eq(aiEvaluationsTable.runId, run!.id));

    const evaluatedIds = evals.map((e) => e.candidateId);
    expect(evaluatedIds).toContain(live.id);
    expect(evaluatedIds).not.toContain(trashed.id);

    // Sanity-check that the run actually completed (i.e. matching ran, the
    // trashed candidate was excluded at the DB-fetch layer rather than because
    // the whole step failed before evaluating anyone).
    const [refreshedRun] = await db
      .select()
      .from(agentRunsTable)
      .where(eq(agentRunsTable.id, run!.id));
    expect(refreshedRun!.status).toBe("completed");
  });
});

describe("getLowConfidenceCandidates excludes soft-deleted candidates", () => {
  it("does not return trashed candidates even if their evaluation is low-confidence", async () => {
    const job = await seedJob("low-conf");
    const live = await seedMockCandidate("live-low");
    const trashed = await seedMockCandidate("trashed-low", { trashed: true });

    const [run] = await db
      .insert(agentRunsTable)
      .values({ jobId: job.id, status: "completed", dataMode: "mock" })
      .returning();
    seededRunIds.push(run!.id);

    await db.insert(aiEvaluationsTable).values([
      {
        runId: run!.id,
        jobId: job.id,
        candidateId: live.id,
        score: 60,
        fitScore: 60,
        decisionScore: 60,
        dataConfidenceScore: 30, // < 50 → low-confidence
        confidenceLevel: "Low",
        strengths: [],
        gaps: [],
        risks: [],
        recommendation: "Maybe",
      },
      {
        runId: run!.id,
        jobId: job.id,
        candidateId: trashed.id,
        score: 60,
        fitScore: 60,
        decisionScore: 60,
        dataConfidenceScore: 30,
        confidenceLevel: "Low",
        strengths: [],
        gaps: [],
        risks: [],
        recommendation: "Maybe",
      },
    ]);

    const result = await getLowConfidenceCandidates(run!.id);
    const ids = result.map((r) => r.candidateId);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(trashed.id);
  });
});
