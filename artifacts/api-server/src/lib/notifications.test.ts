import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recipient = { email: string; mode: "instant" | "digest" };

interface SettingsRow {
  id: number;
  emailEnabled: boolean;
  emailRecipients: string;
  recipientModes: Record<string, "instant" | "digest">;
  slackEnabled: boolean;
  slackWebhookUrl: string | null;
  digestCadenceHours: number;
  digestLastSentAt: Date | null;
  updatedAt: Date;
}

interface DigestRowFixture {
  id: number;
  candidateId: number;
  candidateName: string;
  candidateEmail: string | null;
  previousStatus: string;
  newStatus: string;
  newReason: string | null;
  changedAt: Date;
}

const dbState: {
  settings: SettingsRow | null;
  digestRows: DigestRowFixture[];
  cursorUpdates: Date[];
  changeStamps: { ids: number[]; sentAt: Date }[];
  singleChangeStamps: { sentAt: Date }[];
  loadDigestSinceCalls: unknown[];
} = {
  settings: null,
  digestRows: [],
  cursorUpdates: [],
  changeStamps: [],
  singleChangeStamps: [],
  loadDigestSinceCalls: [],
};

const tables = {
  notification: { __name: "notification_settings" } as { __name: string },
  emailStatusChanges: {
    __name: "email_status_changes",
    id: { __col: "id" },
    changedAt: { __col: "changed_at" },
    candidateId: { __col: "candidate_id" },
  } as unknown as { __name: string; id: unknown; changedAt: unknown; candidateId: unknown },
  candidates: {
    __name: "candidates",
    id: { __col: "id" },
    name: { __col: "name" },
    email: { __col: "email" },
  } as unknown as { __name: string; id: unknown; name: unknown; email: unknown },
};

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: (_cols?: unknown) => ({
        from: (table: { __name: string }) => {
          if (table.__name === "notification_settings") {
            return {
              where: async () => (dbState.settings ? [dbState.settings] : []),
            };
          }
          // loadDigestRows path
          return {
            innerJoin: (_t: unknown, _on: unknown) => ({
              where: (_w: unknown) => ({
                orderBy: async () => dbState.digestRows,
              }),
            }),
          };
        },
      }),
      insert: (_table: unknown) => ({
        values: (v: Partial<SettingsRow>) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              if (!dbState.settings) {
                dbState.settings = makeSettingsRow(v);
              }
              return [dbState.settings];
            },
          }),
        }),
      }),
      update: (table: { __name: string }) => ({
        set: (vals: Record<string, unknown>) => ({
          where: async () => {
            if (table.__name === "notification_settings") {
              if (vals["digestLastSentAt"] instanceof Date) {
                dbState.cursorUpdates.push(vals["digestLastSentAt"] as Date);
              }
              if (dbState.settings) Object.assign(dbState.settings, vals);
              return [];
            }
            if (table.__name === "email_status_changes") {
              const sentAt = vals["notificationSentAt"] as Date;
              const ids = lastInArrayIds;
              if (ids) {
                dbState.changeStamps.push({ ids, sentAt });
              } else {
                dbState.singleChangeStamps.push({ sentAt });
              }
              lastInArrayIds = null;
              return [];
            }
            return [];
          },
        }),
      }),
    },
    notificationSettingsTable: tables.notification,
    emailStatusChangesTable: tables.emailStatusChanges,
    candidatesTable: tables.candidates,
  };
});

let lastGtSince: unknown = null;
let lastInArrayIds: number[] | null = null;

vi.mock("drizzle-orm", () => ({
  eq: (_a: unknown, _b: unknown) => ({ __op: "eq" }),
  gt: (_a: unknown, b: unknown) => {
    lastGtSince = b;
    return { __op: "gt", b };
  },
  inArray: (_col: unknown, ids: number[]) => {
    lastInArrayIds = ids;
    return { __op: "inArray", ids };
  },
}));

vi.mock("./logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeSettingsRow(partial: Partial<SettingsRow> = {}): SettingsRow {
  return {
    id: 1,
    emailEnabled: false,
    emailRecipients: "",
    recipientModes: {},
    slackEnabled: false,
    slackWebhookUrl: null,
    digestCadenceHours: 24,
    digestLastSentAt: null,
    updatedAt: new Date(),
    ...partial,
  };
}

function setSettings(recipients: Recipient[], overrides: Partial<SettingsRow> = {}): void {
  const modes: Record<string, "instant" | "digest"> = {};
  for (const r of recipients) if (r.mode === "digest") modes[r.email] = "digest";
  dbState.settings = makeSettingsRow({
    emailEnabled: true,
    emailRecipients: recipients.map((r) => r.email).join(","),
    recipientModes: modes,
    ...overrides,
  });
}

const {
  dispatchRegressionNotification,
  runDigestSweep,
  loadDigestRows,
  getDigestStatus,
  startDigestScheduler,
  stopDigestScheduler,
} = await import("./notifications");

const fetchMock = vi.fn();

async function flushMicrotasks(iterations = 20): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  dbState.settings = null;
  dbState.digestRows = [];
  dbState.cursorUpdates = [];
  dbState.changeStamps = [];
  dbState.singleChangeStamps = [];
  dbState.loadDigestSinceCalls = [];
  lastGtSince = null;
  lastInArrayIds = null;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env["SENDGRID_API_KEY"];
  stopDigestScheduler();
  vi.useRealTimers();
});

const sampleChange = {
  id: 1,
  candidateId: 42,
  previousStatus: "valid",
  newStatus: "invalid",
  newReason: "MX lookup failed",
};
const sampleCandidate = { name: "Alice Example", email: "alice@example.com" };

function snapshotSettings(overrides: Partial<{
  emailEnabled: boolean;
  emailRecipients: Recipient[];
  slackEnabled: boolean;
  slackWebhookUrl: string | null;
  emailDeliveryConfigured: boolean;
  digestCadenceHours: number;
  digestLastSentAt: Date | null;
}> = {}) {
  return {
    emailEnabled: false,
    emailRecipients: [] as Recipient[],
    slackEnabled: false,
    slackWebhookUrl: null,
    emailDeliveryConfigured: false,
    digestCadenceHours: 24,
    digestLastSentAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("dispatchRegressionNotification", () => {
  it("does nothing when both channels are disabled", async () => {
    await dispatchRegressionNotification(
      snapshotSettings(),
      sampleChange,
      sampleCandidate,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbState.singleChangeStamps).toHaveLength(0);
  });

  it("posts to Slack when slack is enabled and stamps notificationSentAt", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });

    await dispatchRegressionNotification(
      snapshotSettings({
        slackEnabled: true,
        slackWebhookUrl: "https://hooks.slack.test/abc",
      }),
      sampleChange,
      sampleCandidate,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hooks.slack.test/abc");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.text).toContain("Alice Example");
    expect(body.text).toContain("valid → invalid");
    expect(body.text).toContain("MX lookup failed");
    expect(dbState.singleChangeStamps).toHaveLength(1);
    expect(dbState.singleChangeStamps[0]!.sentAt).toBeInstanceOf(Date);
  });

  it("does not stamp notificationSentAt when every channel fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: "boom" });

    await dispatchRegressionNotification(
      snapshotSettings({
        slackEnabled: true,
        slackWebhookUrl: "https://hooks.slack.test/bad",
      }),
      sampleChange,
      sampleCandidate,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dbState.singleChangeStamps).toHaveLength(0);
  });

  it("skips email when emailDeliveryConfigured is false even if enabled", async () => {
    await dispatchRegressionNotification(
      snapshotSettings({
        emailEnabled: true,
        emailRecipients: [{ email: "bob@example.com", mode: "instant" }],
        emailDeliveryConfigured: false,
      }),
      sampleChange,
      sampleCandidate,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbState.singleChangeStamps).toHaveLength(0);
  });

  it("sends email via SendGrid when configured and enabled", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    await dispatchRegressionNotification(
      snapshotSettings({
        emailEnabled: true,
        emailRecipients: [
          { email: "bob@example.com", mode: "instant" },
          { email: "carol@example.com", mode: "instant" },
        ],
        emailDeliveryConfigured: true,
      }),
      sampleChange,
      sampleCandidate,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe("Bearer sg-test-key");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.personalizations[0].to).toEqual([
      { email: "bob@example.com" },
      { email: "carol@example.com" },
    ]);
    expect(body.subject).toContain("Alice Example");
    expect(dbState.singleChangeStamps).toHaveLength(1);
  });

  it("skips digest-mode recipients when dispatching the instant fan-out", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    await dispatchRegressionNotification(
      snapshotSettings({
        emailEnabled: true,
        emailRecipients: [
          { email: "bob@example.com", mode: "instant" },
          { email: "carol@example.com", mode: "digest" },
        ],
        emailDeliveryConfigured: true,
      }),
      sampleChange,
      sampleCandidate,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.personalizations[0].to).toEqual([{ email: "bob@example.com" }]);
  });
});

describe("loadDigestRows", () => {
  it("uses the provided `since` cursor as the lower bound", async () => {
    const since = new Date("2026-01-01T00:00:00Z");
    await loadDigestRows(since, 24);
    expect(lastGtSince).toBe(since);
  });

  it("falls back to a `cadenceHours`-wide window when `since` is null", async () => {
    const fixedNow = new Date("2026-05-05T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    await loadDigestRows(null, 6);

    expect(lastGtSince).toBeInstanceOf(Date);
    const expected = new Date(fixedNow.getTime() - 6 * 60 * 60 * 1000);
    expect((lastGtSince as Date).getTime()).toBe(expected.getTime());
  });
});

describe("getDigestStatus", () => {
  it("computes nextTickAt as lastSentAt + cadence when scheduler is enabled", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    const lastSent = new Date("2026-05-05T00:00:00Z");
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: 6,
      digestLastSentAt: lastSent,
    });
    dbState.digestRows = [
      {
        id: 1,
        candidateId: 7,
        candidateName: "X",
        candidateEmail: null,
        previousStatus: "valid",
        newStatus: "invalid",
        newReason: null,
        changedAt: new Date("2026-05-05T01:00:00Z"),
      },
    ];

    const now = new Date("2026-05-05T03:00:00Z");
    const status = await getDigestStatus(now);

    expect(status.schedulerEnabled).toBe(true);
    expect(status.lastSentAt?.toISOString()).toBe(lastSent.toISOString());
    expect(status.nextTickAt?.toISOString()).toBe(
      new Date(lastSent.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    );
    expect(status.overdue).toBe(false);
    expect(status.queuedRegressionCount).toBe(1);
    expect(status.digestRecipientCount).toBe(1);
  });

  it("flags overdue when nextTickAt is in the past", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    const lastSent = new Date("2026-05-01T00:00:00Z");
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: 24,
      digestLastSentAt: lastSent,
    });

    const status = await getDigestStatus(new Date("2026-05-05T00:00:00Z"));

    expect(status.schedulerEnabled).toBe(true);
    expect(status.overdue).toBe(true);
  });

  it("returns nextTickAt=null and schedulerEnabled=false when paused", async () => {
    setSettings([{ email: "instant@example.com", mode: "instant" }], {
      emailEnabled: true,
    });
    process.env["SENDGRID_API_KEY"] = "sg-test-key";

    const status = await getDigestStatus(new Date("2026-05-05T00:00:00Z"));

    expect(status.schedulerEnabled).toBe(false);
    expect(status.nextTickAt).toBeNull();
    expect(status.overdue).toBe(false);
    expect(status.digestRecipientCount).toBe(0);
  });

  it("uses now+cadence as the first nextTickAt when no digest has been sent", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: 12,
      digestLastSentAt: null,
    });

    const now = new Date("2026-05-05T00:00:00Z");
    const status = await getDigestStatus(now);

    expect(status.lastSentAt).toBeNull();
    expect(status.nextTickAt?.toISOString()).toBe(
      new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
    );
  });
});

describe("runDigestSweep", () => {
  it("returns no_digest_recipients when nobody opted in", async () => {
    setSettings([{ email: "instant@example.com", mode: "instant" }], {
      emailEnabled: true,
    });
    process.env["SENDGRID_API_KEY"] = "sg-test-key";

    const result = await runDigestSweep(new Date("2026-05-05T12:00:00Z"));

    expect(result).toEqual({
      attempted: false,
      recipientCount: 0,
      regressionCount: 0,
      reason: "no_digest_recipients",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbState.cursorUpdates).toHaveLength(0);
  });

  it("returns delivery_not_configured when SENDGRID_API_KEY is missing", async () => {
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
    });
    // No SENDGRID_API_KEY in env

    const result = await runDigestSweep(new Date("2026-05-05T12:00:00Z"));

    expect(result.attempted).toBe(false);
    expect(result.reason).toBe("delivery_not_configured");
    expect(result.recipientCount).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbState.cursorUpdates).toHaveLength(0);
  });

  it("advances the cursor without sending when there are no new regressions", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestLastSentAt: new Date("2026-05-04T12:00:00Z"),
    });
    dbState.digestRows = [];

    const now = new Date("2026-05-05T12:00:00Z");
    const result = await runDigestSweep(now);

    expect(result).toEqual({
      attempted: false,
      recipientCount: 1,
      regressionCount: 0,
      reason: "no_new_regressions",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbState.cursorUpdates).toEqual([now]);
    expect(dbState.changeStamps).toHaveLength(0);
  });

  it("sends one rolled-up email to every digest recipient and stamps notification_sent_at", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings(
      [
        { email: "digest1@example.com", mode: "digest" },
        { email: "digest2@example.com", mode: "digest" },
        { email: "instant@example.com", mode: "instant" },
      ],
      {
        emailEnabled: true,
        digestCadenceHours: 12,
        digestLastSentAt: new Date("2026-05-05T00:00:00Z"),
      },
    );
    dbState.digestRows = [
      {
        id: 11,
        candidateId: 1,
        candidateName: "Alice",
        candidateEmail: "alice@example.com",
        previousStatus: "valid",
        newStatus: "invalid",
        newReason: "MX lookup failed",
        changedAt: new Date("2026-05-05T03:00:00Z"),
      },
      {
        id: 12,
        candidateId: 2,
        candidateName: "Bob",
        candidateEmail: null,
        previousStatus: "valid",
        newStatus: "risky",
        newReason: null,
        changedAt: new Date("2026-05-05T05:00:00Z"),
      },
      {
        id: 13,
        candidateId: 3,
        candidateName: "Carol",
        candidateEmail: "carol@example.com",
        previousStatus: "valid",
        newStatus: "invalid",
        newReason: "bounced",
        changedAt: new Date("2026-05-05T11:00:00Z"),
      },
    ];
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    const now = new Date("2026-05-05T12:00:00Z");
    const result = await runDigestSweep(now);

    expect(result).toEqual({
      attempted: true,
      recipientCount: 2,
      regressionCount: 3,
      truncatedCount: 0,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse((init as { body: string }).body);
    expect(body.personalizations[0].to).toEqual([
      { email: "digest1@example.com" },
      { email: "digest2@example.com" },
    ]);
    expect(body.subject).toContain("3 new email regressions");
    expect(body.subject).toContain("12h");
    expect(body.content[0].value).toContain("Alice");
    expect(body.content[0].value).toContain("Bob");
    expect(body.content[0].value).toContain("(no email)");
    expect(body.content[0].value).toContain("Carol");
    expect(body.content[0].value).toContain("bounced");

    expect(dbState.changeStamps).toHaveLength(1);
    expect(dbState.changeStamps[0]!.ids).toEqual([11, 12, 13]);
    expect(dbState.changeStamps[0]!.sentAt).toEqual(now);
    expect(dbState.cursorUpdates).toEqual([now]);
  });

  it("caps the digest at MAX_DIGEST_ROWS, parks the cursor, and notes the remainder", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: 24,
      digestLastSentAt: new Date("2026-04-29T12:00:00Z"),
    });
    // 150 backlog rows, ascending by changedAt — the digest should include
    // the first 100 and leave 50 for the next sweep.
    const start = new Date("2026-04-29T13:00:00Z").getTime();
    dbState.digestRows = Array.from({ length: 150 }, (_, i) => ({
      id: 1000 + i,
      candidateId: i + 1,
      candidateName: `Cand ${i + 1}`,
      candidateEmail: `cand${i + 1}@example.com`,
      previousStatus: "valid",
      newStatus: "invalid",
      newReason: "bounced",
      // Spread evenly over the backlog window so the 100th row's `changedAt`
      // is well before `now`.
      changedAt: new Date(start + i * 60 * 1000),
    }));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    const now = new Date("2026-05-06T12:00:00Z");
    const result = await runDigestSweep(now);

    expect(result.attempted).toBe(true);
    expect(result.regressionCount).toBe(100);
    expect(result.truncatedCount).toBe(50);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.subject).toContain("150 new email regressions");
    expect(body.content[0].value).toContain(
      "… and 50 more not shown here. They will be included in the next digest.",
    );
    // Last row in the body is the 100th candidate, not the 150th.
    expect(body.content[0].value).toContain("Cand 100");
    expect(body.content[0].value).not.toContain("Cand 101");

    // Stamp only the included 100 ids.
    expect(dbState.changeStamps).toHaveLength(1);
    expect(dbState.changeStamps[0]!.ids).toHaveLength(100);
    expect(dbState.changeStamps[0]!.ids[0]).toBe(1000);
    expect(dbState.changeStamps[0]!.ids[99]).toBe(1099);

    // Cursor parks at the last included row's `changedAt`, NOT `now`, so the
    // remaining 50 rows are picked up by the next digest.
    expect(dbState.cursorUpdates).toHaveLength(1);
    const expectedCursor = new Date(start + 99 * 60 * 1000);
    expect(dbState.cursorUpdates[0]!.getTime()).toBe(expectedCursor.getTime());
    expect(dbState.cursorUpdates[0]!.getTime()).toBeLessThan(now.getTime());
  });

  it("extends the cap through timestamp ties so no regression is silently skipped", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: 24,
      digestLastSentAt: new Date("2026-04-29T12:00:00Z"),
    });
    // 105 rows where rows 99..103 all share the SAME changedAt. A naive
    // slice(0, 100) would park the cursor at that shared timestamp and the
    // next sweep's `gt(cursor)` filter would silently drop rows 101..103.
    // The fix should extend the batch through the tie boundary.
    const tieTime = new Date("2026-04-30T08:00:00Z");
    const rows: DigestRowFixture[] = [];
    for (let i = 0; i < 99; i++) {
      rows.push({
        id: 2000 + i,
        candidateId: i + 1,
        candidateName: `Cand ${i + 1}`,
        candidateEmail: `cand${i + 1}@example.com`,
        previousStatus: "valid",
        newStatus: "invalid",
        newReason: null,
        changedAt: new Date(Date.UTC(2026, 3, 29, 13, i, 0)),
      });
    }
    // 5 tied rows at index 99..103 (positions 100..104).
    for (let i = 0; i < 5; i++) {
      rows.push({
        id: 2099 + i,
        candidateId: 100 + i,
        candidateName: `Tie ${i}`,
        candidateEmail: `tie${i}@example.com`,
        previousStatus: "valid",
        newStatus: "invalid",
        newReason: null,
        changedAt: tieTime,
      });
    }
    // One row strictly after the tie burst.
    rows.push({
      id: 2999,
      candidateId: 999,
      candidateName: "After",
      candidateEmail: "after@example.com",
      previousStatus: "valid",
      newStatus: "invalid",
      newReason: null,
      changedAt: new Date(tieTime.getTime() + 60 * 1000),
    });
    dbState.digestRows = rows;
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    const now = new Date("2026-05-06T12:00:00Z");
    const result = await runDigestSweep(now);

    // Cap was 100, but ties pushed the included batch to 104 so no row
    // sharing the boundary timestamp gets dropped. One remaining row
    // (the "After" row) is left for the next digest.
    expect(result.attempted).toBe(true);
    expect(result.regressionCount).toBe(104);
    expect(result.truncatedCount).toBe(1);
    expect(dbState.changeStamps[0]!.ids).toHaveLength(104);
    // Cursor parks at the tied timestamp — safe because the only remaining
    // row has changedAt strictly greater than it.
    expect(dbState.cursorUpdates).toHaveLength(1);
    expect(dbState.cursorUpdates[0]!.getTime()).toBe(tieTime.getTime());
  });

  it("adds a backlog header when the actual window is much wider than the cadence", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    // Cadence is 24h but the last digest went out 7 days ago — backlog mode.
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: 24,
      digestLastSentAt: new Date("2026-04-29T12:00:00Z"),
    });
    dbState.digestRows = [
      {
        id: 1,
        candidateId: 1,
        candidateName: "Alice",
        candidateEmail: "alice@example.com",
        previousStatus: "valid",
        newStatus: "invalid",
        newReason: "bounced",
        changedAt: new Date("2026-05-05T00:00:00Z"),
      },
    ];
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    const now = new Date("2026-05-06T12:00:00Z");
    const result = await runDigestSweep(now);

    expect(result.attempted).toBe(true);
    expect(result.truncatedCount).toBe(0);

    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.subject).toContain("[backlog]");
    expect(body.subject).toContain("7d");
    expect(body.content[0].value).toContain(
      "this digest covers a wider window than your usual",
    );
    expect(body.content[0].value).toContain("1d cadence");
    // No truncation footer when nothing was dropped.
    expect(body.content[0].value).not.toContain("more not shown here");
    // Normal advance to `now` because we weren't truncated.
    expect(dbState.cursorUpdates).toEqual([now]);
  });

  it("uses a normal subject (no backlog tag) when the window matches cadence", async () => {
    process.env["SENDGRID_API_KEY"] = "sg-test-key";
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: 24,
      digestLastSentAt: new Date("2026-05-05T12:00:00Z"),
    });
    dbState.digestRows = [
      {
        id: 1,
        candidateId: 1,
        candidateName: "Alice",
        candidateEmail: "alice@example.com",
        previousStatus: "valid",
        newStatus: "invalid",
        newReason: null,
        changedAt: new Date("2026-05-06T06:00:00Z"),
      },
    ];
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202 });

    const now = new Date("2026-05-06T12:00:00Z");
    await runDigestSweep(now);

    const init = fetchMock.mock.calls[0]![1];
    const body = JSON.parse((init as { body: string }).body);
    expect(body.subject).not.toContain("[backlog]");
    expect(body.subject).toContain("[Daneel]");
    expect(body.content[0].value).not.toContain("Heads up");
  });
});

describe("startDigestScheduler", () => {
  // The scheduler holds module-level state (`digestTimer`, `digestStopped`),
  // so each test re-imports the module to get a fresh, restartable instance.
  async function freshScheduler() {
    vi.resetModules();
    return await import("./notifications");
  }

  it("schedules the next tick using cadence minus elapsed after a recent digest", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const cadenceHours = 4;
    const cadenceMs = cadenceHours * 60 * 60 * 1000;
    // Digest was just sent 30 minutes ago — next tick should fire in
    // cadence - elapsed = 3.5h.
    const lastSent = new Date(Date.now() - 30 * 60 * 1000);

    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: cadenceHours,
      digestLastSentAt: lastSent,
    });
    process.env["SENDGRID_API_KEY"] = "sg-test-key";

    const mod = await freshScheduler();
    mod.startDigestScheduler();
    await flushMicrotasks();
    mod.stopDigestScheduler();

    const schedulerCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => typeof delay === "number" && delay >= 60_000,
    );
    expect(schedulerCalls.length).toBeGreaterThan(0);
    const [, delay] = schedulerCalls[schedulerCalls.length - 1]!;
    const elapsed = Date.now() - lastSent.getTime();
    const expected = cadenceMs - elapsed;
    // Allow ±1s drift from the wall-clock between setSettings and the spy read.
    expect(Math.abs((delay as number) - expected)).toBeLessThan(1000);
  });

  it("clamps the next tick to the minimum interval when overdue", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    // lastSent is way older than cadence — elapsed > cadence — should clamp.
    const lastSent = new Date(Date.now() - 48 * 60 * 60 * 1000);
    setSettings([{ email: "digest@example.com", mode: "digest" }], {
      emailEnabled: true,
      digestCadenceHours: 1,
      digestLastSentAt: lastSent,
    });
    process.env["SENDGRID_API_KEY"] = "sg-test-key";

    const mod = await freshScheduler();
    mod.startDigestScheduler();
    await flushMicrotasks();
    mod.stopDigestScheduler();

    const schedulerCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => typeof delay === "number",
    );
    expect(schedulerCalls.length).toBeGreaterThan(0);
    const [, delay] = schedulerCalls[schedulerCalls.length - 1]!;
    expect(delay).toBe(60 * 1000);
  });
});
