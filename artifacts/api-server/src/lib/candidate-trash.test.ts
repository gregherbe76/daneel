import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, candidatesTable } from "@workspace/db";
import { purgeExpiredSoftDeletedCandidates } from "./candidate-trash";

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
