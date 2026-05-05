import { eq } from "drizzle-orm";
import {
  db,
  pool,
  jobsTable,
  candidatesTable,
  applicationsTable,
} from "@workspace/db";

const SEED_MARKER_TITLE = "[DEMO] Senior Full-Stack Engineer";

async function main() {
  const existing = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.title, SEED_MARKER_TITLE))
    .limit(1);

  if (existing.length > 0) {
    console.log(
      `[seed-demo] Marker job "${SEED_MARKER_TITLE}" already present — skipping.`,
    );
    await pool.end();
    return;
  }

  console.log("[seed-demo] Inserting demo data…");

  const insertedJobs = await db
    .insert(jobsTable)
    .values([
      {
        title: SEED_MARKER_TITLE,
        description:
          "Build product-facing features end-to-end across React, Node, and Postgres. " +
          "You will own scope from brief to shipped, work directly with the founders, " +
          "and care about the user impact of what you build.",
        location: "Remote (EU/US overlap)",
        seniority: "Senior",
        mustHaveSkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
      },
      {
        title: "[DEMO] Founding Product Designer",
        description:
          "Design the core flows of a vertical AI product. Own the design system, " +
          "ship weekly, and partner with engineering on prototypes.",
        location: "Hybrid · Berlin",
        seniority: "Lead",
        mustHaveSkills: ["Figma", "Design Systems", "Prototyping"],
      },
    ])
    .returning();

  const [job1, job2] = insertedJobs;

  const insertedCandidates = await db
    .insert(candidatesTable)
    .values([
      {
        name: "Ada Okafor",
        email: "ada.okafor@example.com",
        linkedIn: "https://www.linkedin.com/in/ada-okafor-demo",
        headline: "Senior full-stack engineer · ex-Stripe",
        location: "Lisbon, Portugal",
        currentCompany: "Stripe",
        summary:
          "8 years building payments and dashboard products. Shipped end-to-end on a 4-person team.",
        skills: ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS"],
        source: "Demo Seed",
        emailSource: "manual",
      },
      {
        name: "Bruno Carvalho",
        email: "bruno.carvalho@example.com",
        linkedIn: "https://www.linkedin.com/in/bruno-carvalho-demo",
        headline: "Full-stack TypeScript engineer",
        location: "Remote · Brazil",
        currentCompany: "Independent",
        summary:
          "Freelance contractor for early-stage startups. Strong product sense, comfortable owning scope from brief to ship.",
        skills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
        source: "Demo Seed",
        emailSource: "manual",
      },
      {
        name: "Camille Laurent",
        email: "camille.laurent@example.com",
        linkedIn: "https://www.linkedin.com/in/camille-laurent-demo",
        headline: "Product designer · design systems",
        location: "Berlin, Germany",
        currentCompany: "Pitch",
        summary:
          "Lead product designer with deep design-systems experience. Loves shipping fast with engineering.",
        skills: ["Figma", "Design Systems", "Prototyping", "Motion"],
        source: "Demo Seed",
        emailSource: "manual",
      },
    ])
    .returning();

  await db.insert(applicationsTable).values([
    {
      jobId: job1.id,
      candidateId: insertedCandidates[0].id,
      stage: "Screened",
    },
    {
      jobId: job1.id,
      candidateId: insertedCandidates[1].id,
      stage: "Sourced",
    },
    {
      jobId: job2.id,
      candidateId: insertedCandidates[2].id,
      stage: "Interview",
    },
  ]);

  console.log(
    `[seed-demo] Inserted ${insertedJobs.length} jobs, ${insertedCandidates.length} candidates, 3 applications.`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("[seed-demo] Failed:", err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
