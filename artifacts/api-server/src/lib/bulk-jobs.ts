import { and, eq, inArray, desc, or } from "drizzle-orm";
import {
  db,
  bulkJobsTable,
  candidatesTable,
  applicationsTable,
  type BulkJob,
} from "@workspace/db";
import { revalidateCandidateEmail } from "./email-revalidation";
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

async function runJob(job: BulkJob): Promise<void> {
  // Move pending → running and stamp the start time. If we're resuming a job
  // that was already running before a restart, leave startedAt alone.
  await db
    .update(bulkJobsTable)
    .set({
      status: "running",
      startedAt: job.startedAt ?? new Date(),
      updatedAt: new Date(),
      errorMessage: null,
    })
    .where(eq(bulkJobsTable.id, job.id));

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
      .where(eq(bulkJobsTable.id, job.id));
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
      .where(eq(bulkJobsTable.id, job.id));
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
