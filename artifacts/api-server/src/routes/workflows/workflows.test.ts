import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { inArray } from "drizzle-orm";
import {
  db,
  candidatesTable,
  jobsTable,
  agentRunsTable,
  aiEvaluationsTable,
} from "@workspace/db";
import workflowsRouter from "./index";

const app = express();
app.use(express.json());
app.use("/api", workflowsRouter);

const TEST_MARKER = "workflows.test:";

const seededJobIds: number[] = [];
const seededCandidateIds: number[] = [];
const seededRunIds: number[] = [];

afterEach(async () => {
  if (seededRunIds.length > 0) {
    await db
      .delete(agentRunsTable)
      .where(inArray(agentRunsTable.id, seededRunIds));
    seededRunIds.length = 0;
  }
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

describe("GET /api/workflows/jobs/:jobId/latest hides soft-deleted candidates", () => {
  it("excludes evaluations whose candidate has been soft-deleted", async () => {
    const [job] = await db
      .insert(jobsTable)
      .values({
        title: `${TEST_MARKER}latest`,
        description: "d",
        location: "Remote",
        seniority: "Mid",
        mustHaveSkills: [],
      })
      .returning();
    seededJobIds.push(job!.id);

    const [live] = await db
      .insert(candidatesTable)
      .values({ name: `${TEST_MARKER}live`, skills: [] })
      .returning();
    const [trashed] = await db
      .insert(candidatesTable)
      .values({
        name: `${TEST_MARKER}trashed`,
        skills: [],
        deletedAt: new Date(),
        deletionBatchId: "workflows-test-batch",
      })
      .returning();
    seededCandidateIds.push(live!.id, trashed!.id);

    const [run] = await db
      .insert(agentRunsTable)
      .values({ jobId: job!.id, status: "completed", dataMode: "mock" })
      .returning();
    seededRunIds.push(run!.id);

    await db.insert(aiEvaluationsTable).values([
      {
        runId: run!.id,
        jobId: job!.id,
        candidateId: live!.id,
        score: 80,
        fitScore: 80,
        decisionScore: 80,
        dataConfidenceScore: 80,
        confidenceLevel: "High",
        strengths: [],
        gaps: [],
        risks: [],
        recommendation: "Yes",
      },
      {
        runId: run!.id,
        jobId: job!.id,
        candidateId: trashed!.id,
        score: 80,
        fitScore: 80,
        decisionScore: 80,
        dataConfidenceScore: 80,
        confidenceLevel: "High",
        strengths: [],
        gaps: [],
        risks: [],
        recommendation: "Yes",
      },
    ]);

    const res = await call("GET", `/api/workflows/jobs/${job!.id}/latest`);
    expect(res.status).toBe(200);
    const evalCandidateIds = (
      res.body.evaluations as Array<{ candidateId: number }>
    ).map((e) => e.candidateId);
    expect(evalCandidateIds).toContain(live!.id);
    expect(evalCandidateIds).not.toContain(trashed!.id);
  });
});
