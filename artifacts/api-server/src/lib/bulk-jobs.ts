import { and, eq, inArray, desc, or, lt, sql } from "drizzle-orm";
import {
  db,
  bulkJobsTable,
  bulkJobsRunsTable,
  candidatesTable,
  applicationsTable,
  type BulkJob,
  type BulkJobsRun,
} from "@workspace/db";
import { revalidateCandidateEmail } from "./email-revalidation";
import { getBulkJobsSettings } from "./bulk-jobs-settings";
import { logger } from "./logger";

/**
 * Number of ids the worker pulls off `bulkJobsTable.ids` per database tick.
 * Sized to match the existing synchronous bulk endpoint's per-request budget
 * so the per-chunk SQL/concurrency profile is identical to what we already
 * exercise in production — only now it runs out-of-band.
 */
const CHUNK_SIZE = 500;

/** Bounded fan-out for the per-id `recheck-email` action. */
const RECHECK_CONCURRENCY = 5;

/** How often the in-process worker wakes up to look for new pending jobs. */
const POLL_INTERVAL_MS = 2_000;

/**
 * Hard floor used when the persisted setting is missing/invalid. The live
 * value comes from `bulk_jobs_settings` (singleton row), seeded from
 * `BULK_JOBS_RETENTION_DAYS` on first boot. Each row carries the full id list
 * and, for `export-csv`, the assembled CSV blob in `result`, so without
 * retention the table would grow unbounded.
 */
const DEFAULT_RETENTION_DAYS = 7;
async function retentionDays(): Promise<number> {
  try {
    const settings = await getBulkJobsSettings();
    return Number.isFinite(settings.retentionDays) && settings.retentionDays > 0
      ? settings.retentionDays
      : DEFAULT_RETENTION_DAYS;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Bulk-job retention: failed to load settings, falling back to default",
    );
    return DEFAULT_RETENTION_DAYS;
  }
}

/** How often the worker runs the retention sweep. */
const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastRetentionSweepAt = 0;

/**
 * Delete completed/failed/canceled bulk-job rows older than the retention
 * window. Uses `finishedAt` (falling back to `updatedAt` for safety) so we
 * never trim a row that is still in flight.
 *
 * Records a row in `bulk_jobs_runs` so admins can see the sweep is firing
 * and how many rows each pass removed. The `trigger` column distinguishes
 * background sweeps from admin-requested ones.
 */
export async function sweepBulkJobRetention(
  options: { trigger?: "scheduled" | "manual"; now?: Date } = {},
): Promise<BulkJobsRun> {
  const trigger = options.trigger ?? "scheduled";
  const now = options.now ?? new Date();
  const days = await retentionDays();

  const [runRow] = await db
    .insert(bulkJobsRunsTable)
    .values({ trigger, retentionDays: days })
    .returning();

  let deletedCount = 0;
  let errorMessage: string | null = null;

  try {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(bulkJobsTable)
      .where(
        and(
          inArray(bulkJobsTable.status, ["completed", "failed", "canceled"]),
          lt(sql`coalesce(${bulkJobsTable.finishedAt}, ${bulkJobsTable.updatedAt})`, cutoff),
        ),
      )
      .returning({ id: bulkJobsTable.id });
    deletedCount = deleted.length;
    if (deletedCount > 0) {
      logger.info(
        { count: deletedCount, cutoff: cutoff.toISOString(), trigger },
        "Bulk-job retention sweep deleted old rows",
      );
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err: errorMessage, trigger }, "Bulk-job retention sweep crashed");
  }

  const [finished] = await db
    .update(bulkJobsRunsTable)
    .set({
      finishedAt: new Date(),
      deleted: deletedCount,
      errorMessage,
    })
    .where(eq(bulkJobsRunsTable.id, runRow.id))
    .returning();

  return finished ?? runRow;
}

/**
 * Return the most recent retention sweeps, newest first. Used by the settings
 * UI to render a "Recent activity" panel.
 */
export async function listRecentBulkJobsRuns(
  limit = 10,
): Promise<BulkJobsRun[]> {
  return db
    .select()
    .from(bulkJobsRunsTable)
    .orderBy(desc(bulkJobsRunsTable.startedAt))
    .limit(limit);
}

async function maybeRunRetentionSweep(): Promise<void> {
  const now = Date.now();
  if (now - lastRetentionSweepAt < RETENTION_SWEEP_INTERVAL_MS) return;
  lastRetentionSweepAt = now;
  try {
    await sweepBulkJobRetention({ now: new Date(now), trigger: "scheduled" });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Bulk-job retention sweep failed",
    );
  }
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADER = [
  "name",
  "email",
  "headline",
  "location",
  "currentCompany",
  "source",
  "emailValidationStatus",
  "emailSource",
  "profileUrl",
];

export type BulkJobAction =
  | "delete"
  | "recheck-email"
  | "move-stage"
  | "export-csv";

export type BulkRecheckResult = {
  id: number;
  status: "valid" | "invalid" | "risky" | "unchecked" | "skipped" | "error";
  reason: string | null;
};

export async function enqueueBulkJob(input: {
  action: BulkJobAction;
  ids: number[];
  payload?: Record<string, unknown> | null;
}): Promise<BulkJob> {
  const ids = Array.from(new Set(input.ids));
  const [row] = await db
    .insert(bulkJobsTable)
    .values({
      action: input.action,
      ids,
      payload: input.payload ?? null,
      total: ids.length,
      status: "pending",
    })
    .returning();
  // Wake the worker promptly so small jobs don't sit a full poll interval.
  scheduleImmediateTick();
  return row;
}

export async function getBulkJob(id: number): Promise<BulkJob | null> {
  const [row] = await db
    .select()
    .from(bulkJobsTable)
    .where(eq(bulkJobsTable.id, id));
  return row ?? null;
}

/**
 * Active jobs surface a "you have unfinished work" indicator after a browser
 * refresh — the frontend hits this on mount to resume any progress toasts the
 * user previously had open.
 */
export async function listActiveBulkJobs(): Promise<BulkJob[]> {
  return db
    .select()
    .from(bulkJobsTable)
    .where(
      or(eq(bulkJobsTable.status, "pending"), eq(bulkJobsTable.status, "running")),
    )
    .orderBy(desc(bulkJobsTable.createdAt));
}

async function processChunk(job: BulkJob, chunk: number[]): Promise<{
  processedDelta: number;
  skippedDelta: number;
  recheckResults?: BulkRecheckResult[];
  csvLines?: string[];
}> {
  if (job.action === "delete") {
    const deleted = await db
      .delete(candidatesTable)
      .where(inArray(candidatesTable.id, chunk))
      .returning({ id: candidatesTable.id });
    return {
      processedDelta: deleted.length,
      skippedDelta: chunk.length - deleted.length,
    };
  }

  if (job.action === "move-stage") {
    const payload = (job.payload ?? {}) as { jobId?: number; stage?: string };
    if (!payload.jobId || !payload.stage) {
      throw new Error("move-stage requires payload.jobId and payload.stage");
    }
    const updated = await db
      .update(applicationsTable)
      .set({ stage: payload.stage as never, updatedAt: new Date() })
      .where(
        and(
          eq(applicationsTable.jobId, payload.jobId),
          inArray(applicationsTable.candidateId, chunk),
        ),
      )
      .returning({ id: applicationsTable.id });
    return {
      processedDelta: updated.length,
      skippedDelta: chunk.length - updated.length,
    };
  }

  if (job.action === "export-csv") {
    const rows = await db
      .select()
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, chunk));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = chunk
      .map((id) => byId.get(id))
      .filter((r): r is (typeof rows)[number] => !!r);
    const lines = ordered.map((r) =>
      [
        r.name,
        r.email ?? "",
        r.headline ?? "",
        r.location ?? "",
        r.currentCompany ?? "",
        r.source ?? "",
        r.emailValidationStatus ?? "",
        r.emailSource ?? "",
        r.linkedIn ?? r.githubUrl ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
    return {
      processedDelta: ordered.length,
      skippedDelta: chunk.length - ordered.length,
      csvLines: lines,
    };
  }

  // recheck-email: bounded concurrency mirrors the sync endpoint so we don't
  // fan a giant job out into thousands of concurrent DNS lookups.
  const results: BulkRecheckResult[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < chunk.length) {
      const idx = cursor++;
      const id = chunk[idx];
      try {
        const updated = await revalidateCandidateEmail(id);
        if (!updated) {
          results.push({ id, status: "skipped", reason: "candidate not found" });
        } else if (!updated.email) {
          results.push({ id, status: "skipped", reason: "no email on file" });
        } else {
          results.push({
            id,
            status: (updated.emailValidationStatus ?? "unchecked") as
              | "valid" | "invalid" | "risky" | "unchecked",
            reason: updated.emailValidationReason ?? null,
          });
        }
      } catch (err) {
        results.push({
          id,
          status: "error",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(RECHECK_CONCURRENCY, chunk.length) }, worker),
  );
  results.sort((a, b) => chunk.indexOf(a.id) - chunk.indexOf(b.id));
  const processed = results.filter(
    (r) => r.status !== "skipped" && r.status !== "error",
  ).length;
  return {
    processedDelta: processed,
    skippedDelta: results.length - processed,
    recheckResults: results,
  };
}

/**
 * Mark a still-running (or pending) job as canceled. The worker checks the
 * row's status between chunks, so any chunks that have not yet started will
 * not be processed. Whatever the worker had already done up to this point
 * (`processed` / `skipped` counts and any partial CSV / per-id results
 * persisted on the row) is preserved.
 *
 * Already-terminal jobs are returned unchanged — the recruiter cancelling a
 * run that just completed shouldn't get a confusing error.
 */
export async function cancelBulkJob(id: number): Promise<BulkJob | null> {
  // Atomic guarded transition: only flip non-terminal rows to `canceled`.
  // Doing this as a single UPDATE prevents a race where the worker finishes
  // (and writes `completed`/`failed`) between us reading the row and writing
  // it back — the contract is that a job already in a terminal state is
  // returned unchanged.
  const [updated] = await db
    .update(bulkJobsTable)
    .set({
      status: "canceled",
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(bulkJobsTable.id, id),
        inArray(bulkJobsTable.status, ["pending", "running"]),
      ),
    )
    .returning();
  if (updated) return updated;
  // Either the row doesn't exist, or it is already terminal — re-read and
  // return whatever's there (null = 404).
  return getBulkJob(id);
}

async function isJobCanceled(id: number): Promise<boolean> {
  const [row] = await db
    .select({ status: bulkJobsTable.status })
    .from(bulkJobsTable)
    .where(eq(bulkJobsTable.id, id));
  return row?.status === "canceled";
}

async function runJob(job: BulkJob): Promise<void> {
  // Atomic pending → running transition. If the recruiter cancelled the job
  // in the window between us picking it off the queue and writing `running`
  // here, the guarded UPDATE will affect zero rows and we bail out without
  // overwriting `canceled`. This is critical for destructive actions (bulk
  // delete) where silently continuing after a cancel would be a data-loss
  // event.
  const claimed = await db
    .update(bulkJobsTable)
    .set({
      status: "running",
      startedAt: job.startedAt ?? new Date(),
      updatedAt: new Date(),
      errorMessage: null,
    })
    .where(
      and(
        eq(bulkJobsTable.id, job.id),
        inArray(bulkJobsTable.status, ["pending", "running"]),
      ),
    )
    .returning({ id: bulkJobsTable.id });
  if (claimed.length === 0) {
    logger.info(
      { jobId: job.id },
      "Bulk job no longer claimable (canceled before start); skipping",
    );
    return;
  }

  let processed = job.processed;
  let skipped = job.skipped;
  // Resume CSV / per-id results from prior progress so a server restart
  // doesn't drop work the worker already did.
  const prior = (job.result ?? {}) as {
    csv?: string;
    results?: BulkRecheckResult[];
  };
  const csvParts: string[] = prior.csv
    ? [prior.csv]
    : job.action === "export-csv" && processed === 0
      ? [CSV_HEADER.join(",")]
      : [];
  const recheckResults: BulkRecheckResult[] = prior.results ? [...prior.results] : [];

  try {
    while (processed + skipped < job.total) {
      // Cancellation check between chunks: a recruiter clicking "Cancel" on
      // the floating progress card flips the row's status to `canceled`. We
      // re-read the status here so the worker stops scheduling new chunks
      // and leaves the partial counts intact.
      if (await isJobCanceled(job.id)) {
        logger.info(
          { jobId: job.id, processed, skipped, total: job.total },
          "Bulk job canceled mid-run; stopping further chunks",
        );
        return;
      }

      const offset = processed + skipped;
      const chunk = job.ids.slice(offset, offset + CHUNK_SIZE);
      if (chunk.length === 0) break;

      const delta = await processChunk(job, chunk);
      processed += delta.processedDelta;
      skipped += delta.skippedDelta;
      if (delta.csvLines && delta.csvLines.length > 0) {
        csvParts.push(delta.csvLines.join("\n"));
      }
      if (delta.recheckResults) {
        recheckResults.push(...delta.recheckResults);
      }

      // Persist progress after every chunk so a poller / refresh sees
      // accurate %, and so a process restart can resume from here.
      const partialResult: Record<string, unknown> | null =
        job.action === "export-csv"
          ? { csv: csvParts.join("\n") }
          : job.action === "recheck-email"
            ? { results: recheckResults }
            : null;
      await db
        .update(bulkJobsTable)
        .set({
          processed,
          skipped,
          result: partialResult,
          updatedAt: new Date(),
        })
        .where(eq(bulkJobsTable.id, job.id));
    }

    const finalResult: Record<string, unknown> | null =
      job.action === "export-csv"
        ? { csv: csvParts.join("\n") }
        : job.action === "recheck-email"
          ? { results: recheckResults }
          : null;

    // Guard the terminal write with `status='running'` so a recruiter who
    // cancelled the job mid-chunk (after we'd passed the in-loop check but
    // before this update lands) doesn't get their `canceled` row overwritten
    // by `completed`. Same idea for the failure path below.
    await db
      .update(bulkJobsTable)
      .set({
        status: "completed",
        processed,
        skipped,
        result: finalResult,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bulkJobsTable.id, job.id),
          eq(bulkJobsTable.status, "running"),
        ),
      );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId: job.id, err: message }, "Bulk job failed");
    await db
      .update(bulkJobsTable)
      .set({
        status: "failed",
        processed,
        skipped,
        errorMessage: message,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bulkJobsTable.id, job.id),
          eq(bulkJobsTable.status, "running"),
        ),
      );
  }
}

let timer: NodeJS.Timeout | undefined;
let stopped = false;
let running = false;

function scheduleImmediateTick() {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void tick();
  }, 0);
  if (typeof timer.unref === "function") timer.unref();
}

function scheduleNextTick() {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void tick();
  }, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

async function tick() {
  if (running || stopped) {
    if (!stopped) scheduleNextTick();
    return;
  }
  running = true;
  try {
    // Trim old completed/failed/canceled rows on the same cadence as the
    // worker tick — bounded by `RETENTION_SWEEP_INTERVAL_MS` internally so we
    // don't hammer the DB.
    await maybeRunRetentionSweep();
    // Process oldest pending first so the queue behaves FIFO.
    const [job] = await db
      .select()
      .from(bulkJobsTable)
      .where(eq(bulkJobsTable.status, "pending"))
      .orderBy(bulkJobsTable.id)
      .limit(1);
    if (job) {
      await runJob(job);
      // Drain back-to-back jobs without waiting a full poll interval.
      scheduleImmediateTick();
      return;
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Bulk-job worker tick crashed",
    );
  } finally {
    running = false;
  }
  scheduleNextTick();
}

/**
 * Start the in-process queue worker. Safe to call once at boot. On startup we
 * sweep any rows that were left in `running` by a previous process back to
 * `pending` so they get picked up and resumed from `processed`.
 */
export async function startBulkJobsWorker(): Promise<void> {
  try {
    await db
      .update(bulkJobsTable)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(bulkJobsTable.status, "running"));
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "Bulk-job worker: failed to requeue stale running jobs",
    );
  }
  logger.info("Bulk-job worker started");
  scheduleImmediateTick();
}

export function stopBulkJobsWorker(): void {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
}

/**
 * Internal helpers exposed for unit tests in `bulk-jobs.test.ts`. Not part of
 * the runtime API; do not import from production code.
 */
export const __testInternals = {
  processChunk,
  runJob,
  CHUNK_SIZE,
  resetWorkerState() {
    stopped = false;
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  },
};
