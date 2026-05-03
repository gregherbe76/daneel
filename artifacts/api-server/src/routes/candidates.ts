import { Router } from "express";
import { db, candidatesTable, applicationsTable, jobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateCandidateBody,
  UpdateCandidateBody,
  GetCandidateParams,
  UpdateCandidateParams,
  DeleteCandidateParams,
  GetCandidateApplicationsParams,
  RecheckCandidateEmailParams,
} from "@workspace/api-zod";
import { revalidateCandidateEmail } from "../lib/email-revalidation";

const router = Router();

// List all candidates
router.get("/candidates", async (req, res) => {
  const candidates = await db
    .select()
    .from(candidatesTable)
    .orderBy(candidatesTable.createdAt);
  res.json(candidates);
});

// Create a candidate
router.post("/candidates", async (req, res) => {
  const body = CreateCandidateBody.parse(req.body);
  const [candidate] = await db
    .insert(candidatesTable)
    .values({
      name: body.name,
      email: body.email,
      linkedIn: body.linkedIn ?? null,
      summary: body.summary ?? null,
      skills: body.skills,
      // Recruiter-entered emails are first-party — flag as "manual" so the UI
      // shows a trust label rather than leaving the field unlabeled.
      emailSource: body.email ? "manual" : null,
    })
    .returning();
  res.status(201).json(candidate);
});

// Get a candidate by ID
router.get("/candidates/:id", async (req, res) => {
  const { id } = GetCandidateParams.parse({ id: Number(req.params.id) });
  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, id));
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json(candidate);
});

// Update a candidate
router.put("/candidates/:id", async (req, res) => {
  const { id } = UpdateCandidateParams.parse({ id: Number(req.params.id) });
  const body = UpdateCandidateBody.parse(req.body);
  // Keep emailSource in sync when a recruiter edits the email so the trust
  // label always reflects the current value (a recruiter typing in a fresh
  // address overrides any prior provenance like "commit" or "noreply").
  const [candidate] = await db
    .update(candidatesTable)
    .set({
      name: body.name,
      email: body.email,
      linkedIn: body.linkedIn ?? null,
      summary: body.summary ?? null,
      skills: body.skills,
      emailSource: body.email ? "manual" : null,
      updatedAt: new Date(),
    })
    .where(eq(candidatesTable.id, id))
    .returning();
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json(candidate);
});

// Delete a candidate
router.delete("/candidates/:id", async (req, res) => {
  const { id } = DeleteCandidateParams.parse({ id: Number(req.params.id) });
  await db.delete(candidatesTable).where(eq(candidatesTable.id, id));
  res.status(204).send();
});

// Manually re-run the email deliverability check for a single candidate.
// Useful when the recruiter sees a stale "valid" badge and wants to confirm
// the address still resolves before reaching out.
router.post("/candidates/:id/recheck-email", async (req, res) => {
  const { id } = RecheckCandidateEmailParams.parse({ id: Number(req.params.id) });
  const updated = await revalidateCandidateEmail(id);
  if (!updated) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }
  res.json(updated);
});

// Get all applications for a candidate (with job details)
router.get("/candidates/:id/applications", async (req, res) => {
  const { id } = GetCandidateApplicationsParams.parse({
    id: Number(req.params.id),
  });
  const rows = await db
    .select()
    .from(applicationsTable)
    .innerJoin(jobsTable, eq(applicationsTable.jobId, jobsTable.id))
    .innerJoin(
      candidatesTable,
      eq(applicationsTable.candidateId, candidatesTable.id),
    )
    .where(eq(applicationsTable.candidateId, id))
    .orderBy(applicationsTable.createdAt);

  const result = rows.map((r) => ({
    ...r.applications,
    job: r.jobs,
    candidate: r.candidates,
  }));
  res.json(result);
});

export default router;
