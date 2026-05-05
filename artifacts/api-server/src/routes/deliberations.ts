import { Router } from "express";
import {
  db,
  agentProvidersTable,
  candidatesTable,
  jobsTable,
  applicationsTable,
  deliberationsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { CreateDeliberationBody } from "@workspace/api-zod";
import { resolveDecisionProvider, decisionProviderFromRow, DecisionQuotaExceededError } from "./workflows/providers";
import { logger } from "../lib/logger";

const router = Router();

/**
 * POST /deliberations — Run an ad-hoc Council deliberation for a single
 * (candidate, job) pair, outside of a workflow run. Used by the Council tab
 * on the candidate detail page.
 */
router.post("/deliberations", async (req, res) => {
  const body = CreateDeliberationBody.parse(req.body);

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.id, body.candidateId));
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, body.jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Resolve the decision provider. Honour an explicit providerId if supplied,
  // otherwise use whichever provider is wired to the `decision` step.
  let provider;
  if (body.providerId != null) {
    const [row] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, body.providerId));
    if (!row) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    if (row.type !== "council") {
      res.status(400).json({ error: `Provider "${row.name}" is not a council provider` });
      return;
    }
    provider = decisionProviderFromRow(row);
  } else {
    provider = await resolveDecisionProvider();
    if (!provider) {
      res.status(400).json({
        error:
          "No Council provider is configured for the decision step. Add one in Settings → Providers and assign it to the Decision step.",
      });
      return;
    }
  }

  // Find the application stage (best-effort).
  const [application] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.candidateId, body.candidateId), eq(applicationsTable.jobId, body.jobId)));

  const stage = body.stage ?? application?.stage ?? "Screening";

  const [delibRow] = await db
    .insert(deliberationsTable)
    .values({
      candidateId: body.candidateId,
      jobId: body.jobId,
      stage,
      status: "running",
    })
    .returning();

  try {
    const result = await provider.deliberate({
      candidate: {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email ?? null,
        headline: candidate.headline ?? null,
        summary: candidate.summary ?? null,
        skills: (candidate.skills ?? []) as string[],
        linkedIn: candidate.linkedIn ?? null,
        githubUrl: candidate.githubUrl ?? null,
        location: candidate.location ?? null,
        currentCompany: candidate.currentCompany ?? null,
      },
      jd: {
        id: job.id,
        title: job.title,
        description: job.description,
        seniority: job.seniority ?? null,
        mustHaveSkills: (job.mustHaveSkills ?? []) as string[],
        location: job.location ?? null,
      },
      // Cast: stage column is free-text; provider input expects DeliberationStage.
      stage: stage as "Sourced" | "Screening" | "Interview" | "Offer" | "Hired",
    });

    const [updated] = await db
      .update(deliberationsTable)
      .set({ status: "completed", result, updatedAt: new Date() })
      .where(eq(deliberationsTable.id, delibRow.id))
      .returning();
    res.status(201).json(updated);
  } catch (err) {
    const isQuota = err instanceof DecisionQuotaExceededError;
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(deliberationsTable)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(deliberationsTable.id, delibRow.id));

    if (isQuota) {
      // Surface a structured 402 so the UI can show the upgrade CTA without
      // string-matching the error message.
      res.status(402).json({
        error: message,
        code: "QUOTA_EXCEEDED",
        upgradeUrl: (err as DecisionQuotaExceededError).upgradeUrl ?? null,
        deliberationId: delibRow.id,
      });
      return;
    }

    logger.error({ candidateId: body.candidateId, jobId: body.jobId, err }, "Ad-hoc deliberation failed");
    res.status(502).json({ error: message, deliberationId: delibRow.id });
  }
});

/** GET /deliberations/:id */
router.get("/deliberations/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db.select().from(deliberationsTable).where(eq(deliberationsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

/** GET /candidates/:id/deliberations?jobId=… — history list for the Council tab. */
router.get("/candidates/:id/deliberations", async (req, res) => {
  const candidateId = parseInt(req.params.id, 10);
  if (Number.isNaN(candidateId)) {
    res.status(400).json({ error: "Invalid candidate id" });
    return;
  }
  const jobIdRaw = req.query.jobId;
  const jobId = typeof jobIdRaw === "string" ? parseInt(jobIdRaw, 10) : NaN;

  const where = Number.isNaN(jobId)
    ? eq(deliberationsTable.candidateId, candidateId)
    : and(eq(deliberationsTable.candidateId, candidateId), eq(deliberationsTable.jobId, jobId));

  const rows = await db
    .select()
    .from(deliberationsTable)
    .where(where)
    .orderBy(desc(deliberationsTable.createdAt));
  res.json(rows);
});

export default router;
