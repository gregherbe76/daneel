import { afterEach, describe, expect, it, vi } from "vitest";

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
  agentRunsTable,
  shortlistsTable,
  technicalEvaluationsTable,
} from "@workspace/db";
import { runShortlist } from "./engine";
import type { JobInsightResult } from "./engine-types";

const TEST_MARKER = "shortlist-boost.integration.test:";

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

async function seed() {
  const [job] = await db
    .insert(jobsTable)
    .values({
      title: `${TEST_MARKER}job`,
      description: "Test job for shortlist boost",
      location: "Remote",
      seniority: "Mid",
      mustHaveSkills: ["typescript"],
    })
    .returning();
  seededJobIds.push(job!.id);

  const candidates = await db
    .insert(candidatesTable)
    .values(
      ["Alice", "Bob", "Charlie", "Dora", "Eva", "Frank"].map((n) => ({
        name: `${TEST_MARKER}${n}`,
        skills: ["typescript"],
        summary: "test",
        source: "Mock" as const,
      })),
    )
    .returning();
  candidates.forEach((c) => seededCandidateIds.push(c.id));

  const [alice, bob, charlie, dora, eva, frank] = candidates;

  const [run] = await db
    .insert(agentRunsTable)
    .values({ jobId: job!.id, status: "running", dataMode: "mock" })
    .returning();
  seededRunIds.push(run!.id);

  return { job: job!, run: run!, alice: alice!, bob: bob!, charlie: charlie!, dora: dora!, eva: eva!, frank: frank! };
}

const stubInsight: JobInsightResult = {
  mustHaveSkills: ["typescript"],
  seniority: "Mid",
  evaluationCriteria: ["criterion"],
  idealCandidateProfile: "ideal",
};

describe("Phase 4.3 — CodeMatch boost integration (engine.runShortlist)", () => {
  it("boosts ranking, persists new fields, caps at 100, and leaves no-tech candidates unboosted", async () => {
    const { job, run, alice, bob, charlie, dora, eva, frank } = await seed();

    // Pre-seed technical_evaluations rows BEFORE runShortlist queries them.
    // Mirrors what runTechnicalEvaluation would have written upstream.
    await db.insert(technicalEvaluationsTable).values([
      {
        runId: run.id,
        jobId: job.id,
        candidateId: alice.id,
        evaluated: true,
        providerName: "test",
        providerType: "test",
        scores: { technical_depth: 90, ownership: 90, consistency: 90, taste: 90, impact: 90, overall: 90 },
      },
      {
        runId: run.id,
        jobId: job.id,
        candidateId: bob.id,
        evaluated: true,
        providerName: "test",
        providerType: "test",
        scores: { technical_depth: 80, ownership: 80, consistency: 80, taste: 80, impact: 80, overall: 80 },
      },
      {
        runId: run.id,
        jobId: job.id,
        candidateId: charlie.id,
        evaluated: true,
        providerName: "test",
        providerType: "test",
        scores: { technical_depth: 100, ownership: 100, consistency: 100, taste: 100, impact: 100, overall: 100 },
      },
      // Dora & Eva: NO tech eval row at all → bonus 0 (no-penalty rule)
      // Frank: cap test (matching=95 + bonus 20 → final capped to 100)
      {
        runId: run.id,
        jobId: job.id,
        candidateId: frank.id,
        evaluated: true,
        providerName: "test",
        providerType: "test",
        scores: { technical_depth: 100, ownership: 100, consistency: 100, taste: 100, impact: 100, overall: 100 },
      },
    ]);

    // Smart shortlist mock — engine asks the provider for narratives only.
    // Prompt format (hiringai template): "1. <candidateName> (Score: NN, ..."
    // We extract names + the boosted score the engine actually passed so we
    // can ALSO verify that provider receives the BOOSTED finalScore (Phase 4.3
    // contract: LLM narratives anchored to the displayed ranking).
    const nameToId = new Map<string, number>([
      ["Alice", alice.id], ["Bob", bob.id], ["Charlie", charlie.id],
      ["Dora", dora.id], ["Eva", eva.id], ["Frank", frank.id],
    ]);
    const seenScoresByName = new Map<string, number>();
    create.mockImplementation(async (args: { messages: { content: string }[] }) => {
      const prompt = args.messages?.[0]?.content ?? "";
      const matches = [...prompt.matchAll(/^\d+\.\s+(?:[^\(]*?)([A-Z][a-z]+)\s+\(Score:\s+(\d+)/gm)];
      const result = matches
        .map(([, name, scoreStr]) => {
          seenScoresByName.set(name!, Number(scoreStr));
          const id = nameToId.get(name!);
          if (id === undefined) return null;
          return {
            candidateId: id,
            candidateName: name,
            whyRelevant: "stub",
            keyRisks: "stub",
            finalRecommendation: "Interview now.",
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return makeOpenAIResponse(JSON.stringify(result));
    });

    // Evaluations passed to runShortlist — the matching baseline.
    const evaluations = [
      { candidateId: alice.id, candidateName: "Alice", score: 80, recommendation: "Yes", strengths: [], gaps: [] },
      { candidateId: bob.id, candidateName: "Bob", score: 80, recommendation: "Yes", strengths: [], gaps: [] },
      { candidateId: charlie.id, candidateName: "Charlie", score: 70, recommendation: "Maybe", strengths: [], gaps: [] },
      { candidateId: dora.id, candidateName: "Dora", score: 85, recommendation: "Yes", strengths: [], gaps: [] },
      { candidateId: eva.id, candidateName: "Eva", score: 60, recommendation: "Maybe", strengths: [], gaps: [] },
      { candidateId: frank.id, candidateName: "Frank", score: 95, recommendation: "Yes", strengths: [], gaps: [] },
    ];

    await runShortlist(run.id, job.id, { title: job.title, description: job.description }, stubInsight, evaluations);

    // ── Assert persisted shortlist row ────────────────────────────────────
    const [persisted] = await db
      .select()
      .from(shortlistsTable)
      .where(eq(shortlistsTable.runId, run.id));
    expect(persisted).toBeDefined();

    const order = persisted!.rankedCandidateIds;
    // Expected boosted order (top 5):
    //   Frank   95 + 20 capped = 100
    //   Alice   80 + 18        =  98
    //   Bob     80 + 16        =  96
    //   Charlie 70 + 20        =  90
    //   Dora    85 +  0        =  85   ← unboosted but still in top 5
    //   Eva     60 +  0        =  60   ← cut (top 5 only)
    expect(order).toEqual([frank.id, alice.id, bob.id, charlie.id, dora.id]);

    // Verify Charlie (matching=70 + boost) ranks ABOVE Dora (matching=85, no boost).
    // This is THE key behaviour change of Phase 4.3.
    expect(order.indexOf(charlie.id)).toBeLessThan(order.indexOf(dora.id));

    // ── Assert per-summary new fields ─────────────────────────────────────
    const summariesById = new Map((persisted!.summaries ?? []).map((s) => [s.candidateId, s]));

    const aliceSummary = summariesById.get(alice.id)!;
    expect(aliceSummary.matchingScore).toBe(80);
    expect(aliceSummary.codematchOverall).toBe(90);
    expect(aliceSummary.bonusApplied).toBe(18);
    expect(aliceSummary.finalScore).toBe(98);
    expect(aliceSummary.techEvaluated).toBe(true);

    // Frank — cap at 100
    const frankSummary = summariesById.get(frank.id)!;
    expect(frankSummary.matchingScore).toBe(95);
    expect(frankSummary.codematchOverall).toBe(100);
    expect(frankSummary.bonusApplied).toBe(20);
    expect(frankSummary.finalScore).toBe(100); // capped (95 + 20 = 115 → 100)
    expect(frankSummary.techEvaluated).toBe(true);

    // Dora — no tech eval, no boost, no penalty
    const doraSummary = summariesById.get(dora.id)!;
    expect(doraSummary.matchingScore).toBe(85);
    expect(doraSummary.codematchOverall).toBeNull();
    expect(doraSummary.bonusApplied).toBe(0);
    expect(doraSummary.finalScore).toBe(85);
    expect(doraSummary.techEvaluated).toBe(false);

    // ── Provider received BOOSTED scores (Phase 4.3 contract) ─────────────
    // The LLM narratives must be anchored to the ranking the recruiter sees.
    expect(seenScoresByName.get("Alice")).toBe(98);
    expect(seenScoresByName.get("Frank")).toBe(100);
    expect(seenScoresByName.get("Charlie")).toBe(90);
    expect(seenScoresByName.get("Dora")).toBe(85); // unboosted == matching
  });

  it("backward compat: a run without ANY technical_evaluations behaves identically to pre-4.3", async () => {
    const { job, run, alice, bob, charlie } = await seed();
    // Intentionally no technical_evaluations rows.

    create.mockImplementation(async (args: { messages: { content: string }[] }) => {
      const prompt = args.messages?.[0]?.content ?? "";
      const m = prompt.match(/candidateId[^\d]+(\d+)/g) ?? [];
      const ids = m.map((s) => Number(s.match(/(\d+)/)![1]));
      return makeOpenAIResponse(
        JSON.stringify(
          ids.map((id) => ({
            candidateId: id,
            whyRelevant: "stub",
            keyRisks: [],
            suggestedNextStep: "interview",
            finalRecommendation: "Interview" as const,
          })),
        ),
      );
    });

    const evaluations = [
      { candidateId: alice.id, candidateName: "Alice", score: 50, recommendation: "Maybe", strengths: [], gaps: [] },
      { candidateId: bob.id, candidateName: "Bob", score: 90, recommendation: "Yes", strengths: [], gaps: [] },
      { candidateId: charlie.id, candidateName: "Charlie", score: 70, recommendation: "Maybe", strengths: [], gaps: [] },
    ];

    await runShortlist(run.id, job.id, { title: job.title, description: job.description }, stubInsight, evaluations);

    const [persisted] = await db
      .select()
      .from(shortlistsTable)
      .where(eq(shortlistsTable.runId, run.id));

    // Pure matching order, identical to pre-4.3 behaviour.
    expect(persisted!.rankedCandidateIds).toEqual([bob.id, charlie.id, alice.id]);

    // New fields are present but bonusApplied=0, techEvaluated=false everywhere.
    for (const s of persisted!.summaries ?? []) {
      expect(s.bonusApplied).toBe(0);
      expect(s.techEvaluated).toBe(false);
      expect(s.codematchOverall).toBeNull();
      expect(s.finalScore).toBe(s.matchingScore);
    }
  });
});
