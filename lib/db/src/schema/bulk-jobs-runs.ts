import { pgTable, serial, integer, timestamp, text } from "drizzle-orm/pg-core";

/**
 * One row per executed (or attempted) bulk-job retention sweep. Surfaced in
 * the admin UI (Settings → Bulk-job retention) so operators can confirm the
 * background sweep is actually firing and see how many terminal bulk-job rows
 * each pass removed.
 *
 * Mirrors `email_revalidation_runs` in shape so the two settings pages can
 * render the same kind of "Recent activity" table.
 *
 * `trigger` distinguishes between sweeps the in-process worker kicked off on
 * its hourly cadence and sweeps an admin requested via the "Run sweep now"
 * button.
 */
export const bulkJobsRunsTable = pgTable("bulk_jobs_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  /** Number of terminal bulk-job rows the sweep deleted. */
  deleted: integer("deleted").notNull().default(0),
  /** Retention window (days) the sweep was run with. */
  retentionDays: integer("retention_days").notNull().default(0),
  /** "scheduled" for hourly worker sweeps, "manual" for admin-triggered sweeps. */
  trigger: text("trigger").notNull().default("scheduled"),
  /** Populated only when the sweep itself crashed before completing. */
  errorMessage: text("error_message"),
});

export type BulkJobsRun = typeof bulkJobsRunsTable.$inferSelect;
