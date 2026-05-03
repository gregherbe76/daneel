import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Background job rows backing the bulk-action queue. Recruiters who select
 * thousands of candidates would otherwise spend a long time blocked on a
 * sequence of synchronous chunked requests, and any browser refresh would
 * abandon progress.  Queueing the work here lets us return a job id
 * immediately, drive a progress UI, and survive the page being reloaded.
 *
 * `ids` stores the entire selection as a JSON array of integers so the worker
 * can resume from `processed` after a process restart without the client
 * needing to re-send anything.
 */
export const bulkJobsTable = pgTable("bulk_jobs", {
  id: serial("id").primaryKey(),
  /** Mirrors `BulkCandidateAction` (delete, recheck-email, move-stage, export-csv). */
  action: text("action").notNull(),
  /** Full ordered list of candidate ids the recruiter selected. */
  ids: jsonb("ids").$type<number[]>().notNull(),
  /** Optional payload (e.g. `{ jobId, stage }` for move-stage). */
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  /** Total ids the worker is responsible for; cached from `ids.length` to make the progress query cheap. */
  total: integer("total").notNull(),
  /** Number of ids the worker has successfully processed so far. Drives the progress bar. */
  processed: integer("processed").notNull().default(0),
  /** Number of ids the worker considered "skipped" (not found, no email, etc.). */
  skipped: integer("skipped").notNull().default(0),
  /** pending → running → completed | failed | canceled. */
  status: text("status").notNull().default("pending"),
  /**
   * Action-specific result blob, written when the job completes. For
   * `export-csv` this holds the assembled `{ csv: "..." }` so the frontend can
   * download the file when it polls and sees the job finished. For
   * `recheck-email` this holds the per-id outcome list.
   */
  result: jsonb("result").$type<Record<string, unknown> | null>(),
  /** Populated when the job itself crashed (vs. per-id errors which are counted in `skipped`). */
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
});

export type BulkJob = typeof bulkJobsTable.$inferSelect;
