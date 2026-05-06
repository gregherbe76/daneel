import { pgTable, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Singleton settings row (id is fixed to 1) controlling the background
 * bulk-job retention sweep. The sweeper deletes terminal `bulk_jobs` rows
 * older than `retentionDays`. Surfaced in the admin UI so non-engineers can
 * tune the window without editing `BULK_JOBS_RETENTION_DAYS` and restarting
 * the API server. The env var is still read on first boot to seed the row.
 */
export const bulkJobsSettingsTable = pgTable("bulk_jobs_settings", {
  id: integer("id").primaryKey().default(1),
  /**
   * How many days terminal (completed/failed/canceled) bulk-job rows are kept
   * before the retention sweep deletes them.
   */
  retentionDays: integer("retention_days").notNull().default(7),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BulkJobsSettings = typeof bulkJobsSettingsTable.$inferSelect;
