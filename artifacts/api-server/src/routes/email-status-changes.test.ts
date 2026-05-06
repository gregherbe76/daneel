import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  candidatesTable,
  emailStatusChangesTable,
} from "@workspace/db";
import app from "../app";

type SeededRow = {
  id: number;
  newStatus: string;
};

const seededCandidateIds: number[] = [];

async function insertCandidate(opts: {
  name: string;
  email: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(candidatesTable)
    .values({
      name: opts.name,
      email: opts.email,
      emailSource: opts.email ? "manual" : null,
    })
    .returning({ id: candidatesTable.id });
  seededCandidateIds.push(row.id);
  return row.id;
}

async function insertChange(opts: {
  candidateId: number;
  previousStatus: string;
  newStatus: string;
  previousReason: string | null;
  newReason: string | null;
  changedAt: Date;
  notificationSentAt?: Date | null;
}): Promise<SeededRow> {
  const [row] = await db
    .insert(emailStatusChangesTable)
    .values({
      candidateId: opts.candidateId,
      previousStatus: opts.previousStatus,
      newStatus: opts.newStatus,
      previousReason: opts.previousReason,
      newReason: opts.newReason,
      changedAt: opts.changedAt,
      notificationSentAt: opts.notificationSentAt ?? null,
    })
    .returning({
      id: emailStatusChangesTable.id,
      newStatus: emailStatusChangesTable.newStatus,
    });
  return row;
}

const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let candidateWithHistoryId: number;
let candidateNoHistoryId: number;
let candidateNoEmailId: number;

let oldestRow: SeededRow;
let middleRow: SeededRow;
let newestRow: SeededRow;

beforeAll(async () => {
  candidateWithHistoryId = await insertCandidate({
    name: `ESH WithHistory ${uniqueSuffix}`,
    email: `esh-with-history-${uniqueSuffix}@example.com`,
  });
  candidateNoHistoryId = await insertCandidate({
    name: `ESH NoHistory ${uniqueSuffix}`,
    email: `esh-no-history-${uniqueSuffix}@example.com`,
  });
  candidateNoEmailId = await insertCandidate({
    name: `ESH NoEmail ${uniqueSuffix}`,
    email: null,
  });

  oldestRow = await insertChange({
    candidateId: candidateWithHistoryId,
    previousStatus: "unknown",
    newStatus: "valid",
    previousReason: null,
    newReason: "smtp ok",
    changedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
  });
  middleRow = await insertChange({
    candidateId: candidateWithHistoryId,
    previousStatus: "valid",
    newStatus: "risky",
    previousReason: "smtp ok",
    newReason: "catch-all detected",
    changedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  });
  newestRow = await insertChange({
    candidateId: candidateWithHistoryId,
    previousStatus: "risky",
    newStatus: "invalid",
    previousReason: "catch-all detected",
    newReason: "mailbox bounced",
    changedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
  });
});

afterAll(async () => {
  if (seededCandidateIds.length > 0) {
    await db
      .delete(emailStatusChangesTable)
      .where(inArray(emailStatusChangesTable.candidateId, seededCandidateIds));
    await db
      .delete(candidatesTable)
      .where(inArray(candidatesTable.id, seededCandidateIds));
  }
});

describe("GET /api/email-status-changes?candidateId=...", () => {
  it("returns the candidate's history newest-first with previous/new status, reasons, and timestamps", async () => {
    const res = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candidateWithHistoryId });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);

    const ids = res.body.map((r: { id: number }) => r.id);
    expect(ids).toEqual([newestRow.id, middleRow.id, oldestRow.id]);

    const top = res.body[0];
    expect(top.candidateId).toBe(candidateWithHistoryId);
    expect(top.previousStatus).toBe("risky");
    expect(top.newStatus).toBe("invalid");
    expect(top.previousReason).toBe("catch-all detected");
    expect(top.newReason).toBe("mailbox bounced");
    expect(typeof top.changedAt).toBe("string");
    expect(Number.isNaN(new Date(top.changedAt).getTime())).toBe(false);

    const second = res.body[1];
    expect(second.previousStatus).toBe("valid");
    expect(second.newStatus).toBe("risky");

    const third = res.body[2];
    expect(third.previousStatus).toBe("unknown");
    expect(third.newStatus).toBe("valid");
    expect(third.newReason).toBe("smtp ok");

    // Timestamps must be strictly descending so the UI's "newest-first"
    // assumption holds even when the DB returns equal-changedAt ties.
    const times = res.body.map((r: { changedAt: string }) =>
      new Date(r.changedAt).getTime(),
    );
    expect(times[0]).toBeGreaterThan(times[1]);
    expect(times[1]).toBeGreaterThan(times[2]);
  });

  it("returns an empty array for a candidate with no history (so the UI hides the card)", async () => {
    const res = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candidateNoHistoryId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns an empty array for a candidate with no email and no history (the card stays hidden)", async () => {
    const res = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candidateNoEmailId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("does not leak history rows from other candidates when filtering by candidateId", async () => {
    const res = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candidateNoHistoryId });

    expect(res.status).toBe(200);
    const leakedRowIds = (res.body as Array<{ id: number }>).map((r) => r.id);
    expect(leakedRowIds).not.toContain(oldestRow.id);
    expect(leakedRowIds).not.toContain(middleRow.id);
    expect(leakedRowIds).not.toContain(newestRow.id);
  });

  it("respects the optional limit query param", async () => {
    const res = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candidateWithHistoryId, limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Still newest-first even when truncated.
    expect(res.body[0].id).toBe(newestRow.id);
    expect(res.body[1].id).toBe(middleRow.id);
  });

  it("includes notificationSentAt in the response payload (set when an outbound ping was dispatched, null otherwise)", async () => {
    // Task #69 added a "Notified <time>" pill in the inbox driven by
    // notificationSentAt. Lock the field into the API contract so a future
    // refactor can't silently drop it from SELECT_COLUMNS.
    const notifiedCandidateId = await insertCandidate({
      name: `ESH Notified ${uniqueSuffix}`,
      email: `esh-notified-${uniqueSuffix}@example.com`,
    });
    const notifiedAt = new Date(Date.now() - 30 * 60 * 1000);
    const notifiedRow = await insertChange({
      candidateId: notifiedCandidateId,
      previousStatus: "valid",
      newStatus: "invalid",
      previousReason: "smtp ok",
      newReason: "mailbox bounced",
      changedAt: new Date(Date.now() - 20 * 60 * 1000),
      notificationSentAt: notifiedAt,
    });

    const res = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: notifiedCandidateId });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const row = res.body[0];
    expect(row.id).toBe(notifiedRow.id);
    // Field must be present (not undefined) and serialise to a parseable timestamp.
    expect(row).toHaveProperty("notificationSentAt");
    expect(typeof row.notificationSentAt).toBe("string");
    expect(new Date(row.notificationSentAt).getTime()).toBe(notifiedAt.getTime());

    // Sanity check: a candidate whose changes never had notificationSentAt set
    // still surfaces the field, but as null — the UI relies on this to decide
    // whether to render the "Notified" pill.
    const baselineRes = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candidateWithHistoryId });
    expect(baselineRes.status).toBe(200);
    expect(baselineRes.body.length).toBeGreaterThan(0);
    for (const r of baselineRes.body) {
      expect(r).toHaveProperty("notificationSentAt");
      expect(r.notificationSentAt).toBeNull();
    }
  });

  it("?unnotified=true returns only rows where notificationSentAt is null", async () => {
    // Seed a fresh candidate so we can lock in exactly which rows belong
    // to this assertion regardless of other history rows in the DB.
    const candId = await insertCandidate({
      name: `ESH Unnotified ${uniqueSuffix}`,
      email: `esh-unnotified-${uniqueSuffix}@example.com`,
    });
    const silentRow = await insertChange({
      candidateId: candId,
      previousStatus: "valid",
      newStatus: "invalid",
      previousReason: "smtp ok",
      newReason: "mailbox bounced",
      changedAt: new Date(Date.now() - 10 * 60 * 1000),
      notificationSentAt: null,
    });
    const notifiedRow = await insertChange({
      candidateId: candId,
      previousStatus: "valid",
      newStatus: "risky",
      previousReason: "smtp ok",
      newReason: "catch-all detected",
      changedAt: new Date(Date.now() - 9 * 60 * 1000),
      notificationSentAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    // Without the filter, both rows are returned.
    const baseline = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candId });
    expect(baseline.status).toBe(200);
    const baselineIds = (baseline.body as Array<{ id: number }>).map((r) => r.id);
    expect(baselineIds).toContain(silentRow.id);
    expect(baselineIds).toContain(notifiedRow.id);

    // With ?unnotified=true, the row that already pinged out is filtered away.
    const filtered = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candId, unnotified: true });
    expect(filtered.status).toBe(200);
    const filteredIds = (filtered.body as Array<{ id: number }>).map(
      (r) => r.id,
    );
    expect(filteredIds).toContain(silentRow.id);
    expect(filteredIds).not.toContain(notifiedRow.id);
    for (const r of filtered.body as Array<{ notificationSentAt: string | null }>) {
      expect(r.notificationSentAt).toBeNull();
    }
  });

  it("?unnotified=true combines with ?unread=true and ?candidateId=", async () => {
    // Build a candidate with all four combinations of (notified?, read?) so we
    // can assert AND semantics across the three filters.
    const candId = await insertCandidate({
      name: `ESH Combo ${uniqueSuffix}`,
      email: `esh-combo-${uniqueSuffix}@example.com`,
    });
    const otherCandId = await insertCandidate({
      name: `ESH Combo Other ${uniqueSuffix}`,
      email: `esh-combo-other-${uniqueSuffix}@example.com`,
    });

    const mkRow = async (
      cId: number,
      tag: string,
      opts: { notified: boolean; read: boolean },
    ) => {
      const [row] = await db
        .insert(emailStatusChangesTable)
        .values({
          candidateId: cId,
          previousStatus: "valid",
          newStatus: "invalid",
          previousReason: "smtp ok",
          newReason: tag,
          changedAt: new Date(),
          notificationSentAt: opts.notified ? new Date() : null,
          notifiedAt: opts.read ? new Date() : null,
        })
        .returning({ id: emailStatusChangesTable.id });
      return row.id;
    };

    const silentUnread = await mkRow(candId, "silent-unread", {
      notified: false,
      read: false,
    });
    const silentRead = await mkRow(candId, "silent-read", {
      notified: false,
      read: true,
    });
    const notifiedUnread = await mkRow(candId, "notified-unread", {
      notified: true,
      read: false,
    });
    const notifiedRead = await mkRow(candId, "notified-read", {
      notified: true,
      read: true,
    });
    // A matching row on a different candidate to ensure candidateId still scopes.
    const otherSilentUnread = await mkRow(otherCandId, "other-silent-unread", {
      notified: false,
      read: false,
    });

    const res = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candId, unread: true, unnotified: true });
    expect(res.status).toBe(200);

    const ids = (res.body as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toContain(silentUnread);
    expect(ids).not.toContain(silentRead);
    expect(ids).not.toContain(notifiedUnread);
    expect(ids).not.toContain(notifiedRead);
    expect(ids).not.toContain(otherSilentUnread);

    for (const r of res.body as Array<{
      notificationSentAt: string | null;
      notifiedAt: string | null;
      candidateId: number;
    }>) {
      expect(r.notificationSentAt).toBeNull();
      expect(r.notifiedAt).toBeNull();
      expect(r.candidateId).toBe(candId);
    }
  });

  it("count of rows for one candidate matches the badge value the UI renders", async () => {
    // The candidate detail page renders <Badge>{emailHistory.length}</Badge>
    // next to "Email status history". Lock that count in here.
    const res = await request(app)
      .get("/api/email-status-changes")
      .query({ candidateId: candidateWithHistoryId });

    expect(res.status).toBe(200);

    const dbCount = await db
      .select({ id: emailStatusChangesTable.id })
      .from(emailStatusChangesTable)
      .where(eq(emailStatusChangesTable.candidateId, candidateWithHistoryId));

    expect(res.body).toHaveLength(dbCount.length);
    expect(res.body).toHaveLength(3);
  });
});
