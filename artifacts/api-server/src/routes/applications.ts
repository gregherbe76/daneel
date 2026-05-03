import { Router } from "express";
import {
  db,
  applicationsTable,
  jobsTable,
  candidatesTable,
} from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import {
  CreateApplicationBody,
  UpdateApplicationBody,
  GetApplicationParams,
  UpdateApplicationParams,
  DeleteApplicationParams,
} from "@workspace/api-zod";

const router = Router();

// Helper: join row to ApplicationWithDetails
function toWithDetails(r: {
  applications: typeof applicationsTable.$inferSelect;
  jobs: typeof jobsTable.$inferSelect;
  candidates: typeof candidatesTable.$inferSelect;
}) {
  return {
    ...r.applications,
    job: r.jobs,
    candidate: r.candidates,
  };
}

// List all applications with details
router.get("/applications", async (req, res) => {
  const rows = await db
    .select()
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .innerJoin(
      candidatesTable,
      eq(applicationsTable.candidateId, candidatesTable.id),
    )
    .orderBy(applicationsTable.createdAt);
  res.json(rows.map(toWithDetails));
});

// Create an application
router.post("/applications", async (req, res) => {
  const body = CreateApplicationBody.parse(req.body);
  const [application] = await db
    .insert(applicationsTable)
    .values({
      jobId: body.jobId,
      candidateId: body.candidateId,
      stage: body.stage,
      notes: body.notes ?? null,
    })
    .returning();
  res.status(201).json(application);
});

// Get a single application with details
router.get("/applications/:id", async (req, res) => {
  const { id } = GetApplicationParams.parse({ id: Number(req.params.id) });
  const rows = await db
    .select()
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .innerJoin(
      candidatesTable,
      eq(applicationsTable.candidateId, candidatesTable.id),
    )
    .where(eq(applicationsTable.id, id));
  if (!rows.length) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  res.json(toWithDetails(rows[0]));
});

// Update an application (stage, notes)
router.put("/applications/:id", async (req, res) => {
  const { id } = UpdateApplicationParams.parse({ id: Number(req.params.id) });
  const body = UpdateApplicationBody.parse(req.body);
  const [application] = await db
    .update(applicationsTable)
    .set({
      stage: body.stage,
      notes: body.notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(applicationsTable.id, id))
    .returning();
  if (!application) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  res.json(application);
});

// Delete an application
router.delete("/applications/:id", async (req, res) => {
  const { id } = DeleteApplicationParams.parse({ id: Number(req.params.id) });
  await db.delete(applicationsTable).where(eq(applicationsTable.id, id));
  res.status(204).send();
});

// Pipeline summary
const STAGES = [
  "Sourced",
  "Contacted",
  "Screened",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
] as const;

router.get("/pipeline/summary", async (req, res) => {
  const [totalJobs] = await db
    .select({ count: count() })
    .from(jobsTable);
  const [totalCandidates] = await db
    .select({ count: count() })
    .from(candidatesTable);
  const [totalApplications] = await db
    .select({ count: count() })
    .from(applicationsTable);

  const stageCounts = await db
    .select({
      stage: applicationsTable.stage,
      count: count(),
    })
    .from(applicationsTable)
    .groupBy(applicationsTable.stage);

  const byStage = STAGES.map((stage) => ({
    stage,
    count: stageCounts.find((s) => s.stage === stage)?.count ?? 0,
  }));

  res.json({
    totalJobs: totalJobs.count,
    totalCandidates: totalCandidates.count,
    totalApplications: totalApplications.count,
    byStage,
  });
});

export default router;
