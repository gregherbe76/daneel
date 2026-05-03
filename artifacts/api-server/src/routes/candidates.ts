import { Router } from "express";
import { db, candidatesTable, applicationsTable, jobsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  CreateCandidateBody,
  UpdateCandidateBody,
  GetCandidateParams,
  UpdateCandidateParams,
  DeleteCandidateParams,
  GetCandidateApplicationsParams,
  RecheckCandidateEmailParams,
  BulkCandidateActionBody,
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
    // Cascading FKs on applications + candidate_notes + ai_evaluations etc.
    // mean removing the candidate row is enough to clean the rest up.
    const deleted = await db
      .delete(candidatesTable)
      .where(inArray(candidatesTable.id, ids))
      .returning({ id: candidatesTable.id });
    res.json({
      ok: true,
      action: body.action,
      processed: deleted.length,
      skipped: ids.length - deleted.length,
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
