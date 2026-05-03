import { Router } from "express";
import multer from "multer";
import { db, candidatesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

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

function resolveField(
  row: Record<string, string>,
  candidates: string[],
): string {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== "") return row[c];
  }
  return "";
}

function mapCSVRow(row: Record<string, string>) {
  return {
    name: resolveField(row, ["name", "full name", "fullname", "candidate"]),
    email: resolveField(row, ["email", "email address", "e-mail"]),
    linkedIn: resolveField(row, [
      "linkedin",
      "linkedin url",
      "linkedin profile",
    ]),
    skills: resolveField(row, ["skills", "skill", "technologies", "tech"])
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean),
    location: resolveField(row, ["location", "city", "region"]),
    headline: resolveField(row, ["headline", "title", "role", "position"]),
    currentCompany: resolveField(row, [
      "company",
      "current company",
      "employer",
    ]),
    summary: resolveField(row, ["summary", "bio", "about", "description"]),
  };
}

// POST /api/candidates/import/csv/preview
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
      res
        .status(400)
        .json({ error: "Could not detect name/email columns in CSV" });
      return;
    }
    res.json({ rows: mapped, total: rows.length, valid: mapped.length });
  },
);

// POST /api/candidates/import/csv/confirm
router.post("/candidates/import/csv/confirm", async (req, res) => {
  const { rows } = req.body as {
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
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "No rows provided" });
    return;
  }

  const results = { created: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    if (!row.name || !row.email) continue;
    try {
      await db
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
          source: "Imported CSV",
        })
        .onConflictDoNothing();
      results.created++;
    } catch {
      results.skipped++;
      results.errors.push(row.email);
    }
  }

  res.json(results);
});

// ---------- CV / PDF helpers ----------

async function extractPDFText(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    return data.text;
  } catch {
    return "";
  }
}

function extractNameFromText(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
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

// POST /api/candidates/import/cv
router.post(
  "/candidates/import/cv",
  upload.array("files", 50),
  async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files uploaded" });
      return;
    }

    const results = { created: 0, skipped: 0, failed: 0, candidates: [] as { name: string; email: string }[] };

    for (const file of files) {
      const text = await extractPDFText(file.buffer);
      if (!text) {
        results.failed++;
        continue;
      }

      const email = extractEmailFromText(text);
      if (!email) {
        results.failed++;
        continue;
      }

      const name = extractNameFromText(text);
      const linkedIn = extractLinkedInFromText(text);
      const skills = extractSkillsFromText(text);
      const summary = extractSummaryFromText(text);

      try {
        const [created] = await db
          .insert(candidatesTable)
          .values({
            name,
            email,
            linkedIn: linkedIn || null,
            skills,
            summary: summary || null,
            source: "Uploaded CV",
          })
          .onConflictDoNothing()
          .returning();

        if (created) {
          results.created++;
          results.candidates.push({ name, email });
        } else {
          results.skipped++;
        }
      } catch {
        results.failed++;
      }
    }

    res.json(results);
  },
);

export default router;
