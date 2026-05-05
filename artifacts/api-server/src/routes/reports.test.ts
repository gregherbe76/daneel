import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import PDFDocument from "pdfkit";
import {
  db,
  jobsTable,
  candidatesTable,
  agentRunsTable,
  jobInsightsTable,
  shortlistsTable,
  aiEvaluationsTable,
} from "@workspace/db";
import * as safeFetch from "../lib/safe-fetch";
import app from "../app";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x04, 0x00,
  0x09, 0xfb, 0x03, 0xfd, 0xfb, 0x5e, 0x6b, 0x2b, 0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const seededJobIds: number[] = [];
const seededCandidateIds: number[] = [];
const seededRunIds: number[] = [];

async function seedReport(jobOverrides: Partial<typeof jobsTable.$inferInsert> = {}) {
  const [job] = await db
    .insert(jobsTable)
    .values({
      title: `reports.test job ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description: "d",
      location: "Remote",
      seniority: "Mid",
      mustHaveSkills: [],
      ...jobOverrides,
    })
    .returning();
  seededJobIds.push(job!.id);

  const [candidate] = await db
    .insert(candidatesTable)
    .values({
      name: `Reports Candidate ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      email: `reports-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      skills: [],
    })
    .returning();
  seededCandidateIds.push(candidate!.id);

  const [run] = await db
    .insert(agentRunsTable)
    .values({ jobId: job!.id, status: "completed", dataMode: "mock" })
    .returning();
  seededRunIds.push(run!.id);

  await db.insert(jobInsightsTable).values({
    runId: run!.id,
    jobId: job!.id,
    mustHaveSkills: [],
    seniority: "Mid",
    evaluationCriteria: [],
    idealCandidateProfile: "ideal",
  });

  await db.insert(aiEvaluationsTable).values({
    runId: run!.id,
    jobId: job!.id,
    candidateId: candidate!.id,
    score: 70,
    fitScore: 70,
    decisionScore: 70,
    dataConfidenceScore: 80,
    confidenceLevel: "High",
    strengths: ["x"],
    gaps: [],
    risks: [],
    recommendation: "Yes",
  });

  await db.insert(shortlistsTable).values({
    runId: run!.id,
    jobId: job!.id,
    rankedCandidateIds: [candidate!.id],
    summaries: [
      {
        candidateId: candidate!.id,
        candidateName: candidate!.name,
        whyRelevant: "w",
        keyRisks: "k",
        finalRecommendation: "Hire.",
      },
    ],
  });

  return { jobId: job!.id, candidate: candidate! };
}

async function cleanup() {
  if (seededRunIds.length > 0) {
    await db.delete(agentRunsTable).where(inArray(agentRunsTable.id, seededRunIds));
    seededRunIds.length = 0;
  }
  if (seededCandidateIds.length > 0) {
    await db.delete(candidatesTable).where(inArray(candidatesTable.id, seededCandidateIds));
    seededCandidateIds.length = 0;
  }
  if (seededJobIds.length > 0) {
    await db.delete(jobsTable).where(inArray(jobsTable.id, seededJobIds));
    seededJobIds.length = 0;
  }
}

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanup();
});

function bufferParser() {
  return (response: NodeJS.ReadableStream, callback: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    response.on("data", (c: Buffer) => chunks.push(c));
    response.on("end", () => callback(null, Buffer.concat(chunks)));
  };
}

describe("GET /api/reports/job/:jobId/latest/markdown — client logo + name", () => {
  it("includes a markdown image reference for the client logo and the client name in the header", async () => {
    const clientName = "Acme Robotics";
    const clientLogoUrl = "https://example.com/acme-logo.png";
    const { jobId } = await seedReport({ clientName, clientLogoUrl });

    const res = await request(app).get(`/api/reports/job/${jobId}/latest/markdown`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/markdown/);
    const body = res.text;
    expect(body).toContain(`![${clientName}](${clientLogoUrl})`);
    expect(body).toContain(`**Client:** ${clientName}`);
  });

  it("omits client logo image and client line when neither is set on the job", async () => {
    const { jobId } = await seedReport({ clientName: null, clientLogoUrl: null });

    const res = await request(app).get(`/api/reports/job/${jobId}/latest/markdown`);

    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).not.toMatch(/^!\[/m);
    expect(body).not.toContain("**Client:**");
  });
});

describe("GET /api/reports/job/:jobId/latest/pdf — client logo handling", () => {
  it("embeds the client logo image when the fetch succeeds and renders the client name in the header", async () => {
    const clientName = "Acme Robotics";
    const clientLogoUrl = "https://example.com/acme-logo.png";
    const { jobId } = await seedReport({ clientName, clientLogoUrl });

    const fetchSpy = vi
      .spyOn(safeFetch, "safeFetchLogoBytes")
      .mockResolvedValue(PNG_BYTES);
    const imageSpy = vi.spyOn(PDFDocument.prototype, "image");
    const textSpy = vi.spyOn(PDFDocument.prototype, "text");

    const res = await request(app)
      .get(`/api/reports/job/${jobId}/latest/pdf`)
      .buffer(true)
      .parse(bufferParser());

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect((res.body as Buffer).slice(0, 4).toString()).toBe("%PDF");

    // The client logo URL was fetched through the SSRF-hardened path.
    expect(fetchSpy).toHaveBeenCalledWith(clientLogoUrl);

    // doc.image was invoked with the bytes returned by safeFetchLogoBytes
    // (i.e. the client logo was actually embedded in the PDF).
    const imageCalls = imageSpy.mock.calls.filter((c) => Buffer.isBuffer(c[0]) && (c[0] as Buffer).equals(PNG_BYTES));
    expect(imageCalls.length).toBeGreaterThanOrEqual(1);

    // The header text includes "Client: <name>".
    const textArgs = textSpy.mock.calls.map((c) => String(c[0] ?? ""));
    expect(textArgs.some((t) => t.includes(`Client: ${clientName}`))).toBe(true);
  });

  it("does not crash and still renders the header when the client logo fetch fails", async () => {
    const clientName = "Acme Robotics";
    const clientLogoUrl = "https://example.com/broken-logo.png";
    const { jobId } = await seedReport({ clientName, clientLogoUrl });

    // safeFetchLogoBytes returns null on failure (network error, blocked URL,
    // non-OK status, etc) — that's the contract we rely on.
    const fetchSpy = vi
      .spyOn(safeFetch, "safeFetchLogoBytes")
      .mockResolvedValue(null);
    const imageSpy = vi.spyOn(PDFDocument.prototype, "image");
    const textSpy = vi.spyOn(PDFDocument.prototype, "text");

    const res = await request(app)
      .get(`/api/reports/job/${jobId}/latest/pdf`)
      .buffer(true)
      .parse(bufferParser());

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect((res.body as Buffer).slice(0, 4).toString()).toBe("%PDF");
    expect((res.body as Buffer).length).toBeGreaterThan(100);

    expect(fetchSpy).toHaveBeenCalledWith(clientLogoUrl);

    // No image call should have used our PNG bytes — fetch returned null.
    const imageCalls = imageSpy.mock.calls.filter((c) => Buffer.isBuffer(c[0]) && (c[0] as Buffer).equals(PNG_BYTES));
    expect(imageCalls.length).toBe(0);

    // The header text still includes the job title and the client name —
    // the missing logo is best-effort and never breaks the report.
    const textArgs = textSpy.mock.calls.map((c) => String(c[0] ?? ""));
    expect(textArgs.some((t) => t.includes(`Client: ${clientName}`))).toBe(true);
  });
});
