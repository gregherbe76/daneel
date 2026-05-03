import { pgTable, serial, integer, timestamp, text } from "drizzle-orm/pg-core";

/**
 * One row per executed (or attempted) email re-validation sweep. Surfaced in
 * the admin UI so operators can see the scheduler is actually running and how
 * many addresses each pass touched.
 *
 * `trigger` distinguishes between sweeps the background scheduler kicked off
 * automatically and sweeps an admin requested via the "Run sweep now" button.
 */
export const emailRevalidationRunsTable = pgTable("email_revalidation_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  /** Number of candidates that were re-validated successfully in this sweep. */
  rechecked: integer("rechecked").notNull().default(0),
  /** Number of candidates that threw while re-validating. */
  errors: integer("errors").notNull().default(0),
  /** "scheduled" for background sweeps, "manual" for admin-triggered sweeps. */
  trigger: text("trigger").notNull().default("scheduled"),
  /** Populated only when the sweep itself crashed before completing. */
  errorMessage: text("error_message"),
});

export type EmailRevalidationRun =
  typeof emailRevalidationRunsTable.$inferSelect;
