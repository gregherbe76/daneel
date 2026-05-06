import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  candidatesTable,
  jobsTable,
  applicationsTable,
} from "@workspace/db";
import { RETENTION_MS } from "../lib/candidate-trash";
import candidatesRouter from "./candidates";

// Mounted on /api so the route paths in this test match the production prefix.
const app = express();
app.use(express.json());
app.use("/api", candidatesRouter);

const TEST_MARKER = "candidates.test:";

async function seedCandidate(name: string) {
  const [row] = await db
    .insert(candidatesTable)
    .values({ name: `${TEST_MARKER}${name}` })
    .returning();
  if (!row) throw new Error("failed to insert test candidate");
  return row;
}

const seededIds: number[] = [];

afterEach(async () => {
  if (seededIds.length === 0) return;
  await db.delete(candidatesTable).where(inArray(candidatesTable.id, seededIds));
  seededIds.length = 0;
});

// Tiny helper to call an express handler with JSON in/out without pulling in
// a supertest dependency.
async function call(
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("no address"));
        return;
      }
      fetch(`http://127.0.0.1:${address.port}${url}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
        .then(async (res) => {
          const text = await res.text();
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("bulk delete + restore", () => {
  it("soft-deletes a batch and lets the recruiter undo it via the batch id", async () => {
    const a = await seedCandidate("undo-a");
    const b = await seedCandidate("undo-b");
    seededIds.push(a.id, b.id);

    const del = await call("POST", "/api/candidates/bulk", {
      ids: [a.id, b.id],
      action: "delete",
    });
    expect(del.status).toBe(200);
    expect(del.body.processed).toBe(2);
    expect(del.body.skipped).toBe(0);
    expect(typeof del.body.deletionBatchId).toBe("string");
    const batchId = del.body.deletionBatchId as string;

    // Rows are still on disk, but soft-deleted.
    const onDisk = await db
      .select()
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, [a.id, b.id]));
    expect(onDisk).toHaveLength(2);
    for (const row of onDisk) {
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletionBatchId).toBe(batchId);
    }

    // GET /candidates hides the soft-deleted rows.
    const list = await call("GET", "/api/candidates");
    expect(list.status).toBe(200);
    const visibleIds = (list.body as Array<{ id: number }>).map((r) => r.id);
    expect(visibleIds).not.toContain(a.id);
    expect(visibleIds).not.toContain(b.id);

    // GET /candidates/:id reports 404 for a soft-deleted candidate.
    const detail = await call("GET", `/api/candidates/${a.id}`);
    expect(detail.status).toBe(404);

    // Undo restores the batch.
    const restored = await call("POST", "/api/candidates/restore", {
      deletionBatchId: batchId,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.restored).toBe(2);

    const afterRestore = await db
      .select()
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, [a.id, b.id]));
    for (const row of afterRestore) {
      expect(row.deletedAt).toBeNull();
      expect(row.deletionBatchId).toBeNull();
    }
  });

  it("does not double-stamp deletedAt when the same id is re-deleted", async () => {
    const a = await seedCandidate("dedupe");
    seededIds.push(a.id);

    const first = await call("POST", "/api/candidates/bulk", {
      ids: [a.id],
      action: "delete",
    });
    expect(first.body.processed).toBe(1);
    const [afterFirst] = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, a.id));
    const originalDeletedAt = afterFirst!.deletedAt;
    const originalBatchId = afterFirst!.deletionBatchId;

    // Re-issuing the same delete should be a no-op so the original retention
    // window (and original batch id, used by the original "Undo" toast) are
    // preserved.
    const second = await call("POST", "/api/candidates/bulk", {
      ids: [a.id],
      action: "delete",
    });
    expect(second.body.processed).toBe(0);
    expect(second.body.skipped).toBe(1);
    expect(second.body.deletionBatchId).toBeNull();

    const [afterSecond] = await db
      .select()
      .from(candidatesTable)
      .where(eq(candidatesTable.id, a.id));
    expect(afterSecond!.deletedAt?.getTime()).toBe(
      originalDeletedAt?.getTime(),
    );
    expect(afterSecond!.deletionBatchId).toBe(originalBatchId);
  });

  it("hides soft-deleted candidates from the list and surfaces the rest", async () => {
    const live = await seedCandidate("live");
    const trashed = await seedCandidate("trashed");
    seededIds.push(live.id, trashed.id);

    await call("POST", "/api/candidates/bulk", {
      ids: [trashed.id],
      action: "delete",
    });

    const visible = await db
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(isNull(candidatesTable.deletedAt));
    const visibleIds = visible.map((r) => r.id);
    expect(visibleIds).toContain(live.id);
    expect(visibleIds).not.toContain(trashed.id);
  });
});

describe("trash bin endpoints", () => {
  it("GET /candidates/trash returns the listed rows with daysRemaining + batchSize", async () => {
    const a = await seedCandidate("trash-list-a");
    const b = await seedCandidate("trash-list-b");
    const solo = await seedCandidate("trash-list-solo");
    seededIds.push(a.id, b.id, solo.id);

    // Two rows in one bulk batch, one separate single-row delete.
    const bulk = await call("POST", "/api/candidates/bulk", {
      ids: [a.id, b.id],
      action: "delete",
    });
    expect(bulk.status).toBe(200);
    const batchId = bulk.body.deletionBatchId as string;

    const soloDel = await call("POST", "/api/candidates/bulk", {
      ids: [solo.id],
      action: "delete",
    });
    const soloBatchId = soloDel.body.deletionBatchId as string;

    const trash = await call("GET", "/api/candidates/trash");
    expect(trash.status).toBe(200);
    expect(trash.body.retentionDays).toBe(
      Math.floor(RETENTION_MS / (24 * 60 * 60 * 1000)),
    );

    const items = trash.body.items as Array<{
      id: number;
      deletionBatchId: string | null;
      batchSize: number;
      daysRemaining: number;
    }>;
    const byId = new Map(items.map((i) => [i.id, i]));

    const aRow = byId.get(a.id);
    const bRow = byId.get(b.id);
    const soloRow = byId.get(solo.id);
    expect(aRow).toBeDefined();
    expect(bRow).toBeDefined();
    expect(soloRow).toBeDefined();

    // Two rows that share the bulk batch report a batchSize of 2; the
    // solo-deleted row's batch only contains itself.
    expect(aRow!.deletionBatchId).toBe(batchId);
    expect(bRow!.deletionBatchId).toBe(batchId);
    expect(aRow!.batchSize).toBe(2);
    expect(bRow!.batchSize).toBe(2);
    expect(soloRow!.deletionBatchId).toBe(soloBatchId);
    expect(soloRow!.batchSize).toBe(1);

    // Just deleted -> daysRemaining is one short of the full retention
    // window (Math.floor on a value slightly less than RETENTION_MS / day,
    // since `now` has advanced microseconds past `deletedAt`). It must be
    // within [retentionDays - 1, retentionDays].
    const retentionDays = Math.floor(
      RETENTION_MS / (24 * 60 * 60 * 1000),
    );
    expect(aRow!.daysRemaining).toBeGreaterThanOrEqual(retentionDays - 1);
    expect(aRow!.daysRemaining).toBeLessThanOrEqual(retentionDays);
  });

  it("GET /candidates/trash collapses daysRemaining to 0 for rows about to purge", async () => {
    const stale = await seedCandidate("trash-stale");
    seededIds.push(stale.id);

    // Soft-delete via the API, then back-date deletedAt to "almost expired"
    // so the daysRemaining math collapses to 0 without us having to wait.
    await call("POST", "/api/candidates/bulk", {
      ids: [stale.id],
      action: "delete",
    });
    const almostExpired = new Date(Date.now() - RETENTION_MS + 60_000);
    await db
      .update(candidatesTable)
      .set({ deletedAt: almostExpired })
      .where(eq(candidatesTable.id, stale.id));

    const trash = await call("GET", "/api/candidates/trash");
    const item = (trash.body.items as Array<{ id: number; daysRemaining: number }>).find(
      (i) => i.id === stale.id,
    );
    expect(item).toBeDefined();
    expect(item!.daysRemaining).toBe(0);
  });

  it("POST /candidates/restore-by-id only restores rows with deletedAt IS NOT NULL", async () => {
    const trashed = await seedCandidate("restore-trashed");
    const live = await seedCandidate("restore-live");
    seededIds.push(trashed.id, live.id);

    await call("POST", "/api/candidates/bulk", {
      ids: [trashed.id],
      action: "delete",
    });

    // `live` has never been deleted — the restore call should silently skip
    // it rather than touching the row.
    const liveBefore = (
      await db
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.id, live.id))
    )[0]!;

    const restored = await call("POST", "/api/candidates/restore-by-id", {
      ids: [trashed.id, live.id],
    });
    expect(restored.status).toBe(200);
    expect(restored.body.restored).toBe(1);

    const after = await db
      .select()
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, [trashed.id, live.id]));
    const byId = new Map(after.map((r) => [r.id, r]));
    expect(byId.get(trashed.id)?.deletedAt).toBeNull();
    expect(byId.get(trashed.id)?.deletionBatchId).toBeNull();
    // Live row's updatedAt was NOT bumped — proof the WHERE filtered it out.
    expect(byId.get(live.id)?.deletedAt).toBeNull();
    expect(byId.get(live.id)?.updatedAt?.getTime()).toBe(
      liveBefore.updatedAt?.getTime(),
    );
  });

  it("POST /candidates/restore-by-id de-duplicates ids in the request", async () => {
    const trashed = await seedCandidate("restore-dedupe");
    seededIds.push(trashed.id);

    await call("POST", "/api/candidates/bulk", {
      ids: [trashed.id],
      action: "delete",
    });

    const restored = await call("POST", "/api/candidates/restore-by-id", {
      ids: [trashed.id, trashed.id, trashed.id],
    });
    // Even though we passed the id three times, the DB row only flips back
    // once and the response reports a single restore.
    expect(restored.body.restored).toBe(1);
  });

  it("GET /candidates/trash exposes attachedJobs and flags archived/deleted ones", async () => {
    const cand = await seedCandidate("trash-attached-jobs");
    seededIds.push(cand.id);

    // One live job + one job we'll delete to simulate "the originally-attached
    // job was archived/deleted in the meantime". We can't soft-delete a job
    // (no archived flag in the schema today), so a hard-delete + cascade is
    // the equivalent in-the-wild scenario the recruiter sees.
    const [liveJob] = await db
      .insert(jobsTable)
      .values({
        title: `${TEST_MARKER}live job`,
        description: "live",
        location: "Remote",
        seniority: "Mid",
      })
      .returning();
    const [doomedJob] = await db
      .insert(jobsTable)
      .values({
        title: `${TEST_MARKER}doomed job`,
        description: "doomed",
        location: "Remote",
        seniority: "Mid",
      })
      .returning();

    await db.insert(applicationsTable).values([
      { candidateId: cand.id, jobId: liveJob!.id, stage: "Sourced" },
      { candidateId: cand.id, jobId: doomedJob!.id, stage: "Sourced" },
    ]);

    await call("POST", "/api/candidates/bulk", {
      ids: [cand.id],
      action: "delete",
    });

    // First read: both jobs still exist, so the snapshot taken at delete
    // time reports two originally-attached jobs and zero archived/deleted
    // ones.
    const trashBefore = await call("GET", "/api/candidates/trash");
    const beforeRow = (
      trashBefore.body.items as Array<{
        id: number;
        attachedJobs: Array<{ id: number; title: string; exists: boolean }>;
        archivedJobCount: number;
      }>
    ).find((i) => i.id === cand.id);
    expect(beforeRow).toBeDefined();
    expect(beforeRow!.attachedJobs).toHaveLength(2);
    expect(beforeRow!.archivedJobCount).toBe(0);
    expect(beforeRow!.attachedJobs.every((j) => j.exists)).toBe(true);
    // Snapshot includes both job titles, sorted by insertion order.
    const beforeTitles = beforeRow!.attachedJobs.map((j) => j.title).sort();
    expect(beforeTitles).toEqual(
      [`${TEST_MARKER}live job`, `${TEST_MARKER}doomed job`].sort(),
    );

    // Hard-delete the doomed job. The FK cascade drops the live application
    // row, but the snapshot stamped on the candidate row at delete time is
    // independent of the applications table — so the trash payload still
    // reports the original count of 2, with `archivedJobCount: 1` flagging
    // exactly the job that vanished. This is the real product warning the
    // task asks for.
    await db.delete(jobsTable).where(eq(jobsTable.id, doomedJob!.id));

    const trashAfter = await call("GET", "/api/candidates/trash");
    const afterRow = (
      trashAfter.body.items as Array<{
        id: number;
        attachedJobs: Array<{ id: number; title: string; exists: boolean }>;
        archivedJobCount: number;
      }>
    ).find((i) => i.id === cand.id);
    expect(afterRow).toBeDefined();
    expect(afterRow!.attachedJobs).toHaveLength(2);
    expect(afterRow!.archivedJobCount).toBe(1);
    const live = afterRow!.attachedJobs.find((j) => j.exists);
    const lost = afterRow!.attachedJobs.find((j) => !j.exists);
    expect(live).toBeDefined();
    expect(live!.id).toBe(liveJob!.id);
    expect(live!.title).toBe(`${TEST_MARKER}live job`);
    expect(lost).toBeDefined();
    expect(lost!.id).toBe(doomedJob!.id);
    expect(lost!.title).toBe(`${TEST_MARKER}doomed job`);

    // Cleanup the live job (afterEach handles the candidate row).
    await db.delete(jobsTable).where(eq(jobsTable.id, liveJob!.id));
  });

  it("clears the attachment snapshot on restore so a future delete starts fresh", async () => {
    const cand = await seedCandidate("trash-snapshot-clear");
    seededIds.push(cand.id);

    const [job] = await db
      .insert(jobsTable)
      .values({
        title: `${TEST_MARKER}snapshot-clear job`,
        description: "x",
        location: "Remote",
        seniority: "Mid",
      })
      .returning();
    await db.insert(applicationsTable).values({
      candidateId: cand.id,
      jobId: job!.id,
      stage: "Sourced",
    });

    // First trash → snapshot captured.
    await call("POST", "/api/candidates/bulk", {
      ids: [cand.id],
      action: "delete",
    });
    let row = (
      await db
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.id, cand.id))
    )[0]!;
    expect(row.deletedAttachmentSnapshot).toEqual([
      { jobId: job!.id, title: `${TEST_MARKER}snapshot-clear job` },
    ]);

    // Restore (by id) → snapshot must be cleared so a future delete does
    // not serve stale pipeline context.
    await call("POST", "/api/candidates/restore-by-id", { ids: [cand.id] });
    row = (
      await db
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.id, cand.id))
    )[0]!;
    expect(row.deletedAttachmentSnapshot).toBeNull();

    // Detach the candidate from the job, then trash again → the new
    // snapshot is empty (proves we didn't reuse the stale one).
    await db
      .delete(applicationsTable)
      .where(eq(applicationsTable.candidateId, cand.id));
    await call("POST", "/api/candidates/bulk", {
      ids: [cand.id],
      action: "delete",
    });
    row = (
      await db
        .select()
        .from(candidatesTable)
        .where(eq(candidatesTable.id, cand.id))
    )[0]!;
    expect(row.deletedAttachmentSnapshot).toEqual([]);

    await db.delete(jobsTable).where(eq(jobsTable.id, job!.id));
  });

  it("DELETE /candidates/trash hard-deletes every soft-deleted row in one shot", async () => {
    const a = await seedCandidate("empty-a");
    const b = await seedCandidate("empty-b");
    const live = await seedCandidate("empty-live");
    seededIds.push(a.id, b.id, live.id);

    await call("POST", "/api/candidates/bulk", {
      ids: [a.id, b.id],
      action: "delete",
    });

    const empty = await call("DELETE", "/api/candidates/trash");
    expect(empty.status).toBe(200);
    expect(empty.body.ok).toBe(true);
    expect(empty.body.purged).toBeGreaterThanOrEqual(2);

    const remaining = await db
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, [a.id, b.id, live.id]));
    const remainingIds = remaining.map((r) => r.id);
    // The two trashed rows are gone; the never-deleted row is untouched.
    expect(remainingIds).not.toContain(a.id);
    expect(remainingIds).not.toContain(b.id);
    expect(remainingIds).toContain(live.id);

    // Drop the hard-deleted ids so afterEach doesn't try to clean them up.
    seededIds.length = 0;
    seededIds.push(live.id);

    // The trash listing should be effectively empty for our test rows now.
    const trash = await call("GET", "/api/candidates/trash");
    const trashedIds = (trash.body.items as Array<{ id: number }>).map((i) => i.id);
    expect(trashedIds).not.toContain(a.id);
    expect(trashedIds).not.toContain(b.id);
  });
});
