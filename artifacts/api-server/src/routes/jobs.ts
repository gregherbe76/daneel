import { Router } from "express";
import { db, jobsTable, DEFAULT_SCORING_WEIGHTS } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import {
  CreateJobBody,
  UpdateJobBody,
  GetJobParams,
  UpdateJobParams,
  DeleteJobParams,
  GetJobApplicationsParams,
} from "@workspace/api-zod";
import { applicationsTable, candidatesTable, activeCandidateFilter } from "@workspace/db";
import { hasRealSourcingProvider } from "./workflows/providers/registry";

const router = Router();

// List all jobs
router.get("/jobs", async (req, res) => {
  const jobs = await db.select().from(jobsTable).orderBy(jobsTable.createdAt);
  // hasRealSourcingProvider is currently a global setting (driven by the
  // sourcing workflow step's assigned provider), so we resolve it once and
  // spread the same value onto every row instead of N+1 queries.
  const realSourcingAvailable = await hasRealSourcingProvider();
  res.json(
    jobs.map((job) => ({ ...job, hasRealSourcingProvider: realSourcingAvailable })),
  );
});

// Create a job
router.post("/jobs", async (req, res) => {
  const body = CreateJobBody.parse(req.body);
  const [job] = await db
    .insert(jobsTable)
    .values({
      title: body.title,
      description: body.description,
      location: body.location,
      seniority: body.seniority,
      mustHaveSkills: body.mustHaveSkills,
      scoringWeights: body.scoringWeights ?? DEFAULT_SCORING_WEIGHTS,
      ...(typeof body.technicalEvaluationEnabled === "boolean"
        ? { technicalEvaluationEnabled: body.technicalEvaluationEnabled }
        : {}),
    })
    .returning();
  const realSourcingAvailable = await hasRealSourcingProvider();
  res.status(201).json({ ...job, hasRealSourcingProvider: realSourcingAvailable });
});

// Get a job by ID
router.get("/jobs/:id", async (req, res) => {
  const { id } = GetJobParams.parse({ id: Number(req.params.id) });
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  // Derived field: drives the workflow kickoff modal's default toggles.
  // When a real sourcing provider is configured the modal pre-selects
  // Real + Run Sourcing on; otherwise it falls back to mock defaults.
  const realSourcingAvailable = await hasRealSourcingProvider();
  res.json({ ...job, hasRealSourcingProvider: realSourcingAvailable });
});

// Update a job
router.put("/jobs/:id", async (req, res) => {
  const { id } = UpdateJobParams.parse({ id: Number(req.params.id) });
  const body = UpdateJobBody.parse(req.body);
  const [job] = await db
    .update(jobsTable)
    .set({
      title: body.title,
      description: body.description,
      location: body.location,
      seniority: body.seniority,
      mustHaveSkills: body.mustHaveSkills,
      // Only overwrite weights when the client explicitly sends them.
      // Omitting the field preserves the job's existing customized weights.
      ...(body.scoringWeights ? { scoringWeights: body.scoringWeights } : {}),
      ...(typeof body.technicalEvaluationEnabled === "boolean"
        ? { technicalEvaluationEnabled: body.technicalEvaluationEnabled }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const realSourcingAvailable = await hasRealSourcingProvider();
  res.json({ ...job, hasRealSourcingProvider: realSourcingAvailable });
});

// Delete a job
router.delete("/jobs/:id", async (req, res) => {
  const { id } = DeleteJobParams.parse({ id: Number(req.params.id) });
  await db.delete(jobsTable).where(eq(jobsTable.id, id));
  res.status(204).send();
});

// Get all applications for a job (with candidate details). Soft-deleted
// candidates are filtered out so the per-job pipeline view stays in sync
// with the global candidate list after a bulk delete.
router.get("/jobs/:id/applications", async (req, res) => {
  const { id } = GetJobApplicationsParams.parse({ id: Number(req.params.id) });
  const rows = await db
    .select()
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .innerJoin(
      candidatesTable,
      eq(applicationsTable.candidateId, candidatesTable.id),
    )
    .where(
      and(
        eq(applicationsTable.jobId, id),
        activeCandidateFilter,
      ),
    )
    .orderBy(applicationsTable.createdAt);

  const realSourcingAvailable = await hasRealSourcingProvider();
  const result = rows.map((r) => ({
    ...r.applications,
    job: { ...r.jobs, hasRealSourcingProvider: realSourcingAvailable },
    candidate: r.candidates,
  }));
  res.json(result);
});

export default router;
