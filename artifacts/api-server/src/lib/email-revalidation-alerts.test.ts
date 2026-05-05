import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";

/**
 * Focused tests for the consecutive-failure alert flow that lives alongside
 * `sweepStaleEmailValidations`:
 *  - alert fires once when the latest N runs all failed
 *  - alert is deduped on subsequent failures in the same streak
 *  - a healthy run resets the streak
 *  - threshold=0 disables alerting
 *  - in-flight (unfinished) runs are ignored
 *  - the alert status endpoint is exercised end-to-end
 *
 * We mock `@workspace/db` and `drizzle-orm` so we can drive a tiny in-memory
 * row store without spinning up Postgres. The mock evaluates the real
 * predicates emitted by drizzle helpers (and/or/eq/lt/isNotNull/...) against
 * row values so the streak walk and `alertedAt` dedupe behave realistically.
 */

type RunRow = {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  rechecked: number;
  errors: number;
  trigger: string;
  errorMessage: string | null;
  alertedAt: Date | null;
};

type Settings = {
  id: number;
  thresholdDays: number;
  intervalMs: number;
  batchSize: number;
  retentionDays: number;
  enabled: boolean;
  alertThreshold: number;
  alertEmail: string | null;
  updatedAt: Date;
};

const state = {
  runs: [] as RunRow[],
  nextRunId: 100,
  settings: null as Settings | null,
  staleCandidateIds: [] as number[],
  validateThrows: false,
  // Monotonic clock for inserted run rows so concurrent sweeps in the same
  // millisecond never collide. Real Postgres uses microsecond-precision
  // `now()`; without this, `lt(startedAt, cursor)` in the streak walk could
  // skip rows that share an exact JS millisecond timestamp.
  clock: 0,
};

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./email-validation", () => ({
  validateEmail: vi.fn(async () => {
    if (state.validateThrows) throw new Error("validate boom");
    return { status: "valid" as const, reason: null };
  }),
}));

vi.mock("./notifications", () => ({
  notifyRegression: vi.fn(async () => undefined),
}));

vi.mock("./logger", () => ({
  logger: loggerMock,
}));

vi.mock("drizzle-orm", () => {
  const make = (op: string, extra: Record<string, unknown>) => ({
    __op: op,
    ...extra,
  });
  return {
    and: (...args: unknown[]) => make("and", { args }),
    or: (...args: unknown[]) => make("or", { args }),
    isNotNull: (col: unknown) => make("isNotNull", { col }),
    isNull: (col: unknown) => make("isNull", { col }),
    lt: (col: unknown, val: unknown) => make("lt", { col, val }),
    gt: (col: unknown, val: unknown) => make("gt", { col, val }),
    eq: (col: unknown, val: unknown) => make("eq", { col, val }),
    desc: (col: unknown) => make("desc", { col }),
    sql: ((..._args: unknown[]) => make("sql", {})) as unknown,
  };
});

vi.mock("@workspace/db", () => {
  type Col = { __c: string };
  const col = (name: string): Col => ({ __c: name });

  const candidatesTable = {
    __t: "candidates",
    id: col("id"),
    email: col("email"),
    deletedAt: col("deletedAt"),
    emailValidatedAt: col("emailValidatedAt"),
  };
  const emailStatusChangesTable = {
    __t: "status_changes",
    id: col("id"),
    candidateId: col("candidateId"),
    notifiedAt: col("notifiedAt"),
    changedAt: col("changedAt"),
  };
  const emailRevalidationSettingsTable = {
    __t: "settings",
    id: col("id"),
  };
  const emailRevalidationRunsTable = {
    __t: "runs",
    id: col("id"),
    startedAt: col("startedAt"),
    finishedAt: col("finishedAt"),
  };

  function evalCond(cond: unknown, row: Record<string, unknown>): boolean {
    if (!cond || typeof cond !== "object") return true;
    const c = cond as { __op?: string } & Record<string, unknown>;
    switch (c.__op) {
      case "and":
        return (c["args"] as unknown[]).every((a) => evalCond(a, row));
      case "or":
        return (c["args"] as unknown[]).some((a) => evalCond(a, row));
      case "isNotNull":
        return row[(c["col"] as Col).__c] != null;
      case "isNull":
        return row[(c["col"] as Col).__c] == null;
      case "lt": {
        const v = row[(c["col"] as Col).__c];
        return v != null && (v as number | Date) < (c["val"] as number | Date);
      }
      case "gt": {
        const v = row[(c["col"] as Col).__c];
        return v != null && (v as number | Date) > (c["val"] as number | Date);
      }
      case "eq":
        return row[(c["col"] as Col).__c] === c["val"];
      case "sql":
        return true;
      default:
        return true;
    }
  }

  function rowsFor(table: { __t: string } | null): Record<string, unknown>[] {
    if (!table) return [];
    if (table.__t === "settings") {
      return state.settings
        ? [state.settings as unknown as Record<string, unknown>]
        : [];
    }
    if (table.__t === "runs") {
      return state.runs as unknown as Record<string, unknown>[];
    }
    if (table.__t === "candidates") {
      return state.staleCandidateIds.map((id) => ({
        id,
        email: `c${id}@example.com`,
        deletedAt: null,
        emailValidatedAt: null,
      }));
    }
    if (table.__t === "status_changes") return [];
    return [];
  }

  function makeSelect(): Record<string, unknown> {
    let table: { __t: string } | null = null;
    let cond: unknown = null;
    let limit: number | undefined;
    let order = false;
    const q: Record<string, unknown> = {};
    q["from"] = (t: { __t: string }) => {
      table = t;
      return q;
    };
    q["where"] = (c: unknown) => {
      cond = c;
      return q;
    };
    q["orderBy"] = () => {
      order = true;
      return q;
    };
    q["limit"] = (n: number) => {
      limit = n;
      return q;
    };
    q["then"] = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      try {
        let rows = rowsFor(table).filter((r) => evalCond(cond, r));
        if (order && table?.__t === "runs") {
          rows = rows
            .slice()
            .sort(
              (a, b) =>
                (b["startedAt"] as Date).getTime() -
                (a["startedAt"] as Date).getTime(),
            );
        }
        if (limit != null) rows = rows.slice(0, limit);
        return Promise.resolve(rows).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    };
    return q;
  }

  function makeDb(): Record<string, unknown> {
    return {
      select: () => makeSelect(),
      insert(table: { __t: string }) {
        const chain: Record<string, unknown> = {};
        let vals: Record<string, unknown> | undefined;
        chain["values"] = (v: Record<string, unknown>) => {
          vals = v;
          return chain;
        };
        chain["onConflictDoNothing"] = () => chain;
        chain["returning"] = async () => {
          if (table.__t === "runs") {
            state.clock += 1000;
            const row: RunRow = {
              id: state.nextRunId++,
              startedAt: new Date(state.clock),
              finishedAt: null,
              rechecked: 0,
              errors: 0,
              trigger: (vals?.["trigger"] as string) ?? "scheduled",
              errorMessage: null,
              alertedAt: null,
            };
            state.runs.push(row);
            return [row];
          }
          if (table.__t === "settings") {
            if (!state.settings && vals) {
              state.settings = {
                id: 1,
                thresholdDays: vals["thresholdDays"] as number,
                intervalMs: vals["intervalMs"] as number,
                batchSize: vals["batchSize"] as number,
                retentionDays: vals["retentionDays"] as number,
                enabled: vals["enabled"] as boolean,
                alertThreshold: 0,
                alertEmail: null,
                updatedAt: new Date(),
              };
            }
            return state.settings ? [state.settings] : [];
          }
          return [];
        };
        chain["then"] = (resolve: (v: unknown) => unknown) =>
          Promise.resolve().then(() => resolve(undefined));
        return chain;
      },
      update(table: { __t: string }) {
        const chain: Record<string, unknown> = {};
        let vals: Record<string, unknown> | undefined;
        let cond: unknown = null;
        const apply = (): unknown[] => {
          if (table.__t === "runs") {
            const updated: RunRow[] = [];
            for (const r of state.runs) {
              if (
                evalCond(cond, r as unknown as Record<string, unknown>) &&
                vals
              ) {
                Object.assign(r, vals);
                updated.push(r);
              }
            }
            return updated;
          }
          if (table.__t === "settings") {
            if (state.settings && vals) Object.assign(state.settings, vals);
            return state.settings ? [state.settings] : [];
          }
          return [];
        };
        chain["set"] = (v: Record<string, unknown>) => {
          vals = v;
          return chain;
        };
        chain["where"] = (c: unknown) => {
          cond = c;
          return chain;
        };
        chain["returning"] = async () => apply();
        chain["then"] = (resolve: (v: unknown) => unknown) =>
          Promise.resolve().then(() => {
            apply();
            resolve(undefined);
          });
        return chain;
      },
      delete(_table: { __t: string }) {
        const chain: Record<string, unknown> = {};
        chain["where"] = () => chain;
        chain["returning"] = async () => [];
        chain["then"] = (resolve: (v: unknown) => unknown) =>
          Promise.resolve().then(() => resolve(undefined));
        return chain;
      },
      async transaction(fn: (tx: unknown) => Promise<unknown>) {
        return fn(makeDb());
      },
    };
  }

  return {
    db: makeDb(),
    candidatesTable,
    emailStatusChangesTable,
    emailRevalidationSettingsTable,
    emailRevalidationRunsTable,
  };
});

import {
  sweepStaleEmailValidations,
  getEmailRevalidationAlertStatus,
} from "./email-revalidation";

function seededSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    id: 1,
    thresholdDays: 30,
    intervalMs: 0,
    batchSize: 50,
    retentionDays: 30,
    enabled: true,
    alertThreshold: 0,
    alertEmail: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function pushRun(run: Partial<RunRow> & { startedAt: Date }): RunRow {
  const row: RunRow = {
    id: state.nextRunId++,
    finishedAt: run.startedAt,
    rechecked: 0,
    errors: 0,
    trigger: "scheduled",
    errorMessage: null,
    alertedAt: null,
    ...run,
  } as RunRow;
  state.runs.push(row);
  return row;
}

const T0 = new Date("2026-01-01T00:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  state.runs = [];
  state.nextRunId = 100;
  state.settings = null;
  state.staleCandidateIds = [];
  state.validateThrows = false;
  // Start the monotonic clock just after the latest seeded run so freshly
  // inserted run rows always sort newer than anything pre-seeded.
  state.clock = T0;
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
});

describe("email-revalidation alert flow", () => {
  it("fires the alert exactly once when the latest N runs all failed", async () => {
    state.settings = seededSettings({ alertThreshold: 2, alertEmail: "ops@example.com" });
    // One prior failed run, no alert stamped yet.
    pushRun({
      startedAt: new Date(T0 - 2 * HOUR),
      errors: 1,
      errorMessage: null,
    });
    // Trigger a fresh failing sweep (errors > 0 because validateEmail throws).
    state.staleCandidateIds = [1];
    state.validateThrows = true;

    const fresh = await sweepStaleEmailValidations();

    expect(fresh.errors).toBe(1);
    // The fresh run is the latest in the streak — it gets the dedupe stamp.
    const stamped = state.runs.find((r) => r.id === fresh.id);
    expect(stamped?.alertedAt).toBeInstanceOf(Date);
    // The structured alert log was emitted.
    const alertLog = loggerMock.error.mock.calls.find(
      ([, msg]) =>
        typeof msg === "string" && msg.includes("consecutive failures threshold reached"),
    );
    expect(alertLog).toBeDefined();
    expect((alertLog?.[0] as { alertEmail: string }).alertEmail).toBe(
      "ops@example.com",
    );

    const status = await getEmailRevalidationAlertStatus();
    expect(status.active).toBe(true);
    expect(status.threshold).toBe(2);
    expect(status.consecutiveFailures).toBe(2);
    expect(status.lastAlertedAt).toBeInstanceOf(Date);
  });

  it("does not re-fire when more failures arrive within the same streak", async () => {
    state.settings = seededSettings({ alertThreshold: 2, alertEmail: "ops@example.com" });
    // Two prior failed runs — the most recent already has alertedAt stamped,
    // simulating that the alert has already fired for this incident.
    pushRun({ startedAt: new Date(T0 - 3 * HOUR), errors: 1 });
    pushRun({
      startedAt: new Date(T0 - 2 * HOUR),
      errors: 1,
      alertedAt: new Date(T0 - 2 * HOUR + 1000),
    });

    state.staleCandidateIds = [1];
    state.validateThrows = true;
    const fresh = await sweepStaleEmailValidations();

    expect(fresh.errors).toBe(1);
    const stamped = state.runs.find((r) => r.id === fresh.id);
    // Dedupe: the new failed run does NOT receive its own alertedAt stamp.
    expect(stamped?.alertedAt).toBeNull();
    const alertLog = loggerMock.error.mock.calls.find(
      ([, msg]) =>
        typeof msg === "string" && msg.includes("consecutive failures threshold reached"),
    );
    expect(alertLog).toBeUndefined();

    // Status is still active and reflects the growing streak length.
    const status = await getEmailRevalidationAlertStatus();
    expect(status.active).toBe(true);
    expect(status.consecutiveFailures).toBe(3);
    expect(status.lastAlertedAt).toBeInstanceOf(Date);
  });

  it("a healthy run resets the streak and a fresh alert can fire later", async () => {
    state.settings = seededSettings({ alertThreshold: 2 });
    // Old incident: failed, failed (alerted), then healthy run that broke it.
    pushRun({ startedAt: new Date(T0 - 5 * HOUR), errors: 1 });
    pushRun({
      startedAt: new Date(T0 - 4 * HOUR),
      errors: 1,
      alertedAt: new Date(T0 - 4 * HOUR + 1000),
    });
    pushRun({ startedAt: new Date(T0 - 3 * HOUR), errors: 0, errorMessage: null });

    // First fresh failure since the healthy reset — streak length = 1, no alert.
    state.staleCandidateIds = [1];
    state.validateThrows = true;
    const first = await sweepStaleEmailValidations();
    expect(first.errors).toBe(1);
    expect(state.runs.find((r) => r.id === first.id)?.alertedAt).toBeNull();

    let status = await getEmailRevalidationAlertStatus();
    expect(status.active).toBe(false);
    expect(status.consecutiveFailures).toBe(1);
    expect(status.lastAlertedAt).toBeNull();

    // Second fresh failure — streak reaches threshold again, fresh alert fires.
    const second = await sweepStaleEmailValidations();
    expect(second.errors).toBe(1);
    expect(state.runs.find((r) => r.id === second.id)?.alertedAt).toBeInstanceOf(
      Date,
    );

    status = await getEmailRevalidationAlertStatus();
    expect(status.active).toBe(true);
    expect(status.consecutiveFailures).toBe(2);
  });

  it("threshold=0 disables alerting entirely", async () => {
    state.settings = seededSettings({ alertThreshold: 0 });
    // Many failed runs — none of them should produce an alert.
    pushRun({ startedAt: new Date(T0 - 3 * HOUR), errors: 1 });
    pushRun({ startedAt: new Date(T0 - 2 * HOUR), errors: 1 });

    state.staleCandidateIds = [1];
    state.validateThrows = true;
    const fresh = await sweepStaleEmailValidations();
    expect(fresh.errors).toBe(1);
    expect(state.runs.find((r) => r.id === fresh.id)?.alertedAt).toBeNull();

    const alertLog = loggerMock.error.mock.calls.find(
      ([, msg]) =>
        typeof msg === "string" && msg.includes("consecutive failures threshold reached"),
    );
    expect(alertLog).toBeUndefined();

    const status = await getEmailRevalidationAlertStatus();
    expect(status.active).toBe(false);
    expect(status.threshold).toBe(0);
    expect(status.consecutiveFailures).toBe(0);
  });

  it("ignores in-flight (unfinished) runs when computing status", async () => {
    state.settings = seededSettings({ alertThreshold: 1 });
    // The latest finished run is healthy — but there's a newer in-flight run
    // that hasn't recorded a result yet. The in-flight row must be ignored.
    pushRun({ startedAt: new Date(T0 - 2 * HOUR), errors: 0 });
    state.runs.push({
      id: state.nextRunId++,
      startedAt: new Date(T0 - 1 * HOUR),
      finishedAt: null, // still running
      rechecked: 0,
      errors: 0,
      trigger: "scheduled",
      errorMessage: null,
      alertedAt: null,
    });

    const status = await getEmailRevalidationAlertStatus();
    expect(status.active).toBe(false);
    expect(status.consecutiveFailures).toBe(0);
  });
});

describe("GET /settings/email-revalidation/alert", () => {
  it("returns the alert status payload over HTTP", async () => {
    state.settings = seededSettings({
      alertThreshold: 2,
      alertEmail: "ops@example.com",
    });
    pushRun({ startedAt: new Date(T0 - 3 * HOUR), errors: 1 });
    pushRun({
      startedAt: new Date(T0 - 2 * HOUR),
      errors: 1,
      alertedAt: new Date(T0 - 2 * HOUR + 500),
    });

    // Late import so the router picks up our mocked db / lib bindings.
    const settingsRouter = (await import("../routes/settings")).default;
    const app = express();
    app.use(express.json());
    app.use("/api", settingsRouter);

    const body = await new Promise<{ status: number; json: any }>(
      (resolve, reject) => {
        const server = app.listen(0, () => {
          const addr = server.address();
          if (!addr || typeof addr === "string") {
            server.close();
            reject(new Error("no address"));
            return;
          }
          fetch(`http://127.0.0.1:${addr.port}/api/settings/email-revalidation/alert`)
            .then(async (res) => {
              const text = await res.text();
              server.close();
              resolve({ status: res.status, json: text ? JSON.parse(text) : null });
            })
            .catch((err) => {
              server.close();
              reject(err);
            });
        });
      },
    );

    expect(body.status).toBe(200);
    expect(body.json).toMatchObject({
      active: true,
      threshold: 2,
      consecutiveFailures: 2,
      alertEmail: "ops@example.com",
    });
    expect(body.json.lastAlertedAt).toBeTruthy();
  });
});
