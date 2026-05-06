import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, bulkJobsTable, candidatesTable } from "@workspace/db";
import candidatesRouter from "./candidates";
import { stopBulkJobsWorker } from "../lib/bulk-jobs";

const app = express();
app.use(express.json());
app.use("/api", candidatesRouter);

const TEST_MARKER = "candidates.bulk-jobs.test:";

const seededCandidateIds: number[] = [];
const seededJobIds: number[] = [];

beforeAll(() => {
  // Prevent the in-process worker from draining the jobs we enqueue here so
  // the route-level tests can observe pending rows deterministically and so
  // we don't accidentally hard-delete real candidates.
  stopBulkJobsWorker();
});

afterEach(async () => {
  if (seededJobIds.length > 0) {
    await db.delete(bulkJobsTable).where(inArray(bulkJobsTable.id, seededJobIds));
    seededJobIds.length = 0;
  }
  if (seededCandidateIds.length > 0) {
    await db
      .delete(candidatesTable)
      .where(inArray(candidatesTable.id, seededCandidateIds));
    seededCandidateIds.length = 0;
  }
});

afterAll(async () => {
  // Belt-and-suspenders cleanup in case a test threw before recording its ids.
  if (seededJobIds.length > 0) {
    await db.delete(bulkJobsTable).where(inArray(bulkJobsTable.id, seededJobIds));
  }
  if (seededCandidateIds.length > 0) {
    await db
      .delete(candidatesTable)
      .where(inArray(candidatesTable.id, seededCandidateIds));
  }
});

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

async function seedCandidate(name: string): Promise<number> {
  const [row] = await db
    .insert(candidatesTable)
    .values({ name: `${TEST_MARKER}${name}` })
    .returning({ id: candidatesTable.id });
  if (!row) throw new Error("failed to insert test candidate");
  seededCandidateIds.push(row.id);
  return row.id;
}

async function seedBulkJob(values: {
  action: string;
  ids: number[];
  status: string;
  result?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  processed?: number;
  skipped?: number;
}): Promise<number> {
  const [row] = await db
    .insert(bulkJobsTable)
    .values({
      action: values.action,
      ids: values.ids,
      payload: values.payload ?? null,
      total: values.ids.length,
      processed: values.processed ?? 0,
      skipped: values.skipped ?? 0,
      status: values.status,
      result: values.result ?? null,
    })
    .returning({ id: bulkJobsTable.id });
  if (!row) throw new Error("failed to insert test bulk job");
  seededJobIds.push(row.id);
  return row.id;
}

describe("POST /candidates/bulk-jobs", () => {
  it("enqueues a delete job and returns the serialized pending row", async () => {
    const candidateId = await seedCandidate("enqueue");

    const res = await call("POST", "/api/candidates/bulk-jobs", {
      ids: [candidateId],
      action: "delete",
    });

    expect(res.status).toBe(201);
    expect(typeof res.body.id).toBe("number");
    seededJobIds.push(res.body.id);
    expect(res.body.action).toBe("delete");
    expect(res.body.status).toBe("pending");
    expect(res.body.total).toBe(1);
    expect(res.body.processed).toBe(0);
    expect(res.body.skipped).toBe(0);
    expect(res.body.csv).toBeNull();
    expect(res.body.results).toBeNull();
    expect(res.body.errorMessage).toBeNull();
  });

  it("rejects move-stage when the payload is missing jobId / stage", async () => {
    const candidateId = await seedCandidate("move-stage-no-payload");

    const noPayload = await call("POST", "/api/candidates/bulk-jobs", {
      ids: [candidateId],
      action: "move-stage",
    });
    expect(noPayload.status).toBe(400);
    expect(String(noPayload.body?.error ?? "")).toMatch(/jobId.*stage/);

    const partial = await call("POST", "/api/candidates/bulk-jobs", {
      ids: [candidateId],
      action: "move-stage",
      payload: { jobId: 123 },
    });
    expect(partial.status).toBe(400);
  });

  it("accepts move-stage when payload provides jobId and stage", async () => {
    const candidateId = await seedCandidate("move-stage-ok");

    const res = await call("POST", "/api/candidates/bulk-jobs", {
      ids: [candidateId],
      action: "move-stage",
      payload: { jobId: 999_999, stage: "Screened" },
    });

    expect(res.status).toBe(201);
    seededJobIds.push(res.body.id);
    expect(res.body.action).toBe("move-stage");
    expect(res.body.status).toBe("pending");
    expect(res.body.payload).toEqual({ jobId: 999_999, stage: "Screened" });
  });
});

describe("GET /candidates/bulk-jobs", () => {
  it("returns pending and running jobs (and excludes terminal ones)", async () => {
    const candidateId = await seedCandidate("list-active");
    const pendingId = await seedBulkJob({
      action: "delete",
      ids: [candidateId],
      status: "pending",
    });
    const runningId = await seedBulkJob({
      action: "delete",
      ids: [candidateId],
      status: "running",
    });
    const completedId = await seedBulkJob({
      action: "delete",
      ids: [candidateId],
      status: "completed",
    });

    const res = await call("GET", "/api/candidates/bulk-jobs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = (res.body as Array<{ id: number; status: string }>).map(
      (r) => r.id,
    );
    expect(ids).toContain(pendingId);
    expect(ids).toContain(runningId);
    expect(ids).not.toContain(completedId);
  });
});

describe("GET /candidates/bulk-jobs/:id", () => {
  it("returns 404 for an unknown id", async () => {
    const res = await call("GET", "/api/candidates/bulk-jobs/2147483600");
    expect(res.status).toBe(404);
    expect(res.body?.error).toMatch(/not found/i);
  });

  it("serializes a completed export-csv job's csv field", async () => {
    const candidateId = await seedCandidate("csv");
    const csv = "name,email\nAlice,alice@example.com";
    const jobId = await seedBulkJob({
      action: "export-csv",
      ids: [candidateId],
      status: "completed",
      processed: 1,
      result: { csv },
    });

    const res = await call("GET", `/api/candidates/bulk-jobs/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body.action).toBe("export-csv");
    expect(res.body.status).toBe("completed");
    expect(res.body.processed).toBe(1);
    expect(res.body.csv).toBe(csv);
    expect(res.body.results).toBeNull();
  });

  it("cancels a pending job — status flips to canceled and finishedAt is set", async () => {
    const candidateId = await seedCandidate("cancel-pending");
    const jobId = await seedBulkJob({
      action: "delete",
      ids: [candidateId],
      status: "pending",
    });

    const res = await call("POST", `/api/candidates/bulk-jobs/${jobId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body.status).toBe("canceled");
    expect(res.body.finishedAt).toBeTruthy();
  });

  it("does not overwrite a terminal job — completed rows are returned unchanged", async () => {
    const candidateId = await seedCandidate("cancel-completed");
    const csv = "name\nBob";
    const jobId = await seedBulkJob({
      action: "export-csv",
      ids: [candidateId],
      status: "completed",
      processed: 1,
      result: { csv },
    });

    const before = await call("GET", `/api/candidates/bulk-jobs/${jobId}`);
    expect(before.status).toBe(200);
    expect(before.body.status).toBe("completed");

    const res = await call("POST", `/api/candidates/bulk-jobs/${jobId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(jobId);
    expect(res.body.status).toBe("completed");
    expect(res.body.csv).toBe(csv);
    expect(res.body.processed).toBe(1);
  });

  it("returns 404 when cancelling an unknown id", async () => {
    const res = await call(
      "POST",
      "/api/candidates/bulk-jobs/2147483601/cancel",
    );
    expect(res.status).toBe(404);
    expect(res.body?.error).toMatch(/not found/i);
  });

  it("serializes a completed recheck-email job's results field", async () => {
    const candidateId = await seedCandidate("recheck");
    const results = [
      { id: candidateId, status: "valid", reason: null },
    ];
    const jobId = await seedBulkJob({
      action: "recheck-email",
      ids: [candidateId],
      status: "completed",
      processed: 1,
      result: { results },
    });

    const res = await call("GET", `/api/candidates/bulk-jobs/${jobId}`);
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("recheck-email");
    expect(res.body.status).toBe("completed");
    expect(res.body.csv).toBeNull();
    expect(res.body.results).toEqual(results);
  });
});
