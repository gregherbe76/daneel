import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { inArray } from "drizzle-orm";
import {
  db,
  candidatesTable,
  jobsTable,
  candidateCommentsTable,
} from "@workspace/db";
import candidateNotesRouter from "./candidate-notes";

const app = express();
app.use(express.json());
app.use("/api", candidateNotesRouter);

const TEST_MARKER = "team-mentions.test:";

const seededJobIds: number[] = [];
const seededCandidateIds: number[] = [];

afterEach(async () => {
  if (seededCandidateIds.length > 0) {
    // Comments cascade-delete with candidate, but be explicit about cleanup.
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

describe("GET /api/team/:memberId/mentions hides comments on soft-deleted candidates", () => {
  it("does not surface @mentions whose candidate row has been trashed", async () => {
    const [job] = await db
      .insert(jobsTable)
      .values({
        title: `${TEST_MARKER}job`,
        description: "d",
        location: "l",
        seniority: "Mid",
        mustHaveSkills: [],
      })
      .returning();
    seededJobIds.push(job!.id);

    const [live] = await db
      .insert(candidatesTable)
      .values({ name: `${TEST_MARKER}live` })
      .returning();
    const [trashed] = await db
      .insert(candidatesTable)
      .values({
        name: `${TEST_MARKER}trashed`,
        deletedAt: new Date(),
        deletionBatchId: "team-mentions-test-batch",
      })
      .returning();
    seededCandidateIds.push(live!.id, trashed!.id);

    // Both comments mention the same teammate "alex".
    await db.insert(candidateCommentsTable).values([
      {
        candidateId: live!.id,
        jobId: job!.id,
        author: "Reviewer",
        body: "@Alex Rivera please review",
        mentions: [{ id: "alex", name: "Alex Rivera" }],
      },
      {
        candidateId: trashed!.id,
        jobId: job!.id,
        author: "Reviewer",
        body: "@Alex Rivera also look here",
        mentions: [{ id: "alex", name: "Alex Rivera" }],
      },
    ]);

    const res = await call("GET", "/api/team/alex/mentions");
    expect(res.status).toBe(200);

    const candidateNames = (
      res.body as Array<{ candidateName: string }>
    ).map((r) => r.candidateName);
    expect(candidateNames).toContain(`${TEST_MARKER}live`);
    expect(candidateNames).not.toContain(`${TEST_MARKER}trashed`);
  });
});
