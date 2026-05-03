import { Router } from "express";
import multer from "multer";
import { db, candidatesTable, applicationsTable, jobsTable, agentProvidersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveSourcingProvider, providerFromRow } from "./workflows/providers";
import type { SourcingCandidate } from "./workflows/providers/native-openai-sourcing";
import { logger } from "../lib/logger";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ---------- CSV helpers ----------

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const cols: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function resolveField(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== "") return row[c];
  }
  return "";
}

function mapCSVRow(row: Record<string, string>) {
  return {
    name: resolveField(row, ["name", "full name", "fullname", "candidate"]),
    email: resolveField(row, ["email", "email address", "e-mail"]),
    linkedIn: resolveField(row, ["linkedin", "linkedin url", "linkedin profile"]),
    skills: resolveField(row, ["skills", "skill", "technologies", "tech"])
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean),
    location: resolveField(row, ["location", "city", "region"]),
    headline: resolveField(row, ["headline", "title", "role", "position"]),
    currentCompany: resolveField(row, ["company", "current company", "employer"]),
    summary: resolveField(row, ["summary", "bio", "about", "description"]),
  };
}

// ---------- PDF helpers ----------

async function extractPDFText(buffer: Buffer): Promise<string> {
  try {
    // pdf-parse is a CJS module externalized from the bundle
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = (globalThis as any).require("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text;
  } catch {
    return "";
  }
}

function extractNameFromText(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (
      /^[A-Z][a-z]+ [A-Z][a-z]+/.test(line) &&
      line.length < 50 &&
      !line.includes("@") &&
      !line.includes("http")
    ) {
      return line.replace(/[^a-zA-Z\s\-'.]/g, "").trim();
    }
  }
  return lines[0]?.substring(0, 60) ?? "Unknown";
}

function extractEmailFromText(text: string): string {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : "";
}

function extractLinkedInFromText(text: string): string {
  const match = text.match(/linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/i);
  return match ? `https://www.${match[0]}` : "";
}

function extractSkillsFromText(text: string): string[] {
  const skillKeywords = [
    "javascript","typescript","python","java","go","rust","ruby","php","swift","kotlin",
    "react","vue","angular","svelte","next.js","nuxt","node.js","express","fastapi",
    "django","flask","spring","rails",
    "postgresql","mysql","mongodb","redis","elasticsearch","sqlite",
    "aws","gcp","azure","docker","kubernetes","terraform","ci/cd","github actions",
    "graphql","rest","grpc","websockets",
    "figma","tailwind","css","html","sass",
    "machine learning","ml","ai","llm","openai","langchain","pytorch","tensorflow",
    "agile","scrum","jira","linear",
  ];
  const lower = text.toLowerCase();
  return skillKeywords.filter((k) => lower.includes(k));
}

function extractSummaryFromText(text: string): string {
  const lower = text.toLowerCase();
  const markers = ["summary", "profile", "about", "objective", "experience"];
  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx !== -1) {
      const chunk = text.substring(idx + marker.length, idx + marker.length + 400).trim();
      const cleaned = chunk.replace(/\n+/g, " ").trim();
      if (cleaned.length > 40) return cleaned.substring(0, 300);
    }
  }
  return "";
}

// ---------- Application helper ----------

async function createApplications(jobId: number, candidateIds: number[]): Promise<void> {
  if (!jobId || candidateIds.length === 0) return;
  // Only create applications for candidates not already applied to this job
  const existing = await db
    .select({ candidateId: applicationsTable.candidateId })
    .from(applicationsTable)
    .where(eq(applicationsTable.jobId, jobId));
  const existingIds = new Set(existing.map((r) => r.candidateId));
  const newIds = candidateIds.filter((id) => !existingIds.has(id));
  if (newIds.length === 0) return;
  await db.insert(applicationsTable).values(
    newIds.map((candidateId) => ({ jobId, candidateId, stage: "Sourced" as const }))
  );
}

// ---------- Routes ----------

// POST /api/candidates/import/csv/preview
// Returns parsed rows without saving — used by the import modal preview step.
router.post(
  "/candidates/import/csv/preview",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const text = req.file.buffer.toString("utf-8");
    const rows = parseCSV(text);
    if (rows.length === 0) {
      res.status(400).json({ error: "CSV is empty or has no data rows" });
      return;
    }
    const mapped = rows.map(mapCSVRow).filter((r) => r.name && r.email);
    if (mapped.length === 0) {
      res.status(400).json({ error: "Could not detect name/email columns in CSV" });
      return;
    }
    res.json({ rows: mapped, total: rows.length, valid: mapped.length });
  },
);

// POST /api/candidates/import/cv/preview
// Extracts candidate data from multiple PDFs without saving to DB.
// Returns an array of extracted candidate objects so the user can review before confirming.
router.post(
  "/candidates/import/cv/preview",
  upload.array("files", 50),
  async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const previewed: {
      fileName: string;
      name: string;
      email: string;
      linkedIn: string;
      skills: string[];
      summary: string;
      failed: boolean;
    }[] = [];

    for (const file of files) {
      const text = await extractPDFText(file.buffer);
      if (!text) {
        previewed.push({ fileName: file.originalname, name: "", email: "", linkedIn: "", skills: [], summary: "", failed: true });
        continue;
      }
      const email = extractEmailFromText(text);
      previewed.push({
        fileName: file.originalname,
        name: extractNameFromText(text),
        email,
        linkedIn: extractLinkedInFromText(text),
        skills: extractSkillsFromText(text),
        summary: extractSummaryFromText(text),
        failed: !email,
      });
    }

    res.json({ candidates: previewed });
  },
);

// POST /api/candidates/import/batch
// Unified confirm endpoint for all import methods (CSV, CV, LinkedIn).
// Accepts an array of candidate objects + optional jobId.
// Creates candidates (skipping duplicates by email) and optional job applications.
router.post("/candidates/import/batch", async (req, res) => {
  const {
    candidates,
    jobId,
  } = req.body as {
    candidates: {
      name: string;
      email: string;
      skills?: string[];
      linkedIn?: string;
      location?: string;
      headline?: string;
      currentCompany?: string;
      summary?: string;
      source?: string;
    }[];
    jobId?: number;
  };

  if (!Array.isArray(candidates) || candidates.length === 0) {
    res.status(400).json({ error: "No candidates provided" });
    return;
  }

  const createdCandidates: { id: number; name: string; email: string }[] = [];
  let skipped = 0;

  for (const row of candidates) {
    if (!row.name || !row.email) continue;
    try {
      const [created] = await db
        .insert(candidatesTable)
        .values({
          name: row.name,
          email: row.email.toLowerCase(),
          linkedIn: row.linkedIn || null,
          skills: row.skills ?? [],
          location: row.location || null,
          headline: row.headline || null,
          currentCompany: row.currentCompany || null,
          summary: row.summary || null,
          source: row.source || "Imported",
        })
        .onConflictDoNothing()
        .returning({ id: candidatesTable.id, name: candidatesTable.name, email: candidatesTable.email });

      if (created) {
        createdCandidates.push(created);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  // Optionally create job applications for all newly created candidates
  if (jobId && createdCandidates.length > 0) {
    await createApplications(jobId, createdCandidates.map((c) => c.id));
  }

  res.json({
    created: createdCandidates.length,
    skipped,
    candidates: createdCandidates,
  });
});

// ---------- AI Sourcing ----------

// POST /api/candidates/source
// Calls the configured (or specified) sourcing provider, saves results to DB,
// and creates job applications — all in a single request.
// Body: { jobId, providerId?, count?, location?, seniority? }
router.post("/candidates/source", async (req, res) => {
  const { jobId, providerId, count = 7, location, seniority } = req.body as {
    jobId: number;
    providerId?: number;
    count?: number;
    location?: string;
    seniority?: string;
  };

  if (!jobId) {
    res.status(400).json({ error: "jobId is required" });
    return;
  }

  const clampedCount = Math.min(20, Math.max(5, Number(count) || 7));

  // Fetch the job for context
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, Number(jobId)));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Resolve provider
  let provider: Awaited<ReturnType<typeof resolveSourcingProvider>>["provider"];
  let sourceTag: string;

  if (providerId) {
    const [row] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, Number(providerId)));
    if (!row || !row.enabled) {
      res.status(400).json({ error: "Provider not found or disabled" });
      return;
    }
    provider = providerFromRow(row);
    sourceTag = row.type === "twin_webhook" || row.type === "custom_webhook" ? "Twin" : "Mock";
  } else {
    const resolved = await resolveSourcingProvider();
    provider = resolved.provider;
    sourceTag = resolved.isTwin ? "Twin" : "Mock";
  }

  logger.info({ jobId, provider: provider.name, sourceTag, count: clampedCount }, "Direct sourcing requested");

  // Build payload — pass filters so external providers can use them
  const jobPayload = {
    title: job.title,
    description: job.description,
    location: location?.trim() || job.location,
    seniority: seniority?.trim() || job.seniority,
    mustHaveSkills: job.mustHaveSkills,
  };

  // Minimal insight placeholder for providers that expect it
  const insight = {
    idealCandidateProfile: `${seniority?.trim() || job.seniority} ${job.title} candidate`,
    evaluationCriteria: job.mustHaveSkills,
    redFlags: [] as string[],
    mustHaveSkillsAssessment: [] as string[],
  };

  // Call provider — throw on error so the catch below returns a clean message
  let raw: SourcingCandidate[];
  try {
    raw = (await provider.run({
      step: "sourcing",
      runId: 0,
      jobId: Number(jobId),
      payload: { job: jobPayload, insight, count: clampedCount, filters: { location, seniority } },
    })) as SourcingCandidate[];
  } catch (err) {
    logger.error({ jobId, provider: provider.name, err }, "Sourcing provider call failed");
    res.status(502).json({
      error: `Provider "${provider.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  if (!Array.isArray(raw)) {
    res.status(502).json({ error: `Provider "${provider.name}" returned an unexpected response format.` });
    return;
  }

  // Deduplicate against existing candidates
  const existingRows = await db.select({ email: candidatesTable.email }).from(candidatesTable);
  const existingEmails = new Set(existingRows.map((r) => r.email.toLowerCase()));

  const created: {
    id: number; name: string; email: string;
    headline: string | null; location: string | null; currentCompany: string | null;
    skills: string[]; summary: string | null; source: string | null;
  }[] = [];
  let skipped = 0;

  for (const c of raw) {
    const emailKey = c.email?.toLowerCase();
    if (!emailKey || existingEmails.has(emailKey)) { skipped++; continue; }
    existingEmails.add(emailKey);

    try {
      const [inserted] = await db
        .insert(candidatesTable)
        .values({
          name: c.name,
          email: c.email,
          linkedIn: c.linkedinUrl || null,
          summary: c.summary || null,
          skills: Array.isArray(c.skills) ? c.skills : [],
          headline: c.headline || null,
          location: c.location || null,
          currentCompany: c.currentCompany || null,
          githubUrl: c.githubUrl || null,
          source: sourceTag,
        })
        .returning({
          id: candidatesTable.id,
          name: candidatesTable.name,
          email: candidatesTable.email,
          headline: candidatesTable.headline,
          location: candidatesTable.location,
          currentCompany: candidatesTable.currentCompany,
          skills: candidatesTable.skills,
          summary: candidatesTable.summary,
          source: candidatesTable.source,
        });

      if (inserted) {
        created.push(inserted);
        await db
          .insert(applicationsTable)
          .values({
            jobId: Number(jobId),
            candidateId: inserted.id,
            stage: "Sourced",
            notes: [
              `AI Sourced — provider: ${provider.name}`,
              c.evidence ? `Evidence: ${c.evidence}` : null,
              c.potentialRisks ? `Risks: ${c.potentialRisks}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          })
          .onConflictDoNothing();
      }
    } catch (err) {
      logger.warn({ email: c.email, err }, "Failed to save sourced candidate");
      skipped++;
    }
  }

  logger.info({ jobId, provider: provider.name, created: created.length, skipped }, "Direct sourcing completed");
  res.json({ created: created.length, skipped, candidates: created });
});

// Legacy endpoints kept for backward compatibility

// POST /api/candidates/import/csv/confirm (legacy)
router.post("/candidates/import/csv/confirm", async (req, res) => {
  const { rows, jobId } = req.body as {
    rows: {
      name: string;
      email: string;
      linkedIn?: string;
      skills?: string[];
      location?: string;
      headline?: string;
      currentCompany?: string;
      summary?: string;
    }[];
    jobId?: number;
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "No rows provided" });
    return;
  }

  const createdIds: number[] = [];
  const results = { created: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    if (!row.name || !row.email) continue;
    try {
      const [created] = await db
        .insert(candidatesTable)
        .values({
          name: row.name,
          email: row.email.toLowerCase(),
          linkedIn: row.linkedIn || null,
          skills: row.skills ?? [],
          location: row.location || null,
          headline: row.headline || null,
          currentCompany: row.currentCompany || null,
          summary: row.summary || null,
          source: "CSV Import",
        })
        .onConflictDoNothing()
        .returning({ id: candidatesTable.id });
      if (created) {
        results.created++;
        createdIds.push(created.id);
      } else {
        results.skipped++;
      }
    } catch {
      results.skipped++;
      results.errors.push(row.email);
    }
  }

  if (jobId && createdIds.length > 0) {
    await createApplications(jobId, createdIds);
  }

  res.json(results);
});

// POST /api/candidates/import/cv (legacy)
router.post(
  "/candidates/import/cv",
  upload.array("files", 50),
  async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const jobId = req.body.jobId ? Number(req.body.jobId) : undefined;
    const results = { created: 0, skipped: 0, failed: 0, candidates: [] as { name: string; email: string }[] };
    const createdIds: number[] = [];

    for (const file of files) {
      const text = await extractPDFText(file.buffer);
      if (!text) { results.failed++; continue; }
      const email = extractEmailFromText(text);
      if (!email) { results.failed++; continue; }

      const name = extractNameFromText(text);
      const linkedIn = extractLinkedInFromText(text);
      const skills = extractSkillsFromText(text);
      const summary = extractSummaryFromText(text);

      try {
        const [created] = await db
          .insert(candidatesTable)
          .values({ name, email, linkedIn: linkedIn || null, skills, summary: summary || null, source: "CV Upload" })
          .onConflictDoNothing()
          .returning({ id: candidatesTable.id, name: candidatesTable.name, email: candidatesTable.email });

        if (created) {
          results.created++;
          results.candidates.push({ name: created.name, email: created.email });
          createdIds.push(created.id);
        } else {
          results.skipped++;
        }
      } catch {
        results.failed++;
      }
    }

    if (jobId && createdIds.length > 0) {
      await createApplications(jobId, createdIds);
    }

    res.json(results);
  },
);

export default router;
