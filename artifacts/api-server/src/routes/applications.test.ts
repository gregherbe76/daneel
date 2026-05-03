import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  candidatesTable,
  jobsTable,
  applicationsTable,
} from "@workspace/db";
import applicationsRouter from "./applications";
import jobsRouter from "./jobs";

const app = express();
app.use(express.json());
app.use("/api", applicationsRouter);
app.use("/api", jobsRouter);

const TEST_MARKER = "applications.test:";

const seededCandidateIds: number[] = [];
const seededJobIds: number[] = [];

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
});

async function call(method: "GET", url: string) {
  return await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("no address"));
        return;
      }
      fetch(`http://127.0.0.1:${address.port}${url}`, { method })
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

async function seed(name: string) {
  const [job] = await db
    .insert(jobsTable)
    .values({
      title: `${TEST_MARKER}${name}`,
      description: "d",
      location: "l",
      seniority: "Mid",
      mustHaveSkills: [],
    })
    .returning();
  const [liveCand] = await db
    .insert(candidatesTable)
    .values({ name: `${TEST_MARKER}${name}-live` })
    .returning();
  const [trashedCand] = await db
    .insert(candidatesTable)
    .values({
      name: `${TEST_MARKER}${name}-trashed`,
      deletedAt: new Date(),
      deletionBatchId: "applications-test-batch",
    })
    .returning();
  seededJobIds.push(job!.id);
  seededCandidateIds.push(liveCand!.id, trashedCand!.id);

  const [liveApp] = await db
    .insert(applicationsTable)
    .values({ jobId: job!.id, candidateId: liveCand!.id, stage: "Sourced" })
    .returning();
  const [trashedApp] = await db
    .insert(applicationsTable)
    .values({ jobId: job!.id, candidateId: trashedCand!.id, stage: "Sourced" })
    .returning();

  return {
    job: job!,
    liveCand: liveCand!,
    trashedCand: trashedCand!,
    liveApp: liveApp!,
    trashedApp: trashedApp!,
  };
}

describe("applications routes hide soft-deleted candidates", () => {
  it("excludes soft-deleted candidates from GET /applications", async () => {
    const seeded = await seed("list");

    const res = await call("GET", "/api/applications");
    expect(res.status).toBe(200);
    const candidateIds = (res.body as Array<{ candidateId: number }>).map(
      (r) => r.candidateId,
    );
    expect(candidateIds).toContain(seeded.liveCand.id);
    expect(candidateIds).not.toContain(seeded.trashedCand.id);
  });

  it("returns 404 for GET /applications/:id when the candidate is trashed", async () => {
    const seeded = await seed("detail");

    const live = await call("GET", `/api/applications/${seeded.liveApp.id}`);
    expect(live.status).toBe(200);

    const trashed = await call(
      "GET",
      `/api/applications/${seeded.trashedApp.id}`,
    );
    expect(trashed.status).toBe(404);
  });

  it("excludes soft-deleted candidates from /jobs/:id/applications", async () => {
    const seeded = await seed("pipeline");

    const res = await call("GET", `/api/jobs/${seeded.job.id}/applications`);
    expect(res.status).toBe(200);
    const candidateIds = (res.body as Array<{ candidateId: number }>).map(
      (r) => r.candidateId,
    );
    expect(candidateIds).toContain(seeded.liveCand.id);
    expect(candidateIds).not.toContain(seeded.trashedCand.id);
  });

  it("excludes soft-deleted candidates and their applications from /pipeline/summary", async () => {
    const seeded = await seed("summary");

    const before = await call("GET", "/api/pipeline/summary");
    expect(before.status).toBe(200);
    const totalCandidates = before.body.totalCandidates as number;
    const totalApplications = before.body.totalApplications as number;

    // Trash the live candidate too and check both counts drop by exactly 1.
    await db
      .update(candidatesTable)
      .set({ deletedAt: new Date(), deletionBatchId: "summary-batch" })
      .where(eq(candidatesTable.id, seeded.liveCand.id));

    const after = await call("GET", "/api/pipeline/summary");
    expect(after.body.totalCandidates).toBe(totalCandidates - 1);
    expect(after.body.totalApplications).toBe(totalApplications - 1);
  });
});
