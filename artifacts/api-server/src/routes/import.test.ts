import { afterEach, describe, expect, it, vi } from "vitest";

// Mock sourcing provider so /candidates/source doesn't hit OpenAI.
const sourcingRun = vi.fn();
vi.mock("./workflows/providers", async () => {
  const actual = await vi.importActual<
    typeof import("./workflows/providers")
  >("./workflows/providers");
  return {
    ...actual,
    resolveSourcingProvider: async () => ({
      provider: {
        id: -1,
        name: "Test Sourcing",
        type: "native_openai",
        run: (...args: unknown[]) => sourcingRun(...args),
      },
      isTwin: false,
    }),
  };
});

import express from "express";
import { eq, inArray, and, isNull } from "drizzle-orm";
import {
  db,
  candidatesTable,
  jobsTable,
  applicationsTable,
} from "@workspace/db";
import importRouter from "./import";

const app = express();
app.use(express.json());
app.use("/api", importRouter);

const TEST_MARKER = "import.test:";

const seededJobIds: number[] = [];
const seededCandidateIds: number[] = [];

afterEach(async () => {
  if (seededCandidateIds.length > 0) {
    await db
      .delete(candidatesTable)
      .where(inArray(candidatesTable.id, seededCandidateIds));
    seededCandidateIds.length = 0;
  }
  if (seededJobIds.length > 0) {
    await db.delete(jobsTable).where(inArray(jobsTable.id, seededJobIds));
    seededJobIds.length = 0;
  }
  sourcingRun.mockReset();
});

async function call(method: "POST", url: string, body?: unknown) {
  return await new Promise<{ status: number; body: any }>((resolve, reject) => {
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

describe("Re-importing a previously soft-deleted email succeeds (partial unique index)", () => {
  it("creates a fresh candidate row when the prior row with the same email is trashed", async () => {
    const email = `${TEST_MARKER}reimport-${Date.now()}@example.com`;

    // Seed a soft-deleted (tombstone) row carrying the email.
    const [tombstone] = await db
      .insert(candidatesTable)
      .values({
        name: `${TEST_MARKER}tombstone`,
        email,
        deletedAt: new Date(),
        deletionBatchId: "import-test-batch",
      })
      .returning();
    seededCandidateIds.push(tombstone!.id);

    // Re-import the same email via the batch endpoint.
    const res = await call("POST", "/api/candidates/import/batch", {
      candidates: [
        {
          name: `${TEST_MARKER}reimported`,
          email,
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toBe(0);

    const newId = res.body.candidates[0].id as number;
    seededCandidateIds.push(newId);
    expect(newId).not.toBe(tombstone!.id);

    // Both rows now exist on disk: the tombstone (deletedAt set) and the fresh
    // active row. The partial unique index allows this because it only covers
    // rows where deleted_at IS NULL.
    const rows = await db
      .select()
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, [tombstone!.id, newId]));
    expect(rows).toHaveLength(2);
    const active = rows.filter((r) => r.deletedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(newId);
  });

  it("still rejects two ACTIVE rows with the same email (partial index applies to live rows)", async () => {
    const email = `${TEST_MARKER}dup-${Date.now()}@example.com`;

    const res1 = await call("POST", "/api/candidates/import/batch", {
      candidates: [{ name: `${TEST_MARKER}dup-a`, email }],
    });
    expect(res1.status).toBe(200);
    expect(res1.body.created).toBe(1);
    seededCandidateIds.push(res1.body.candidates[0].id);

    const res2 = await call("POST", "/api/candidates/import/batch", {
      candidates: [{ name: `${TEST_MARKER}dup-b`, email }],
    });
    expect(res2.status).toBe(200);
    // Second insert should be skipped via onConflictDoNothing — the partial
    // unique index still enforces uniqueness among non-deleted rows.
    expect(res2.body.created).toBe(0);
    expect(res2.body.skipped).toBe(1);
  });
});

describe("POST /api/candidates/source dedupes against ACTIVE rows only", () => {
  it("re-sources a candidate whose previous row was soft-deleted (tombstone is ignored)", async () => {
    const [job] = await db
      .insert(jobsTable)
      .values({
        title: `${TEST_MARKER}source-job`,
        description: "d",
        location: "Remote",
        seniority: "Mid",
        mustHaveSkills: [],
      })
      .returning();
    seededJobIds.push(job!.id);

    const githubUrl = `https://github.com/${TEST_MARKER}reimport-${Date.now()}`;
    const email = `${TEST_MARKER}source-${Date.now()}@example.com`;

    // Tombstone with both signals — both should be ignored by dedupe.
    const [tombstone] = await db
      .insert(candidatesTable)
      .values({
        name: `${TEST_MARKER}source-tombstone`,
        email,
        githubUrl,
        deletedAt: new Date(),
        deletionBatchId: "import-test-source-batch",
      })
      .returning();
    seededCandidateIds.push(tombstone!.id);

    sourcingRun.mockResolvedValue([
      {
        name: `${TEST_MARKER}source-reimported`,
        headline: "h",
        location: "l",
        currentCompany: "c",
        email,
        linkedinUrl: "",
        githubUrl,
        skills: [],
        summary: "s",
        evidence: "e",
        potentialRisks: "r",
        confidence: 0.9,
      },
    ]);

    const res = await call("POST", "/api/candidates/source", {
      jobId: job!.id,
      count: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toBe(0);
    expect(res.body.candidates).toHaveLength(1);
    seededCandidateIds.push(res.body.candidates[0].id);

    // Confirm exactly one active row exists with that email — the new one.
    const active = await db
      .select()
      .from(candidatesTable)
      .where(and(eq(candidatesTable.email, email), isNull(candidatesTable.deletedAt)));
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(res.body.candidates[0].id);
  });

  it("still skips an ACTIVE duplicate githubUrl when re-sourcing", async () => {
    const [job] = await db
      .insert(jobsTable)
      .values({
        title: `${TEST_MARKER}source-job-dup`,
        description: "d",
        location: "Remote",
        seniority: "Mid",
        mustHaveSkills: [],
      })
      .returning();
    seededJobIds.push(job!.id);

    const githubUrl = `https://github.com/${TEST_MARKER}active-${Date.now()}`;
    const [active] = await db
      .insert(candidatesTable)
      .values({
        name: `${TEST_MARKER}source-active`,
        githubUrl,
      })
      .returning();
    seededCandidateIds.push(active!.id);

    sourcingRun.mockResolvedValue([
      {
        name: `${TEST_MARKER}source-dup`,
        headline: "h",
        location: "l",
        currentCompany: "c",
        email: null,
        linkedinUrl: "",
        githubUrl,
        skills: [],
        summary: "s",
        evidence: "e",
        potentialRisks: "r",
        confidence: 0.9,
      },
    ]);

    const res = await call("POST", "/api/candidates/source", {
      jobId: job!.id,
      count: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.candidates).toHaveLength(0);
  });
});
