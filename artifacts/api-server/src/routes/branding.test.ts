import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import PDFDocument from "pdfkit";
import {
  db,
  brandingSettingsTable,
  jobsTable,
  candidatesTable,
  agentRunsTable,
  jobInsightsTable,
  shortlistsTable,
  aiEvaluationsTable,
} from "@workspace/db";
import { branding as defaultBranding } from "@workspace/branding";
import app from "../app";

const SINGLETON_ID = 1;

async function clearBrandingRow() {
  await db
    .delete(brandingSettingsTable)
    .where(eq(brandingSettingsTable.id, SINGLETON_ID));
}

async function readBrandingRow() {
  const [row] = await db
    .select()
    .from(brandingSettingsTable)
    .where(eq(brandingSettingsTable.id, SINGLETON_ID));
  return row ?? null;
}

beforeEach(async () => {
  await clearBrandingRow();
});

afterAll(async () => {
  await clearBrandingRow();
});

describe("GET /api/branding", () => {
  it("returns template defaults when the singleton row is missing", async () => {
    const res = await request(app).get("/api/branding");
    expect(res.status).toBe(200);
    expect(res.body.colorPrimary).toBe(defaultBranding.colors.primary);
    expect(res.body.colorAccent).toBe(defaultBranding.colors.accent);
    expect(res.body.productName).toBe(defaultBranding.productName);
  });

  it("returns template defaults when the row exists but color columns are NULL", async () => {
    await db.insert(brandingSettingsTable).values({
      id: SINGLETON_ID,
      productName: "Custom Co",
      colorPrimary: null,
      colorAccent: null,
    });

    const res = await request(app).get("/api/branding");
    expect(res.status).toBe(200);
    expect(res.body.productName).toBe("Custom Co");
    expect(res.body.colorPrimary).toBe(defaultBranding.colors.primary);
    expect(res.body.colorAccent).toBe(defaultBranding.colors.accent);
  });
});

describe("PUT /api/branding color validation", () => {
  it("accepts a valid 6-digit hex color and persists it", async () => {
    const res = await request(app)
      .put("/api/branding")
      .send({ colorPrimary: "#7C5CFF", colorAccent: "#aabbcc" });

    expect(res.status).toBe(200);
    expect(res.body.colorPrimary).toBe("#7C5CFF");
    expect(res.body.colorAccent).toBe("#aabbcc");

    const row = await readBrandingRow();
    expect(row?.colorPrimary).toBe("#7C5CFF");
    expect(row?.colorAccent).toBe("#aabbcc");
  });

  it("rejects a malformed hex value with 400 and does not write", async () => {
    const res = await request(app)
      .put("/api/branding")
      .send({ colorPrimary: "not-a-color" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toMatch(/colorPrimary/);

    const row = await readBrandingRow();
    expect(row).toBeNull();
  });

  it("rejects a 3-digit shorthand hex with 400 (only 6-digit hex allowed)", async () => {
    const res = await request(app)
      .put("/api/branding")
      .send({ colorAccent: "#abc" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/colorAccent/);
  });

  it("clears the override back to the template default when given an empty string", async () => {
    // Seed a saved override first.
    await db.insert(brandingSettingsTable).values({
      id: SINGLETON_ID,
      colorPrimary: "#123456",
      colorAccent: "#abcdef",
    });

    const res = await request(app)
      .put("/api/branding")
      .send({ colorPrimary: "", colorAccent: "" });

    expect(res.status).toBe(200);
    // Response should reflect the template defaults once cleared.
    expect(res.body.colorPrimary).toBe(defaultBranding.colors.primary);
    expect(res.body.colorAccent).toBe(defaultBranding.colors.accent);

    // DB columns should be NULL, not empty strings — that's the contract that
    // makes loadBrandingSettings fall back to the template.
    const row = await readBrandingRow();
    expect(row?.colorPrimary).toBeNull();
    expect(row?.colorAccent).toBeNull();
  });
});

describe("PUT /api/branding logo URL validation", () => {
  it("accepts an /objects/... path produced by the upload endpoint", async () => {
    const res = await request(app)
      .put("/api/branding")
      .send({ logoUrl: "/objects/uploads/abc-123.png" });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe("/objects/uploads/abc-123.png");
  });

  it("rejects http:// URLs (must be https)", async () => {
    const res = await request(app)
      .put("/api/branding")
      .send({ logoUrl: "http://example.com/logo.png" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/https/i);
  });

  it("rejects URLs pointing at private/loopback IPs", async () => {
    const res = await request(app)
      .put("/api/branding")
      .send({ logoUrl: "https://127.0.0.1/logo.png" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/public/i);
  });

  it("rejects garbage that isn't a URL at all", async () => {
    const res = await request(app)
      .put("/api/branding")
      .send({ logoUrl: "not a url" });
    expect(res.status).toBe(400);
  });

  it("accepts a normal public https logo URL", async () => {
    const res = await request(app)
      .put("/api/branding")
      .send({ logoUrl: "https://example.com/logo.png" });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe("https://example.com/logo.png");
  });

  it("clears the override when an empty string is sent", async () => {
    await request(app)
      .put("/api/branding")
      .send({ logoUrl: "/objects/uploads/abc-123.png" });
    const res = await request(app)
      .put("/api/branding")
      .send({ logoUrl: "" });
    expect(res.status).toBe(200);
    // Cleared rows fall back to the template default, which is non-empty.
    expect(res.body.logoUrl).not.toBe("/objects/uploads/abc-123.png");
  });
});

describe("GET /api/reports/job/:jobId/latest/pdf uses branding override colors", () => {
  const seededJobIds: number[] = [];
  const seededCandidateIds: number[] = [];
  const seededRunIds: number[] = [];

  afterEach(async () => {
    if (seededRunIds.length > 0) {
      await db.delete(agentRunsTable).where(inArray(agentRunsTable.id, seededRunIds));
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
    vi.restoreAllMocks();
  });

  async function seedReport() {
    const [job] = await db
      .insert(jobsTable)
      .values({
        title: `branding.test PDF ${Date.now()}`,
        description: "d",
        location: "Remote",
        seniority: "Mid",
        mustHaveSkills: [],
      })
      .returning();
    seededJobIds.push(job!.id);

    const [candidate] = await db
      .insert(candidatesTable)
      .values({
        name: `Brand PDF Candidate ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        email: `brand-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
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
      // Score in the [60, 80) bucket so the PDF actually paints with ACCENT
      // (see scoreColor in reports.ts).
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

    return { jobId: job!.id };
  }

  it("paints the PDF with the configured override primary and accent colors", async () => {
    const PRIMARY = "#112233";
    const ACCENT = "#445566";
    await db.insert(brandingSettingsTable).values({
      id: SINGLETON_ID,
      colorPrimary: PRIMARY,
      colorAccent: ACCENT,
    });

    const { jobId } = await seedReport();

    // Capture every fill color the PDF route paints. The route reads the
    // primary/accent from loadBrandingSettings() and passes the strings
    // straight to doc.fill(...), so we can assert the overrides flow through
    // without having to decompress the PDF stream.
    const fillSpy = vi.spyOn(PDFDocument.prototype, "fill");

    const res = await request(app)
      .get(`/api/reports/job/${jobId}/latest/pdf`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect((res.body as Buffer).length).toBeGreaterThan(100);
    expect((res.body as Buffer).slice(0, 4).toString()).toBe("%PDF");

    const colorsUsed = fillSpy.mock.calls.map((c) => c[0]);
    expect(colorsUsed).toContain(PRIMARY);
    expect(colorsUsed).toContain(ACCENT);
    // And critically: the template defaults should NOT have been used as
    // primary/accent — that's the whole point of the override.
    expect(colorsUsed).not.toContain(defaultBranding.colors.primary);
    expect(colorsUsed).not.toContain(defaultBranding.colors.accent);
  });

  it("falls back to template default colors when no override is set", async () => {
    const { jobId } = await seedReport();
    const fillSpy = vi.spyOn(PDFDocument.prototype, "fill");

    const res = await request(app)
      .get(`/api/reports/job/${jobId}/latest/pdf`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const colorsUsed = fillSpy.mock.calls.map((c) => c[0]);
    expect(colorsUsed).toContain(defaultBranding.colors.primary);
    expect(colorsUsed).toContain(defaultBranding.colors.accent);
  });
});
