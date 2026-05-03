import { Router } from "express";
import {
  db,
  applicationsTable,
  jobsTable,
  candidatesTable,
} from "@workspace/db";
import { eq, count, sql, isNull, and } from "drizzle-orm";
import {
  CreateApplicationBody,
  UpdateApplicationBody,
  GetApplicationParams,
  UpdateApplicationParams,
  DeleteApplicationParams,
} from "@workspace/api-zod";
import { hasRealSourcingProvider } from "./workflows/providers/registry";

const router = Router();

// Helper: join row to ApplicationWithDetails. The embedded `job` carries the
// derived `hasRealSourcingProvider` flag (a global setting) so the OpenAPI
// `Job` schema's required field is always present on nested responses.
function toWithDetails(
  r: {
    applications: typeof applicationsTable.$inferSelect;
    jobs: typeof jobsTable.$inferSelect;
    candidates: typeof candidatesTable.$inferSelect;
  },
  realSourcingAvailable: boolean,
) {
  return {
    ...r.applications,
    job: { ...r.jobs, hasRealSourcingProvider: realSourcingAvailable },
    candidate: r.candidates,
  };
}

// List all applications with details. Soft-deleted candidates are filtered
// out via the inner join's WHERE so a recruiter who just bulk-deleted
// candidates doesn't keep seeing their applications in pipeline-style views
// while the trash retention window has not yet elapsed.
router.get("/applications", async (req, res) => {
  const rows = await db
    .select()
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .innerJoin(
      candidatesTable,
      eq(applicationsTable.candidateId, candidatesTable.id),
    )
    .where(isNull(candidatesTable.deletedAt))
    .orderBy(applicationsTable.createdAt);
  const realSourcingAvailable = await hasRealSourcingProvider();
  res.json(rows.map((r) => toWithDetails(r, realSourcingAvailable)));
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

// Get a single application with details. If the linked candidate has been
// soft-deleted we report the application as not found — recruiters expect a
// trashed candidate's application records to be invisible too, even though
// the FK row is still on disk waiting for the trash sweep.
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
    .where(
      and(eq(applicationsTable.id, id), isNull(candidatesTable.deletedAt)),
    );
  if (!rows.length) {
    res.status(404).json({ error: "Application not found" });
    return;
  }
  const realSourcingAvailable = await hasRealSourcingProvider();
  res.json(toWithDetails(rows[0], realSourcingAvailable));
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
  // Soft-deleted candidates (and any application that hangs off them) are
  // excluded from the headline counts so the pipeline summary matches what
  // the recruiter sees in the candidate list after a bulk delete.
  const [totalCandidates] = await db
    .select({ count: count() })
    .from(candidatesTable)
    .where(isNull(candidatesTable.deletedAt));
  const [totalApplications] = await db
    .select({ count: count() })
    .from(applicationsTable)
    .innerJoin(
      candidatesTable,
      eq(applicationsTable.candidateId, candidatesTable.id),
    )
    .where(isNull(candidatesTable.deletedAt));

  const stageCounts = await db
    .select({
      stage: applicationsTable.stage,
      count: count(),
    })
    .from(applicationsTable)
    .innerJoin(
      candidatesTable,
      eq(applicationsTable.candidateId, candidatesTable.id),
    )
    .where(isNull(candidatesTable.deletedAt))
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
