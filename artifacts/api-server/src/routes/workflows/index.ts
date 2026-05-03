import { Router } from "express";
import {
  db,
  agentRunsTable,
  agentLogsTable,
  aiEvaluationsTable,
  jobInsightsTable,
  shortlistsTable,
  candidatesTable,
} from "@workspace/db";
import { eq, desc, inArray, and } from "drizzle-orm";
import { RunWorkflowBody } from "@workspace/api-zod";
import type { DataMode } from "@workspace/db";
import { z } from "zod";
import { runWorkflowEngine } from "./engine";

const router = Router();

// POST /workflows/run — create run and kick off async workflow
router.post("/workflows/run", async (req, res) => {
  const body = RunWorkflowBody.parse(req.body);
  const runSourcing = body.runSourcing ?? false;
  const runEnrichment = (body as { runEnrichment?: boolean }).runEnrichment ?? false;
  const dataMode: DataMode = (body as { dataMode?: DataMode }).dataMode ?? "mock";

  const [run] = await db
    .insert(agentRunsTable)
    .values({ jobId: body.jobId, status: "pending", runSourcing, dataMode })
    .returning();

  setImmediate(() => runWorkflowEngine(run.id, body.jobId, { runSourcing, runEnrichment, dataMode }));

  res.status(201).json(run);
});

// POST /workflows/run-variant — create variant run with modified criteria
const DATA_MODE_VALUES = ["real", "mock", "fallback"] as const;

const RunVariantBodySchema = z.object({
  jobId: z.number().int(),
  baseRunId: z.number().int(),
  variantLabel: z.string().optional().nullable(),
  variantCriteria: z.object({
    seniority: z.string().optional().nullable(),
    mustHaveSkills: z.array(z.string()).optional().nullable(),
    focusNote: z.string().optional().nullable(),
  }),
  dataMode: z.enum(DATA_MODE_VALUES).optional(),
  runSourcing: z.boolean().optional(),
  runEnrichment: z.boolean().optional(),
});

router.post("/workflows/run-variant", async (req, res) => {
  const { jobId, baseRunId, variantLabel, variantCriteria, dataMode, runSourcing, runEnrichment } = RunVariantBodySchema.parse(req.body);
  const effectiveDataMode: DataMode = dataMode ?? "mock";

  const [run] = await db
    .insert(agentRunsTable)
    .values({
      jobId,
      status: "pending",
      runSourcing: runSourcing ?? false,
      dataMode: effectiveDataMode,
      variantOf: baseRunId,
      variantLabel: variantLabel ?? null,
      variantCriteria: {
        seniority: variantCriteria.seniority ?? undefined,
        mustHaveSkills: variantCriteria.mustHaveSkills ?? undefined,
        focusNote: variantCriteria.focusNote ?? undefined,
      },
    })
    .returning();

  setImmediate(() =>
    runWorkflowEngine(run.id, jobId, {
      dataMode: effectiveDataMode,
      runSourcing: runSourcing ?? false,
      runEnrichment: runEnrichment ?? false,
      variantCriteria: {
        seniority: variantCriteria.seniority ?? undefined,
        mustHaveSkills: variantCriteria.mustHaveSkills ?? undefined,
        focusNote: variantCriteria.focusNote ?? undefined,
      },
    }),
  );

  res.status(201).json(run);
});

// GET /workflows/runs — list all runs
router.get("/workflows/runs", async (_req, res) => {
  const runs = await db
    .select()
    .from(agentRunsTable)
    .orderBy(desc(agentRunsTable.createdAt));
  res.json(runs);
});

// GET /workflows/jobs/:jobId/runs — list all runs for a job.
// We also attach the sourcing-step breakdown (search hits / dropped / returned)
// for each run that included sourcing, so the UI can show the same filter
// drop-off explanation on historical runs — not just the latest one.
router.get("/workflows/jobs/:jobId/runs", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);
  const runs = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.jobId, jobId))
    .orderBy(desc(agentRunsTable.createdAt));

  const sourcingRunIds = runs.filter((r) => r.runSourcing).map((r) => r.id);
  type SourcingLogRow = {
    runId: number;
    status: string;
    output: unknown;
    createdAt: Date;
    id: number;
  };
  let sourcingLogs: SourcingLogRow[] = [];
  if (sourcingRunIds.length > 0) {
    // Restrict to the sourcing step explicitly — a run may have multiple
    // completed step logs (insight, sourcing, scoring, …) and we only want
    // sourcing's output. Order by createdAt/id so selection is deterministic.
    sourcingLogs = (await db
      .select({
        runId: agentLogsTable.runId,
        status: agentLogsTable.status,
        output: agentLogsTable.output,
        createdAt: agentLogsTable.createdAt,
        id: agentLogsTable.id,
      })
      .from(agentLogsTable)
      .where(
        and(
          inArray(agentLogsTable.runId, sourcingRunIds),
          eq(agentLogsTable.step, "sourcing"),
        ),
      )
      .orderBy(agentLogsTable.createdAt, agentLogsTable.id)) as SourcingLogRow[];
  }
  // Pick the most informative sourcing log per run (completed > failed >
  // running > pending). Ties are broken by the most recent row, which is
  // deterministic because the query above is ordered.
  const stepRank: Record<string, number> = {
    completed: 4,
    failed: 3,
    running: 2,
    pending: 1,
  };
  const sourcingByRun = new Map<number, SourcingLogRow>();
  for (const row of sourcingLogs) {
    const prev = sourcingByRun.get(row.runId);
    if (!prev || (stepRank[row.status] ?? 0) >= (stepRank[prev.status] ?? 0)) {
      sourcingByRun.set(row.runId, row);
    }
  }

  const enriched = runs.map((r) => {
    if (!r.runSourcing) return r;
    const log = sourcingByRun.get(r.id);
    if (!log) return r;
    const out = (log.output ?? null) as {
      stats?: unknown;
      saved?: number;
      error?: string;
    } | null;
    return {
      ...r,
      sourcingStatus: log.status,
      sourcingStats: out?.stats ?? null,
      sourcingSaved: typeof out?.saved === "number" ? out.saved : null,
      sourcingError: typeof out?.error === "string" ? out.error : null,
    };
  });

  res.json(enriched);
});

// GET /workflows/runs/:id — get run with logs
router.get("/workflows/runs/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [run] = await db.select().from(agentRunsTable).where(eq(agentRunsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const logs = await db
    .select()
    .from(agentLogsTable)
    .where(eq(agentLogsTable.runId, id))
    .orderBy(agentLogsTable.createdAt);
  res.json({ ...run, logs });
});

// GET /workflows/jobs/:jobId/latest — get latest run + full results for a job
router.get("/workflows/jobs/:jobId/latest", async (req, res) => {
  const jobId = parseInt(req.params.jobId, 10);

  const [run] = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.jobId, jobId))
    .orderBy(desc(agentRunsTable.createdAt))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: "No runs found for this job" });
    return;
  }

  const [logs, evaluations, insightRows, shortlistRows, candidates] =
    await Promise.all([
      db.select().from(agentLogsTable).where(eq(agentLogsTable.runId, run.id)).orderBy(agentLogsTable.createdAt),
      db.select().from(aiEvaluationsTable).where(eq(aiEvaluationsTable.runId, run.id)),
      db.select().from(jobInsightsTable).where(eq(jobInsightsTable.runId, run.id)).limit(1),
      db.select().from(shortlistsTable).where(eq(shortlistsTable.runId, run.id)).limit(1),
      db.select().from(candidatesTable),
    ]);

  const candidateMap = new Map(candidates.map(c => [c.id, c]));

  const evaluationsWithCandidates = evaluations.map(e => ({
    ...e,
    candidate: candidateMap.get(e.candidateId),
  }));

  const sourcingLog = logs.find(l => l.step === "sourcing" && l.status === "completed");
  let sourcedCandidates: typeof candidates = [];
  if (sourcingLog && run.runSourcing) {
    const sourcedRows = candidates.filter(c => c.source === "AI Generated / Mock Sourcing");
    if (sourcedRows.length > 0) {
      const { applicationsTable } = await import("@workspace/db");
      const apps = await db
        .select({ candidateId: applicationsTable.candidateId })
        .from(applicationsTable)
        .where(eq(applicationsTable.jobId, jobId));
      const appCandidateIds = new Set(apps.map(a => a.candidateId));
      sourcedCandidates = sourcedRows.filter(c => appCandidateIds.has(c.id));
    }
  }

  res.json({
    run,
    insight: insightRows[0] ?? null,
    evaluations: evaluationsWithCandidates,
    shortlist: shortlistRows[0] ?? null,
    sourcedCandidates,
    logs,
  });
});

// ── Helper: detect low-confidence candidates for a run ────────────────────────

export async function getLowConfidenceCandidates(runId: number): Promise<{ candidateId: number; candidateName: string }[]> {
  const evaluations = await db
    .select({
      candidateId: aiEvaluationsTable.candidateId,
      confidenceLevel: aiEvaluationsTable.confidenceLevel,
      dataConfidenceScore: aiEvaluationsTable.dataConfidenceScore,
      requiresEnrichment: aiEvaluationsTable.requiresEnrichment,
    })
    .from(aiEvaluationsTable)
    .where(eq(aiEvaluationsTable.runId, runId));

  const lowConfIds = evaluations
    .filter(
      (e) =>
        e.confidenceLevel === "Low" ||
        (e.dataConfidenceScore !== null && e.dataConfidenceScore < 50) ||
        e.requiresEnrichment === true,
    )
    .map((e) => e.candidateId);

  if (lowConfIds.length === 0) return [];

  const candidates = await db
    .select({ id: candidatesTable.id, name: candidatesTable.name })
    .from(candidatesTable)
    .where(inArray(candidatesTable.id, lowConfIds));

  return candidates.map((c) => ({ candidateId: c.id, candidateName: c.name }));
}

// POST /workflows/improve-and-rerun — enrich low-confidence candidates and re-run
const ImproveAndRerunBodySchema = z.object({
  runId: z.number().int(),
});

router.post("/workflows/improve-and-rerun", async (req, res) => {
  const { runId } = ImproveAndRerunBodySchema.parse(req.body);

  const [previousRun] = await db
    .select()
    .from(agentRunsTable)
    .where(eq(agentRunsTable.id, runId));

  if (!previousRun) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  if (previousRun.status !== "completed") {
    res.status(400).json({ error: "Run is not completed — can only improve a completed run" });
    return;
  }

  const lowConfCandidates = await getLowConfidenceCandidates(runId);

  if (lowConfCandidates.length === 0) {
    res.status(400).json({ error: "No low-confidence candidates found in this run — nothing to improve" });
    return;
  }

  const targetCandidateIds = lowConfCandidates.map((c) => c.candidateId);

  const [newRun] = await db
    .insert(agentRunsTable)
    .values({
      jobId: previousRun.jobId,
      status: "pending",
      runSourcing: false,
      dataMode: previousRun.dataMode,
      variantOf: runId,
      variantLabel: "Improved Run",
    })
    .returning();

  setImmediate(() =>
    runWorkflowEngine(newRun.id, previousRun.jobId, {
      dataMode: previousRun.dataMode,
      runSourcing: false,
      runEnrichment: true,
      targetCandidateIds,
    }),
  );

  res.status(201).json({
    run: newRun,
    previousRunId: runId,
    lowConfidenceCandidateCount: lowConfCandidates.length,
  });
});

export default router;
