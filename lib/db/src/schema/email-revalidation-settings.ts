import { pgTable, integer, timestamp, boolean, text } from "drizzle-orm/pg-core";

/**
 * Singleton settings row (id is fixed to 1) controlling the background email
 * re-validation sweeper. Surfaced in the admin UI so non-engineers can trade
 * DNS noise for freshness without a redeploy.
 */
export const emailRevalidationSettingsTable = pgTable(
  "email_revalidation_settings",
  {
    id: integer("id").primaryKey().default(1),
    /** Days after which a previously validated email is considered stale. */
    thresholdDays: integer("threshold_days").notNull(),
    /** How often the background sweeper wakes up to look for stale rows. */
    intervalMs: integer("interval_ms").notNull(),
    /** Cap how many candidates a single sweep will re-check. */
    batchSize: integer("batch_size").notNull(),
    /**
     * How many days of sweep history to keep in `email_revalidation_runs`.
     * Older rows are pruned automatically at the end of each sweep so the
     * "Recent activity" query stays fast on long-lived deployments. Defaults
     * to 30 days; admins can tune this from the settings UI.
     */
    retentionDays: integer("retention_days").notNull().default(30),
    /** When false, the scheduler is paused (no sweeps will run). */
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Number of consecutive failed sweeps that triggers an admin alert. A
     * sweep is "failed" when it crashed (errorMessage is set) or recorded any
     * per-candidate errors. Set to 0 to disable alerting.
     */
    alertThreshold: integer("alert_threshold").notNull().default(3),
    /**
     * Optional admin address to notify when the alert fires. When null, the
     * in-app banner is the only notification surface.
     */
    alertEmail: text("alert_email"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export type EmailRevalidationSettings =
  typeof emailRevalidationSettingsTable.$inferSelect;
