import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, candidatesTable } from "@workspace/db";
import {
  purgeExpiredSoftDeletedCandidates,
  startCandidateTrashCleanupScheduler,
} from "./candidate-trash";
import { logger } from "./logger";

// Marker baked into every test row so a leaked row from a crashed run can be
// identified and cleaned up without affecting unrelated data.
const TEST_MARKER = "candidate-trash.test:";

async function createTestCandidate(name: string) {
  const [row] = await db
    .insert(candidatesTable)
    .values({ name: `${TEST_MARKER}${name}` })
    .returning();
  if (!row) throw new Error("failed to insert test candidate");
  return row;
}

async function setDeletedAt(id: number, deletedAt: Date | null) {
  await db
    .update(candidatesTable)
    .set({ deletedAt, deletionBatchId: deletedAt ? "test-batch" : null })
    .where(eq(candidatesTable.id, id));
}

const seededIds: number[] = [];

afterEach(async () => {
  if (seededIds.length === 0) return;
  await db.delete(candidatesTable).where(inArray(candidatesTable.id, seededIds));
  seededIds.length = 0;
});

describe("purgeExpiredSoftDeletedCandidates", () => {
  it("hard-deletes rows whose deletedAt is older than the retention window", async () => {
    const stale = await createTestCandidate("stale");
    const fresh = await createTestCandidate("fresh");
    const live = await createTestCandidate("live");
    seededIds.push(stale.id, fresh.id, live.id);

    // 8 days old — past the 7-day default retention.
    const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    // 1 day old — well within the retention window.
    const recently = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await setDeletedAt(stale.id, longAgo);
    await setDeletedAt(fresh.id, recently);

    const { purged } = await purgeExpiredSoftDeletedCandidates();
    expect(purged).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, [stale.id, fresh.id, live.id]));
    const remainingIds = remaining.map((r) => r.id);
    // Stale row is gone, fresh + live rows are still on disk.
    expect(remainingIds).not.toContain(stale.id);
    expect(remainingIds).toContain(fresh.id);
    expect(remainingIds).toContain(live.id);

    // Track only the rows we still need to clean up in afterEach.
    seededIds.length = 0;
    seededIds.push(fresh.id, live.id);
  });

  it("leaves rows with NULL deletedAt alone even if older than the window", async () => {
    const live = await createTestCandidate("never-deleted");
    seededIds.push(live.id);

    await purgeExpiredSoftDeletedCandidates(
      // Pretend "now" is 100 days in the future to prove the WHERE clause
      // really does require deletedAt IS NOT NULL.
      new Date(Date.now() + 100 * 24 * 60 * 60 * 1000),
    );

    const [stillThere] = await db
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(eq(candidatesTable.id, live.id));
    expect(stillThere?.id).toBe(live.id);
  });
});

describe("startCandidateTrashCleanupScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Each scheduler tick fires a `void tick()` whose body awaits a real DB
  // round-trip. Fake timers fire the callback but do not (and cannot) wait
  // for that real network I/O, so we have to poll the DB ourselves until the
  // hard-delete is observable.
  async function waitUntilGone(ids: number[]) {
    for (let i = 0; i < 100; i++) {
      const rows = await db
        .select({ id: candidatesTable.id })
        .from(candidatesTable)
        .where(inArray(candidatesTable.id, ids));
      if (rows.length === 0) return;
    }
    throw new Error(
      `waitUntilGone: rows ${ids.join(",")} were not purged in time`,
    );
  }

  async function existingIdsOf(ids: number[]) {
    const rows = await db
      .select({ id: candidatesTable.id })
      .from(candidatesTable)
      .where(inArray(candidatesTable.id, ids));
    return rows.map((r) => r.id);
  }

  it("hard-deletes expired rows on the initial tick and on each interval tick", async () => {
    const stale1 = await createTestCandidate("sched-stale-1");
    const stale2 = await createTestCandidate("sched-stale-2");
    const live = await createTestCandidate("sched-live");
    seededIds.push(stale1.id, stale2.id, live.id);

    const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await setDeletedAt(stale1.id, longAgo);

    startCandidateTrashCleanupScheduler();

    // The boot-time setTimeout fires 30s after start.
    await vi.advanceTimersByTimeAsync(30_000);
    await waitUntilGone([stale1.id]);

    let remaining = await existingIdsOf([stale2.id, live.id]);
    expect(remaining).toContain(stale2.id);
    expect(remaining).toContain(live.id);

    // Soft-delete the second stale row and prove the *recurring* interval
    // (not just the one-shot bootstrap timer) really does keep firing.
    await setDeletedAt(stale2.id, longAgo);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await waitUntilGone([stale2.id]);

    remaining = await existingIdsOf([live.id]);
    expect(remaining).toContain(live.id);

    seededIds.length = 0;
    seededIds.push(live.id);
  });

  it("logs and swallows errors so a failing sweep can't crash the process", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined as never);
    const deleteSpy = vi.spyOn(db, "delete").mockImplementationOnce(() => {
      throw new Error("boom: db unavailable");
    });

    // If `tick()`'s catch ever regressed, the rejection would bubble out of
    // the timer callback as an unhandled promise rejection — not a thrown
    // error here — so we assert the synchronous start path is clean and
    // then verify the error was caught + logged instead of swallowed silently.
    expect(() => startCandidateTrashCleanupScheduler()).not.toThrow();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.stringContaining("boom") }),
      "Candidate trash cleanup sweep failed",
    );
  });
});
