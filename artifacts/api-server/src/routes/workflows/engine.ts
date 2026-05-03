import {
  db,
  agentRunsTable,
  agentLogsTable,
  aiEvaluationsTable,
  jobInsightsTable,
  shortlistsTable,
  jobsTable,
  candidatesTable,
  applicationsTable,
} from "@workspace/db";
import type { VariantCriteria } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { resolveProvider, resolveSourcingProvider, resolveEnrichmentProvider } from "./providers";
import type { JobInsightResult, CandidateMatchResult, ShortlistResult } from "./engine-types";
import type { SourcingCandidate, EnrichmentResult } from "./providers";

export type { JobInsightResult, CandidateMatchResult, ShortlistResult };

// ── helpers ──────────────────────────────────────────────────────────────────

async function logStep(
  runId: number,
  step: string,
  status: "pending" | "running" | "completed" | "failed",
  input?: unknown,
  output?: unknown,
) {
  await db
    .insert(agentLogsTable)
    .values({ runId, step, status, input: input ?? null, output: output ?? null });
}

async function setRunStatus(runId: number, status: "running" | "completed" | "failed") {
  await db
    .update(agentRunsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(agentRunsTable.id, runId));
}

// ── STEP 0: Sourcing (optional) ───────────────────────────────────────────────

async function runSourcing(
  runId: number,
  jobId: number,
  job: { title: string; description: string; location: string; seniority: string; mustHaveSkills: string[] },
  insight: JobInsightResult,
): Promise<number[]> {
  await logStep(runId, "sourcing", "running", { jobTitle: job.title });

  const provider = await resolveSourcingProvider();
  logger.info({ runId, step: "sourcing", provider: provider.name }, "Sourcing step dispatched");

  try {
    const candidates = (await provider.run({
      step: "sourcing",
      runId,
      jobId,
      payload: { job, insight },
    })) as SourcingCandidate[];

    // Deduplicate by email against existing candidates
    const existing = await db.select({ email: candidatesTable.email }).from(candidatesTable);
    const existingEmails = new Set(existing.map((c) => c.email.toLowerCase()));

    const newCandidateIds: number[] = [];
    for (const c of candidates) {
      const emailKey = c.email.toLowerCase();
      if (existingEmails.has(emailKey)) {
        logger.warn({ email: c.email }, "Sourcing skipped duplicate email");
        continue;
      }
      existingEmails.add(emailKey);

      const [inserted] = await db
        .insert(candidatesTable)
        .values({
          name: c.name,
          email: c.email,
          linkedIn: c.linkedinUrl || null,
          summary: c.summary || null,
          skills: c.skills,
          headline: c.headline || null,
          location: c.location || null,
          currentCompany: c.currentCompany || null,
          githubUrl: c.githubUrl || null,
          source: c.source,
        })
        .returning({ id: candidatesTable.id });

      newCandidateIds.push(inserted.id);

      // Create application at "Sourced" stage
      await db.insert(applicationsTable).values({
        jobId,
        candidateId: inserted.id,
        stage: "Sourced",
        notes: `AI Generated — ${c.evidence}\nPotential risks: ${c.potentialRisks}`,
      });
    }

    await logStep(runId, "sourcing", "completed", { jobTitle: job.title, provider: provider.name }, {
      generated: candidates.length,
      saved: newCandidateIds.length,
    });
    return newCandidateIds;
  } catch (err) {
    await logStep(runId, "sourcing", "failed", { jobTitle: job.title, provider: provider.name }, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── STEP 0b: Enrichment (optional) ───────────────────────────────────────────

async function runEnrichment(
  runId: number,
  jobId: number,
  job: { title: string; seniority: string; mustHaveSkills: string[] },
  candidates: Array<{ id: number; name: string; email: string; skills: string[]; summary: string | null; headline: string | null; location: string | null; currentCompany: string | null; githubUrl: string | null; linkedIn: string | null }>,
): Promise<void> {
  await logStep(runId, "enrichment", "running", { candidateCount: candidates.length });

  const provider = await resolveEnrichmentProvider();
  logger.info({ runId, step: "enrichment", provider: provider.name }, "Enrichment step dispatched");

  const rawResponse = await provider.run({
    step: "enrichment",
    runId,
    jobId,
    payload: {
      candidates,
      jobContext: { title: job.title, seniority: job.seniority, mustHaveSkills: job.mustHaveSkills },
    },
  });

  logger.info(
    { runId, step: "enrichment", provider: provider.name, raw: JSON.stringify(rawResponse).slice(0, 500) },
    "Enrichment raw response",
  );

  const results = rawResponse as EnrichmentResult[];

  const normalized = results.map((r) => ({
    candidateId: r.candidateId,
    enrichedSummary: r.enrichedSummary,
    enrichedSkills: Array.isArray(r.enrichedSkills) ? r.enrichedSkills : [],
    enrichedHeadline: r.enrichedHeadline ?? null,
    additionalSignals: Array.isArray(r.additionalSignals) ? r.additionalSignals : [],
    confidence: typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.5,
  }));

  logger.info(
    { runId, step: "enrichment", normalized: normalized.map((n) => ({ id: n.candidateId, confidence: n.confidence })) },
    "Enrichment normalized output",
  );

  const now = new Date();
  for (const n of normalized) {
    await db
      .update(candidatesTable)
      .set({
        summary: n.enrichedSummary,
        skills: n.enrichedSkills.length > 0 ? n.enrichedSkills : undefined,
        headline: n.enrichedHeadline ?? undefined,
        enrichedAt: now,
        enrichmentSource: provider.name,
        enrichmentConfidence: n.confidence,
        updatedAt: now,
      })
      .where(eq(candidatesTable.id, n.candidateId));
  }

  await logStep(runId, "enrichment", "completed", { candidateCount: candidates.length, provider: provider.name }, {
    enriched: normalized.length,
    avgConfidence: normalized.length > 0
      ? (normalized.reduce((s, n) => s + n.confidence, 0) / normalized.length).toFixed(2)
      : null,
  });
}

// ── STEP 1: Job Understanding ─────────────────────────────────────────────────

async function runJobUnderstanding(
  runId: number,
  jobId: number,
  job: { title: string; description: string; location: string; seniority: string; mustHaveSkills: string[] },
): Promise<JobInsightResult> {
  await logStep(runId, "job_understanding", "running", { jobTitle: job.title });

  const provider = await resolveProvider("job_understanding");
  logger.info({ runId, step: "job_understanding", provider: provider.name }, "Step dispatched");

  try {
    const result = (await provider.run({
      step: "job_understanding",
      runId,
      jobId,
      payload: { job },
    })) as JobInsightResult;

    await logStep(runId, "job_understanding", "completed", { jobTitle: job.title, provider: provider.name }, result);
    return result;
  } catch (err) {
    await logStep(runId, "job_understanding", "failed", { jobTitle: job.title, provider: provider.name }, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── STEP 2: Candidate Matching ────────────────────────────────────────────────

async function runCandidateMatching(
  runId: number,
  jobId: number,
  job: { title: string; description: string; mustHaveSkills: string[]; seniority: string },
  insight: JobInsightResult,
  candidates: Array<{ id: number; name: string; email: string; skills: string[]; summary: string | null }>,
): Promise<void> {
  await logStep(runId, "candidate_matching", "running", { candidateCount: candidates.length });

  const provider = await resolveProvider("candidate_matching");
  logger.info({ runId, step: "candidate_matching", provider: provider.name }, "Step dispatched");

  try {
    const results = (await provider.run({
      step: "candidate_matching",
      runId,
      jobId,
      payload: { job, insight, candidates },
    })) as CandidateMatchResult[];

    await Promise.all(
      results.map((r) =>
        db.insert(aiEvaluationsTable).values({
          runId,
          jobId,
          candidateId: r.candidateId,
          score: r.score,
          strengths: r.strengths,
          gaps: r.gaps,
          risks: r.risks,
          recommendation: r.recommendation,
          scoreBreakdown: r.scoreBreakdown ?? null,
        }),
      ),
    );

    await logStep(runId, "candidate_matching", "completed", { candidateCount: candidates.length, provider: provider.name }, {
      scores: results.map((r) => ({ name: r.candidateName, score: r.score, rec: r.recommendation })),
    });
  } catch (err) {
    await logStep(runId, "candidate_matching", "failed", { candidateCount: candidates.length, provider: provider.name }, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── STEP 3: Shortlist ─────────────────────────────────────────────────────────

async function runShortlist(
  runId: number,
  jobId: number,
  job: { title: string; description: string },
  insight: JobInsightResult,
  evaluations: Array<{
    candidateId: number;
    candidateName: string;
    score: number;
    recommendation: string;
    strengths: string[];
    gaps: string[];
  }>,
): Promise<void> {
  await logStep(runId, "shortlist", "running", { totalEvaluated: evaluations.length });

  const provider = await resolveProvider("shortlist_generation");
  logger.info({ runId, step: "shortlist_generation", provider: provider.name }, "Step dispatched");

  try {
    const top5 = [...evaluations].sort((a, b) => b.score - a.score).slice(0, 5);
    const summaries = (await provider.run({
      step: "shortlist_generation",
      runId,
      jobId,
      payload: { job, insight, evaluations: top5 },
    })) as ShortlistResult[];

    await db.insert(shortlistsTable).values({
      runId,
      jobId,
      rankedCandidateIds: top5.map((c) => c.candidateId),
      summaries,
    });

    await logStep(runId, "shortlist", "completed", { top5Count: top5.length, provider: provider.name }, { summaries });
  } catch (err) {
    await logStep(runId, "shortlist", "failed", {}, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── MAIN RUNNER ───────────────────────────────────────────────────────────────

export async function runWorkflowEngine(
  runId: number,
  jobId: number,
  options: { runSourcing?: boolean; runEnrichment?: boolean; variantCriteria?: VariantCriteria } = {},
) {
  try {
    await setRunStatus(runId, "running");
    logger.info({ runId, jobId, runSourcing: options.runSourcing, runEnrichment: options.runEnrichment, isVariant: !!options.variantCriteria }, "Workflow started");

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) throw new Error(`Job ${jobId} not found`);

    // Apply variant criteria overrides if this is a variant run
    const vc = options.variantCriteria;
    const effectiveJob = vc
      ? {
          ...job,
          seniority: vc.seniority ?? job.seniority,
          mustHaveSkills: vc.mustHaveSkills ?? job.mustHaveSkills,
          description: vc.focusNote
            ? `${job.description}\n\n[Variant focus]: ${vc.focusNote}`
            : job.description,
        }
      : job;

    // Step 1: Job Understanding (always runs first)
    const insight = await runJobUnderstanding(runId, jobId, effectiveJob);
    await db.insert(jobInsightsTable).values({
      runId,
      jobId,
      mustHaveSkills: insight.mustHaveSkills,
      seniority: insight.seniority,
      evaluationCriteria: insight.evaluationCriteria,
      idealCandidateProfile: insight.idealCandidateProfile,
    });

    // Step 0: Sourcing (optional, runs after job understanding, before matching)
    if (options.runSourcing) {
      try {
        await runSourcing(runId, jobId, effectiveJob, insight);
      } catch (err) {
        logger.error({ runId, jobId, err }, "Sourcing step failed — continuing with existing candidates");
        await logStep(runId, "sourcing", "failed", null, {
          error: err instanceof Error ? err.message : String(err),
          note: "Continuing workflow with existing candidates",
        });
      }
    }

    // Step 0b: Enrichment (optional, runs after sourcing, before matching)
    if (options.runEnrichment) {
      const candidatesForEnrichment = await db.select().from(candidatesTable);
      if (candidatesForEnrichment.length > 0) {
        try {
          await runEnrichment(runId, jobId, effectiveJob, candidatesForEnrichment);
        } catch (err) {
          logger.error({ runId, jobId, err }, "Enrichment step failed — falling back to native and retrying");
          // Fallback: retry with native provider by temporarily disabling the custom setting
          try {
            const { NativeOpenAIEnrichmentProvider } = await import("./providers/native-openai-enrichment");
            const nativeProvider = new NativeOpenAIEnrichmentProvider(-1, "Native OpenAI (fallback)");
            const fallbackResult = await nativeProvider.run({
              step: "enrichment",
              runId,
              jobId,
              payload: {
                candidates: candidatesForEnrichment,
                jobContext: { title: effectiveJob.title, seniority: effectiveJob.seniority, mustHaveSkills: effectiveJob.mustHaveSkills },
              },
            }) as import("./providers/native-openai-enrichment").EnrichmentResult[];

            const now = new Date();
            for (const n of fallbackResult) {
              await db
                .update(candidatesTable)
                .set({
                  summary: n.enrichedSummary,
                  skills: n.enrichedSkills.length > 0 ? n.enrichedSkills : undefined,
                  headline: n.enrichedHeadline ?? undefined,
                  enrichedAt: now,
                  enrichmentSource: "Native OpenAI (fallback)",
                  enrichmentConfidence: n.confidence,
                  updatedAt: now,
                })
                .where(eq(candidatesTable.id, n.candidateId));
            }
            await logStep(runId, "enrichment", "completed", null, {
              note: "Fallback to native enrichment succeeded",
              enriched: fallbackResult.length,
            });
          } catch (fallbackErr) {
            logger.error({ runId, jobId, fallbackErr }, "Enrichment fallback also failed — continuing without enrichment");
            await logStep(runId, "enrichment", "failed", null, {
              error: err instanceof Error ? err.message : String(err),
              note: "Continuing workflow without enrichment",
            });
          }
        }
      } else {
        logger.info({ runId }, "No candidates to enrich — skipping enrichment step");
      }
    }

    // Step 2: Candidate Matching (all candidates including newly sourced/enriched)
    const candidates = await db.select().from(candidatesTable);
    if (candidates.length === 0) {
      logger.warn({ runId }, "No candidates found — skipping matching and shortlist");
    } else {
      await runCandidateMatching(runId, jobId, effectiveJob, insight, candidates);

      // Step 3: Shortlist (fetch fresh evaluations)
      const evaluations = await db
        .select()
        .from(aiEvaluationsTable)
        .where(eq(aiEvaluationsTable.runId, runId));

      const candidateMap = new Map(candidates.map((c) => [c.id, c]));
      const evalWithNames = evaluations.map((e) => ({
        candidateId: e.candidateId,
        candidateName: candidateMap.get(e.candidateId)?.name ?? "Unknown",
        score: e.score,
        recommendation: e.recommendation,
        strengths: (e.strengths ?? []) as string[],
        gaps: (e.gaps ?? []) as string[],
      }));

      if (evalWithNames.length > 0) {
        await runShortlist(runId, jobId, effectiveJob, insight, evalWithNames);
      }
    }

    await setRunStatus(runId, "completed");
    logger.info({ runId, jobId }, "Workflow completed");
  } catch (err) {
    logger.error({ runId, jobId, err }, "Workflow failed");
    await setRunStatus(runId, "failed");
    await logStep(runId, "error", "failed", null, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
