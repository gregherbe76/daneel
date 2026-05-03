import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { eq, inArray, isNull } from "drizzle-orm";
import { db, candidatesTable } from "@workspace/db";
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
  method: "GET" | "POST",
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
