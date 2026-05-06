import { eq } from "drizzle-orm";
import {
  db,
  bulkJobsSettingsTable,
  type BulkJobsSettings,
} from "@workspace/db";

const SINGLETON_ID = 1;

/**
 * Default retention window seeded into the singleton row on first boot. We
 * still read `BULK_JOBS_RETENTION_DAYS` here so existing deployments that set
 * the env var get the same default they had before — once the row exists,
 * later updates come from the database (admins can tune from the UI without
 * a redeploy).
 */
const DEFAULT_RETENTION_DAYS = (() => {
  const raw = process.env.BULK_JOBS_RETENTION_DAYS;
  if (!raw) return 7;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 7;
})();

/**
 * Read the current bulk-jobs settings, seeding the singleton row from the env
 * var default on first call so subsequent updates always have a row to UPDATE.
 */
export async function getBulkJobsSettings(): Promise<BulkJobsSettings> {
  const [row] = await db
    .select()
    .from(bulkJobsSettingsTable)
    .where(eq(bulkJobsSettingsTable.id, SINGLETON_ID));
  if (row) return row;

  const [seeded] = await db
    .insert(bulkJobsSettingsTable)
    .values({
      id: SINGLETON_ID,
      retentionDays: DEFAULT_RETENTION_DAYS,
    })
    .onConflictDoNothing()
    .returning();
  if (seeded) return seeded;

  // Lost a race with another instance — re-read.
  const [existing] = await db
    .select()
    .from(bulkJobsSettingsTable)
    .where(eq(bulkJobsSettingsTable.id, SINGLETON_ID));
  if (!existing) {
    throw new Error("Failed to load or seed bulk-jobs settings");
  }
  return existing;
}

export async function updateBulkJobsSettings(input: {
  retentionDays: number;
}): Promise<BulkJobsSettings> {
  // Make sure the row exists.
  await getBulkJobsSettings();
  const [updated] = await db
    .update(bulkJobsSettingsTable)
    .set({
      retentionDays: input.retentionDays,
      updatedAt: new Date(),
    })
    .where(eq(bulkJobsSettingsTable.id, SINGLETON_ID))
    .returning();
  return updated;
}
