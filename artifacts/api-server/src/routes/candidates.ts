import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, candidatesTable, applicationsTable, jobsTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  CreateCandidateBody,
  UpdateCandidateBody,
  GetCandidateParams,
  UpdateCandidateParams,
  DeleteCandidateParams,
  GetCandidateApplicationsParams,
  RecheckCandidateEmailParams,
  BulkCandidateActionBody,
  EnqueueBulkCandidateJobBody,
  GetBulkCandidateJobParams,
  RestoreCandidateBatchBody,
  RestoreCandidatesByIdsBody,
} from "@workspace/api-zod";
import { isNotNull, sql } from "drizzle-orm";
import { revalidateCandidateEmail } from "../lib/email-revalidation";
import {
  RETENTION_MS,
  purgeExpiredSoftDeletedCandidates,
} from "../lib/candidate-trash";
import { hasRealSourcingProvider } from "./workflows/providers/registry";
import {
  enqueueBulkJob,
  getBulkJob,
  listActiveBulkJobs,
  cancelBulkJob,
  type BulkJobAction,
} from "../lib/bulk-jobs";
import type { BulkJob } from "@workspace/db";

const router = Router();

// List all candidates. Soft-deleted rows (in the trash bin awaiting either an
// "Undo" toast restore or the retention sweeper) are hidden so recruiters
// don't see the candidates they just deleted come back the next time the list
// reloads.
router.get("/candidates", async (req, res) => {
  const candidates = await db
    .select()
    .from(candidatesTable)
    .where(isNull(candidatesTable.deletedAt))
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

// Background bulk-job endpoints. Registered ABOVE `/candidates/:id` so the
// `/candidates/bulk-jobs[/:id]` paths aren't swallowed by the `:id` matcher.
function serializeBulkJob(job: BulkJob) {
  const result = (job.result ?? {}) as { csv?: string; results?: unknown[] };
  return {
    id: job.id,
    action: job.action as BulkJobAction,
    status: job.status as
      | "pending"
      | "running"
      | "completed"
      | "failed"
      | "canceled",
    total: job.total,
    processed: job.processed,
    skipped: job.skipped,
    payload: job.payload ?? null,
    csv: typeof result.csv === "string" ? result.csv : null,
    results: Array.isArray(result.results) ? (result.results as never[]) : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

router.post("/candidates/bulk-jobs", async (req, res) => {
  const body = EnqueueBulkCandidateJobBody.parse(req.body);
  if (body.action === "move-stage") {
    const jobId = body.payload?.jobId;
    const stage = body.payload?.stage;
    if (!jobId || !stage) {
      res.status(400).json({
        error: "move-stage requires payload.jobId and payload.stage",
      });
      return;
    }
  }
  const job = await enqueueBulkJob({
    action: body.action,
    ids: body.ids,
    payload: body.payload ?? null,
  });
  res.status(201).json(serializeBulkJob(job));
});

router.get("/candidates/bulk-jobs", async (_req, res) => {
  const jobs = await listActiveBulkJobs();
  res.json(jobs.map(serializeBulkJob));
});

// Trash bin: list every soft-deleted candidate still inside the retention
// window so the recruiter can review and restore mistakes. Registered ABOVE
// `/candidates/:id` so the literal `/candidates/trash` path isn't swallowed
// by the numeric `:id` matcher.
router.get("/candidates/trash", async (_req, res) => {
  // Opportunistic sweep: hard-delete anything past retention before we list,
  // so the recruiter never sees a row that's about to vanish out from under
  // their click. Failure here is non-fatal — the scheduled sweeper will
  // catch up later.
  try {
    await purgeExpiredSoftDeletedCandidates();
  } catch {
    /* ignore — listing must not depend on the sweep succeeding */
  }
  const rows = await db
    .select()
    .from(candidatesTable)
    .where(isNotNull(candidatesTable.deletedAt))
    .orderBy(sql`${candidatesTable.deletedAt} DESC`);
  // Pre-compute batch sizes so the UI can show "X candidates in this batch"
  // and offer a single "Restore batch" action without a second round trip.
  const batchCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.deletionBatchId) {
      batchCounts.set(
        r.deletionBatchId,
        (batchCounts.get(r.deletionBatchId) ?? 0) + 1,
      );
    }
  }
  const now = Date.now();
  const items = rows.map((r) => {
    const deletedAtMs = r.deletedAt ? r.deletedAt.getTime() : now;
    const purgeAt = deletedAtMs + RETENTION_MS;
    const msRemaining = Math.max(0, purgeAt - now);
    const daysRemaining = Math.floor(msRemaining / (24 * 60 * 60 * 1000));
    return {
      id: r.id,
      name: r.name,
      email: r.email ?? null,
      headline: r.headline ?? null,
      location: r.location ?? null,
      currentCompany: r.currentCompany ?? null,
      source: r.source ?? null,
      deletedAt: r.deletedAt,
      deletionBatchId: r.deletionBatchId ?? null,
      batchSize: r.deletionBatchId ? (batchCounts.get(r.deletionBatchId) ?? 1) : 1,
      daysRemaining,
    };
  });
  res.json({
    retentionDays: Math.floor(RETENTION_MS / (24 * 60 * 60 * 1000)),
    items,
  });
});

// Empty the trash immediately. Bypasses the retention window so a recruiter
// who's confident about their cleanup doesn't have to wait 7 days for the
// rows to vanish. The frontend gates this behind a typed confirmation.
router.delete("/candidates/trash", async (_req, res) => {
  const purged = await db
    .delete(candidatesTable)
    .where(isNotNull(candidatesTable.deletedAt))
    .returning({ id: candidatesTable.id });
  res.json({ ok: true, purged: purged.length });
});

// Restore one or more soft-deleted candidates by id. Powers both the
// per-row "Restore" button and the per-batch "Restore batch" action in the
// Trash view (the frontend just expands the batch into its candidate ids).
// Already-restored or hard-deleted ids are silently filtered out by the
// `isNotNull(deletedAt)` predicate so the response count reflects what
// actually changed.
router.post("/candidates/restore-by-id", async (req, res) => {
  const body = RestoreCandidatesByIdsBody.parse(req.body);
  const ids = Array.from(new Set(body.ids));
  const restored = await db
    .update(candidatesTable)
    .set({
      deletedAt: null,
      deletionBatchId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(candidatesTable.id, ids),
        isNotNull(candidatesTable.deletedAt),
      ),
    )
    .returning({ id: candidatesTable.id });
  res.json({ ok: true, restored: restored.length });
});

router.get("/candidates/bulk-jobs/:id", async (req, res) => {
  const { id } = GetBulkCandidateJobParams.parse({ id: Number(req.params.id) });
  const job = await getBulkJob(id);
  if (!job) {
    res.status(404).json({ error: "Bulk job not found" });
    return;
  }
  res.json(serializeBulkJob(job));
});

router.post("/candidates/bulk-jobs/:id/cancel", async (req, res) => {
  // Re-using GetBulkCandidateJobParams for the path-id shape — same `{id}`
  // contract, no need for a parallel zod schema.
  const { id } = GetBulkCandidateJobParams.parse({ id: Number(req.params.id) });
  const job = await cancelBulkJob(id);
  if (!job) {
    res.status(404).json({ error: "Bulk job not found" });
    return;
  }
  res.json(serializeBulkJob(job));
});

// Get a candidate by ID. Soft-deleted candidates are reported as "not found"
// — we don't want detail pages or deep links to surface trash-bin rows that
// the recruiter expects to be gone.
router.get("/candidates/:id", async (req, res) => {
  const { id } = GetCandidateParams.parse({ id: Number(req.params.id) });
  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(and(eq(candidatesTable.id, id), isNull(candidatesTable.deletedAt)));
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

// Delete a candidate. Mirrors the bulk soft-delete behavior so a single-row
// delete from the candidate detail page is just as recoverable as a bulk one
// — the trash sweeper will hard-delete it after the retention window.
router.delete("/candidates/:id", async (req, res) => {
  const { id } = DeleteCandidateParams.parse({ id: Number(req.params.id) });
  const now = new Date();
  await db
    .update(candidatesTable)
    .set({
      deletedAt: now,
      deletionBatchId: randomUUID(),
      updatedAt: now,
    })
    .where(and(eq(candidatesTable.id, id), isNull(candidatesTable.deletedAt)));
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

// Bulk action on a recruiter-selected list of candidates. Backs the "bulk
// action bar" that appears once the recruiter checks one or more rows on the
// candidates list or pipeline view. The 500-id cap matches the email
// re-validation path budget; the frontend chunks larger selections itself.
const BULK_RECHECK_CONCURRENCY = 5;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

router.post("/candidates/bulk", async (req, res) => {
  const body = BulkCandidateActionBody.parse(req.body);
  // Defensive de-dup: a sloppy client could send the same id multiple times,
  // and we don't want that to inflate the per-item budget or the processed
  // count.
  const ids = Array.from(new Set(body.ids));

  if (body.action === "delete") {
    // Soft delete: stamp `deletedAt` + a shared `deletionBatchId` so the
    // frontend's "Undo" toast can restore exactly this batch. Cascading FK
    // children (applications, notes, evaluations) are intentionally left in
    // place — the trash sweeper hard-deletes them later via the FK cascade.
    // Already-soft-deleted ids are filtered out so a duplicate request from a
    // misbehaving client doesn't reset their `deletedAt` (which would extend
    // the retention window unfairly).
    const deletionBatchId = randomUUID();
    const now = new Date();
    const deleted = await db
      .update(candidatesTable)
      .set({
        deletedAt: now,
        deletionBatchId,
        updatedAt: now,
      })
      .where(
        and(
          inArray(candidatesTable.id, ids),
          isNull(candidatesTable.deletedAt),
        ),
      )
      .returning({ id: candidatesTable.id });
    res.json({
      ok: true,
      action: body.action,
      processed: deleted.length,
      skipped: ids.length - deleted.length,
      deletionBatchId: deleted.length > 0 ? deletionBatchId : null,
    });
    return;
  }

  if (body.action === "move-stage") {
    const jobId = body.payload?.jobId;
    const stage = body.payload?.stage;
    if (!jobId || !stage) {
      res.status(400).json({ error: "move-stage requires payload.jobId and payload.stage" });
      return;
    }
    const updated = await db
      .update(applicationsTable)
      .set({ stage, updatedAt: new Date() })
      .where(
        and(
          eq(applicationsTable.jobId, jobId),
          inArray(applicationsTable.candidateId, ids),
        ),
      )
      .returning({ id: applicationsTable.id });
    res.json({
      ok: true,
      action: body.action,
      processed: updated.length,
      skipped: ids.length - updated.length,
    });
    return;
  }

  if (body.action === "export-csv") {
    const rows = await db
      .select()
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, ids));
    // Preserve the order the recruiter selected so the export feels predictable
    // when they're scanning a sorted page.
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is typeof rows[number] => !!r);
    // Columns mirror the existing single-candidate CSV export shape exactly
    // (no id column) so downstream importers stay compatible.
    const header = [
      "name",
      "email",
      "headline",
      "location",
      "currentCompany",
      "source",
      "emailValidationStatus",
      "emailSource",
      "profileUrl",
    ];
    const lines = [header.join(",")];
    for (const r of ordered) {
      const profileUrl = r.linkedIn ?? r.githubUrl ?? "";
      lines.push(
        [
          r.name,
          r.email ?? "",
          r.headline ?? "",
          r.location ?? "",
          r.currentCompany ?? "",
          r.source ?? "",
          r.emailValidationStatus ?? "",
          r.emailSource ?? "",
          profileUrl,
        ].map(csvEscape).join(","),
      );
    }
    const csv = lines.join("\n");
    res.json({
      ok: true,
      action: body.action,
      processed: ordered.length,
      skipped: ids.length - ordered.length,
      csv,
    });
    return;
  }

  // recheck-email: bounded concurrency so a 500-id selection doesn't fan out
  // into 500 simultaneous DNS lookups.
  const results: Array<{
    id: number;
    status: "valid" | "invalid" | "risky" | "unchecked" | "skipped" | "error";
    reason: string | null;
  }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const idx = cursor++;
      const id = ids[idx];
      try {
        const updated = await revalidateCandidateEmail(id);
        if (!updated) {
          results.push({ id, status: "skipped", reason: "candidate not found" });
        } else if (!updated.email) {
          results.push({ id, status: "skipped", reason: "no email on file" });
        } else {
          results.push({
            id,
            status: (updated.emailValidationStatus ?? "unchecked") as
              | "valid" | "invalid" | "risky" | "unchecked",
            reason: updated.emailValidationReason ?? null,
          });
        }
      } catch (err) {
        req.log.warn(
          { candidateId: id, err: err instanceof Error ? err.message : String(err) },
          "Bulk recheck-email failed for candidate",
        );
        results.push({
          id,
          status: "error",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BULK_RECHECK_CONCURRENCY, ids.length) }, worker),
  );
  // Preserve the recruiter's selection order in the response so the UI can map
  // results back to rows without re-sorting.
  results.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const processed = results.filter((r) => r.status !== "skipped" && r.status !== "error").length;
  const skipped = results.length - processed;
  res.json({
    ok: true,
    action: body.action,
    processed,
    skipped,
    results,
  });
});

// Restore a soft-deleted batch. Backs the recruiter's "Undo" toast: the
// frontend hands us the batch id we returned from the bulk delete and we flip
// `deletedAt` back to NULL on every row tagged with it. We intentionally key
// off the batch id (rather than the candidate ids) so a stale undo can't
// resurrect rows from an unrelated, intentional delete.
router.post("/candidates/restore", async (req, res) => {
  const body = RestoreCandidateBatchBody.parse(req.body);
  const restored = await db
    .update(candidatesTable)
    .set({
      deletedAt: null,
      deletionBatchId: null,
      updatedAt: new Date(),
    })
    .where(eq(candidatesTable.deletionBatchId, body.deletionBatchId))
    .returning({ id: candidatesTable.id });
  res.json({ ok: true, restored: restored.length });
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

  const realSourcingAvailable = await hasRealSourcingProvider();
  const result = rows.map((r) => ({
    ...r.applications,
    job: { ...r.jobs, hasRealSourcingProvider: realSourcingAvailable },
    candidate: r.candidates,
  }));
  res.json(result);
});

export default router;
