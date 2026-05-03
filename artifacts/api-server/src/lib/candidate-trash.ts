import { and, isNotNull, lt } from "drizzle-orm";
import { db, candidatesTable } from "@workspace/db";
import { logger } from "./logger";

/**
 * Trash retention window for soft-deleted candidates. After this many ms have
 * passed since `deletedAt`, the row is no longer recoverable via the "Undo"
 * toast and the sweeper hard-deletes it (cascading FK children with it).
 *
 * Defaults to 7 days, matching the "trash bin" option in the task spec.
 * Overridable via env so ops can shorten it during incident response or
 * lengthen it when running customer-facing data migrations.
 */
const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_MS = (() => {
  const raw = Number(process.env["CANDIDATE_TRASH_RETENTION_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_MS;
})();

/**
 * How often the sweeper wakes up. We don't need a precise cadence — being a
 * few minutes late on hard-deleting a 7-day-old row is fine — so default to
 * hourly to keep wake-ups cheap.
 */
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const INTERVAL_MS = (() => {
  const raw = Number(process.env["CANDIDATE_TRASH_SWEEP_INTERVAL_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MS;
})();

/**
 * Hard-delete every candidate whose soft-delete is older than the retention
 * window. Exported (rather than kept private) so admin tooling and tests can
 * trigger a sweep deterministically without waiting for the timer.
 */
export async function purgeExpiredSoftDeletedCandidates(
  now: Date = new Date(),
): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const purged = await db
    .delete(candidatesTable)
    .where(
      and(
        isNotNull(candidatesTable.deletedAt),
        lt(candidatesTable.deletedAt, cutoff),
      ),
    )
    .returning({ id: candidatesTable.id });
  return { purged: purged.length };
}

/**
 * Start the recurring sweep. Safe to call from `index.ts` on boot — uses
 * `unref()` so the timer doesn't keep the process alive past a graceful
 * shutdown.
 */
export function startCandidateTrashCleanupScheduler(): void {
  const tick = async () => {
    try {
      const { purged } = await purgeExpiredSoftDeletedCandidates();
      if (purged > 0) {
        logger.info(
          { purged, retentionMs: RETENTION_MS },
          "Hard-deleted soft-deleted candidates past retention window",
        );
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "Candidate trash cleanup sweep failed",
      );
    }
  };

  // Run once shortly after boot so a process that's been down for a while
  // catches up without waiting a full interval.
  setTimeout(() => {
    void tick();
  }, 30_000).unref();
  setInterval(() => {
    void tick();
  }, INTERVAL_MS).unref();
}
