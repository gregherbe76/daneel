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
import { eq, desc, inArray } from "drizzle-orm";
import { RunWorkflowBody } from "@workspace/api-zod";
import { runWorkflowEngine } from "./engine";

const router = Router();

// POST /workflows/run — create run and kick off async workflow
router.post("/workflows/run", async (req, res) => {
  const { jobId, runSourcing } = RunWorkflowBody.parse(req.body);

  const [run] = await db
    .insert(agentRunsTable)
    .values({ jobId, status: "pending", runSourcing: runSourcing ?? false })
    .returning();

  // Fire-and-forget — respond immediately, engine runs in background
  setImmediate(() => runWorkflowEngine(run.id, jobId, { runSourcing: runSourcing ?? false }));

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

  // Find sourced candidates: those created during this run's sourcing step
  // We identify them from the sourcing log output
  const sourcingLog = logs.find(l => l.step === "sourcing" && l.status === "completed");
  let sourcedCandidates: typeof candidates = [];
  if (sourcingLog && run.runSourcing) {
    // All candidates with source = "AI Generated / Mock Sourcing" that appear in applications for this job
    // We use the agent_logs sourcing output to get created candidate IDs — but as a fallback, show all AI-sourced candidates for this job
    const sourcedRows = candidates.filter(c => c.source === "AI Generated / Mock Sourcing");
    // Only include those that have applications for this job
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

export default router;
