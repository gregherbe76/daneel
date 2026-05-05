/**
 * Re-score historical AI evaluations with the HiringAI 3-dimension rubric.
 *
 * Why: the rubric used to have 4 dimensions (skillsMatch, experienceDepth,
 * autonomy, productMindset) and was later narrowed to 3 startup-tuned ones:
 *
 *   autonomy        weight 0.35
 *   productMindset  weight 0.30
 *   impact          weight 0.35
 *
 * Old evaluation rows still carry the legacy dimension shape, so historical
 * reports render stale bars. This one-shot script re-runs candidate matching
 * for past completed jobs against the new 3-D rubric and updates the existing
 * `ai_evaluations` rows in place — preserving runId/jobId/candidateId so the
 * historical report stays linked to the same agent run.
 *
 * Run with (one scope flag is REQUIRED — the script refuses to run globally
 * without it to avoid overwriting evaluations from a different rubric variant):
 *   pnpm --filter @workspace/scripts run rescore-3d -- --job 12          # one job
 *   pnpm --filter @workspace/scripts run rescore-3d -- --run 47          # one agent run
 *   pnpm --filter @workspace/scripts run rescore-3d -- --all-hiringai    # every row
 *   pnpm --filter @workspace/scripts run rescore-3d -- --job 12 --dry    # preview, no writes
 *
 * Re-trigger this any time the rubric changes again — see replit.md.
 */

import {
  db,
  pool,
  aiEvaluationsTable,
  jobInsightsTable,
  jobsTable,
  candidatesTable,
  agentRunsTable,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { eq, and, desc, inArray } from "drizzle-orm";

// ── HiringAI 3-dimension rubric ──────────────────────────────────────────────
const RUBRIC = {
  autonomy: 0.35,
  productMindset: 0.3,
  impact: 0.35,
} as const;

type Dim = keyof typeof RUBRIC;

type ScoreDimension = { score: number; weight: number; reasoning: string };
type ThreeDBreakdown = Record<Dim, ScoreDimension>;

type AiResponse = {
  scoreBreakdown: ThreeDBreakdown;
  fitScore?: number;
  strengths: string[];
  gaps: string[];
  risks: string[];
  recommendation: "Strong Yes" | "Yes" | "Maybe" | "No";
  confidenceReason?: string;
  missingDataWarnings?: string[];
};

/**
 * Mirror of `computeDataConfidenceScore` in artifacts/api-server/src/routes/
 * workflows/engine.ts. Kept in sync intentionally — see that file for the
 * authoritative weights. Used only as a fallback when an old evaluation row
 * has a null dataConfidenceScore.
 */
function recomputeDataConfidence(c: {
  enrichmentStatus: string | null;
  enrichmentConfidence: number | null;
  linkedIn: string | null;
  skills: string[];
  summary: string | null;
  headline: string | null;
}): number {
  let points = 0;
  if (c.enrichmentStatus === "enriched") {
    points += 30 + Math.round((c.enrichmentConfidence ?? 0.8) * 10);
  } else if (c.enrichmentStatus === "partial") {
    points += 20;
  }
  if (c.linkedIn && !c.linkedIn.includes("placeholder")) points += 15;
  if (c.skills.length >= 5) points += 20;
  else if (c.skills.length >= 2) points += 10;
  else if (c.skills.length === 1) points += 5;
  if (c.summary && c.summary.length > 100) points += 20;
  else if (c.summary && c.summary.length > 20) points += 8;
  if (c.headline) points += 5;
  return Math.min(100, points);
}

function parseJson<T>(content: string): T {
  const fenced = content.match(/```json\s*([\s\S]*?)\s*```/);
  return JSON.parse(fenced ? fenced[1] : content);
}

function buildPrompt(
  job: { title: string; seniority: string; description: string; mustHaveSkills: string[] },
  insight: { evaluationCriteria: string[]; idealCandidateProfile: string } | null,
  candidate: { name: string; skills: string[]; summary: string | null },
): string {
  const fmt = (v: number) => v.toFixed(2);
  return `You are an experienced HR partner evaluating a candidate for a startup role. Be concrete and specific — reference actual details from the candidate's profile or job requirements.

JOB: ${job.title} (${job.seniority})
Must-Have Skills: ${job.mustHaveSkills.join(", ")}
${insight ? `Evaluation Criteria: ${insight.evaluationCriteria.join("; ")}\nIdeal Profile: ${insight.idealCandidateProfile}` : ""}
Job Description: ${job.description}

CANDIDATE: ${candidate.name}
Skills: ${candidate.skills.length > 0 ? candidate.skills.join(", ") : "none listed"}
Summary: ${candidate.summary ?? "No summary provided"}

Score this candidate's FIT across exactly 3 startup-tuned dimensions (each 0-100):

- autonomy (${fmt(RUBRIC.autonomy)}): End-to-end ownership, self-direction, ran initiatives without heavy guidance.
- productMindset (${fmt(RUBRIC.productMindset)}): Thinks about users, business impact, tradeoffs — not just execution.
- impact (${fmt(RUBRIC.impact)}): Evidence of measurable outcomes shipped (metrics, scale, customer wins). Skill coverage from must-haves should be woven into impact reasoning rather than scored separately.

Scoring rules:
- Score ONLY based on evidence present in the profile. Do NOT invent qualifications.
- Do NOT penalize for missing data. Score conservatively (20-30) and flag the gap in missingDataWarnings.
- Never fabricate experience or skills not explicitly listed.

fitScore = round(autonomy*${fmt(RUBRIC.autonomy)} + productMindset*${fmt(RUBRIC.productMindset)} + impact*${fmt(RUBRIC.impact)}).
Recommendation thresholds: 80-100=Strong Yes, 60-79=Yes, 40-59=Maybe, 0-39=No.

Return ONLY valid JSON:
{
  "scoreBreakdown": {
    "autonomy":       { "score": <0-100>, "weight": ${fmt(RUBRIC.autonomy)}, "reasoning": "<specific 1-2 sentences>" },
    "productMindset": { "score": <0-100>, "weight": ${fmt(RUBRIC.productMindset)}, "reasoning": "<specific 1-2 sentences>" },
    "impact":         { "score": <0-100>, "weight": ${fmt(RUBRIC.impact)}, "reasoning": "<specific 1-2 sentences>" }
  },
  "fitScore": <integer 0-100>,
  "strengths": ["<specific>", "<specific>"],
  "gaps": ["<specific gap>"],
  "risks": ["<concrete risk>"],
  "recommendation": "<Strong Yes|Yes|Maybe|No>",
  "confidenceReason": "<1 sentence on data limitations or 'Profile provides sufficient data for reliable scoring'>",
  "missingDataWarnings": ["<specific data gap>"]
}`;
}

// ── Args ─────────────────────────────────────────────────────────────────────
// To prevent overwriting evaluations produced under a different rubric variant,
// we REFUSE to run globally unless the caller passes one of:
//   --job <id>        rescope to a single job
//   --run <id>        rescope to a single agent run
//   --all-hiringai    explicit acknowledgement that every row in this DB is a
//                     HiringAI evaluation and is safe to overwrite
const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const allowAll = args.includes("--all-hiringai");
const jobArgIdx = args.indexOf("--job");
const onlyJobId = jobArgIdx >= 0 ? Number(args[jobArgIdx + 1]) : null;
const runArgIdx = args.indexOf("--run");
const onlyRunId = runArgIdx >= 0 ? Number(args[runArgIdx + 1]) : null;

async function main() {
  if (!onlyJobId && !onlyRunId && !allowAll) {
    console.error(
      "[rescore-3d] refusing to rescore every evaluation in the DB without a scope filter.\n" +
        "  Pass one of:\n" +
        "    --job <id>        rescope to a single job\n" +
        "    --run <id>        rescope to a single agent run\n" +
        "    --all-hiringai    explicit ack that every ai_evaluations row is HiringAI and safe to overwrite\n" +
        "  Add --dry to preview without writing.",
    );
    await pool.end();
    process.exit(2);
  }

  const scope = onlyRunId
    ? `run ${onlyRunId}`
    : onlyJobId
    ? `job ${onlyJobId}`
    : "ALL evaluations (--all-hiringai)";

  console.log(
    `[rescore-3d] starting — rubric: autonomy=${RUBRIC.autonomy} productMindset=${RUBRIC.productMindset} impact=${RUBRIC.impact}` +
      (dryRun ? " (DRY RUN)" : "") +
      ` — scope: ${scope}`,
  );

  // Fetch evaluations narrowed by run, then job, otherwise all.
  const evals = onlyRunId
    ? await db.select().from(aiEvaluationsTable).where(eq(aiEvaluationsTable.runId, onlyRunId))
    : onlyJobId
    ? await db.select().from(aiEvaluationsTable).where(eq(aiEvaluationsTable.jobId, onlyJobId))
    : await db.select().from(aiEvaluationsTable);

  if (evals.length === 0) {
    console.log("[rescore-3d] no evaluations to rescore");
    await pool.end();
    return;
  }

  // Pre-load jobs, candidates, insights for the involved rows
  const jobIds = Array.from(new Set(evals.map((e) => e.jobId)));
  const candIds = Array.from(new Set(evals.map((e) => e.candidateId)));
  const runIds = Array.from(new Set(evals.map((e) => e.runId)));

  const [jobs, candidates, insights] = await Promise.all([
    db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds)),
    db.select().from(candidatesTable).where(inArray(candidatesTable.id, candIds)),
    db.select().from(jobInsightsTable).where(inArray(jobInsightsTable.runId, runIds)),
  ]);

  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const candMap = new Map(candidates.map((c) => [c.id, c]));
  // Newest insight per (runId) wins; fall back to any insight for the same job.
  const insightByRun = new Map(insights.map((i) => [i.runId, i]));
  const insightByJob = new Map<number, (typeof insights)[number]>();
  for (const i of insights) {
    const existing = insightByJob.get(i.jobId);
    if (!existing || existing.id < i.id) insightByJob.set(i.jobId, i);
  }

  console.log(`[rescore-3d] rescoring ${evals.length} evaluations across ${jobIds.length} jobs`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  await batchProcess(
    evals,
    async (ev) => {
      const job = jobMap.get(ev.jobId);
      const cand = candMap.get(ev.candidateId);
      if (!job || !cand) {
        skipped++;
        console.warn(`[rescore-3d] eval ${ev.id}: missing job or candidate, skipping`);
        return;
      }
      const insight = insightByRun.get(ev.runId) ?? insightByJob.get(ev.jobId) ?? null;

      const prompt = buildPrompt(
        {
          title: job.title,
          seniority: job.seniority,
          description: job.description,
          mustHaveSkills: job.mustHaveSkills,
        },
        insight
          ? {
              evaluationCriteria: insight.evaluationCriteria,
              idealCandidateProfile: insight.idealCandidateProfile,
            }
          : null,
        { name: cand.name, skills: cand.skills, summary: cand.summary },
      );

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-5.1",
          max_completion_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        });
        const raw = parseJson<AiResponse>(response.choices[0]?.message?.content ?? "{}");
        const bd = raw.scoreBreakdown;
        if (!bd?.autonomy || !bd?.productMindset || !bd?.impact) {
          throw new Error("model returned incomplete 3-D breakdown");
        }

        // Recompute fit server-side for arithmetic consistency.
        const fitScore = Math.round(
          bd.autonomy.score * RUBRIC.autonomy +
            bd.productMindset.score * RUBRIC.productMindset +
            bd.impact.score * RUBRIC.impact,
        );

        // Preserve existing dataConfidenceScore — it is independent of the
        // rubric. If the row was created before dataConfidenceScore existed
        // (legacy null), recompute it from the candidate profile using the
        // same logic as engine.ts so we don't fall back to an arbitrary
        // default.
        const dataConf = ev.dataConfidenceScore ?? recomputeDataConfidence(cand);
        const decisionScore = Math.round(fitScore * (0.6 + (0.4 * dataConf) / 100));

        if (dryRun) {
          console.log(
            `[rescore-3d] DRY eval ${ev.id} (${cand.name}): fit ${ev.fitScore ?? ev.score} → ${fitScore}, decision ${ev.decisionScore ?? ev.score} → ${decisionScore} (dataConf=${dataConf}${ev.dataConfidenceScore == null ? " recomputed" : ""})`,
          );
        } else {
          await db
            .update(aiEvaluationsTable)
            .set({
              // Cast: the schema's ScoreBreakdown type still has the legacy
              // 7-D shape, but the column is jsonb and the UI tolerates
              // missing dimensions (it skips them). The 3-D rubric is the
              // intended new shape stored here.
              scoreBreakdown: bd as unknown as NonNullable<typeof ev.scoreBreakdown>,
              fitScore,
              decisionScore,
              score: decisionScore,
              // Backfill dataConfidenceScore if it was null so the stored
              // confidence matches the math we used for decisionScore.
              ...(ev.dataConfidenceScore == null ? { dataConfidenceScore: dataConf } : {}),
              strengths: raw.strengths ?? ev.strengths,
              gaps: raw.gaps ?? ev.gaps,
              risks: raw.risks ?? ev.risks,
              recommendation: raw.recommendation ?? ev.recommendation,
              confidenceReason: raw.confidenceReason ?? ev.confidenceReason,
              missingDataWarnings: raw.missingDataWarnings ?? ev.missingDataWarnings ?? [],
            })
            .where(eq(aiEvaluationsTable.id, ev.id));
        }
        updated++;
      } catch (err) {
        failed++;
        console.error(
          `[rescore-3d] eval ${ev.id} (${cand.name}) failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    },
    { concurrency: 3, retries: 2 },
  );

  console.log(
    `[rescore-3d] done — updated=${updated} skipped=${skipped} failed=${failed}` +
      (dryRun ? " (DRY RUN — no writes performed)" : ""),
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("[rescore-3d] fatal:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
