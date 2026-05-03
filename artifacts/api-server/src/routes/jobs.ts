import { Router } from "express";
import { db, jobsTable, DEFAULT_SCORING_WEIGHTS } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  CreateJobBody,
  UpdateJobBody,
  GetJobParams,
  UpdateJobParams,
  DeleteJobParams,
  GetJobApplicationsParams,
} from "@workspace/api-zod";
import { applicationsTable, candidatesTable } from "@workspace/db";

const router = Router();

// List all jobs
router.get("/jobs", async (req, res) => {
  const jobs = await db.select().from(jobsTable).orderBy(jobsTable.createdAt);
  res.json(jobs);
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
    })
    .returning();
  res.status(201).json(job);
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
  res.json(job);
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
      updatedAt: new Date(),
    })
    .where(eq(jobsTable.id, id))
    .returning();
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

// Delete a job
router.delete("/jobs/:id", async (req, res) => {
  const { id } = DeleteJobParams.parse({ id: Number(req.params.id) });
  await db.delete(jobsTable).where(eq(jobsTable.id, id));
  res.status(204).send();
});

// Get all applications for a job (with candidate details)
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
    .where(eq(applicationsTable.jobId, id))
    .orderBy(applicationsTable.createdAt);

  const result = rows.map((r) => ({
    ...r.applications,
    job: r.jobs,
    candidate: r.candidates,
  }));
  res.json(result);
});

export default router;
