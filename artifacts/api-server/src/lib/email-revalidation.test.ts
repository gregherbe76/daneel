import { describe, expect, it, vi, beforeEach } from "vitest";

type RunRow = {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  rechecked: number;
  errors: number;
  trigger: string;
  errorMessage: string | null;
};

type FakeCandidate = {
  id: number;
  email: string | null;
  emailValidationStatus: string | null;
  emailValidationReason: string | null;
};

const state = {
  runs: [] as RunRow[],
  nextRunId: 1,
  staleIds: [] as number[],
  candidates: new Map<number, FakeCandidate>(),
  settings: null as
    | null
    | { id: number; thresholdDays: number; intervalMs: number; batchSize: number; enabled: boolean },
  failSettings: false,
  failingEmails: new Set<string>(),
  singleFetchQueue: [] as number[],
};

const validateEmailMock = vi.fn(async (email: string) => {
  if (state.failingEmails.has(email)) {
    throw new Error("validate boom");
  }
  return { status: "valid" as const, reason: null };
});

vi.mock("./email-validation", () => ({
  validateEmail: (email: string) => validateEmailMock(email),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@workspace/db", () => {
  const candidatesTable = { __t: "candidates" } as const;
  const emailStatusChangesTable = { __t: "status_changes" } as const;
  const emailRevalidationSettingsTable = { __t: "settings" } as const;
  const emailRevalidationRunsTable = { __t: "runs" } as const;

  function selectFor(table: { __t: string } | null, limited: boolean): unknown[] {
    if (!table) return [];
    if (table.__t === "settings") {
      if (state.failSettings) throw new Error("settings boom");
      return state.settings ? [state.settings] : [];
    }
    if (table.__t === "candidates") {
      if (limited) {
        return state.staleIds.map((id) => ({ id }));
      }
      const id = state.singleFetchQueue.shift();
      if (id == null) return [];
      const c = state.candidates.get(id);
      return c ? [c] : [];
    }
    if (table.__t === "status_changes") return [];
    return [];
  }

  function makeQuery() {
    let table: { __t: string } | null = null;
    let limited = false;
    const q: Record<string, unknown> = {};
    q["from"] = (t: { __t: string }) => {
      table = t;
      return q;
    };
    q["where"] = () => q;
    q["orderBy"] = () => q;
    q["limit"] = () => {
      limited = true;
      return q;
    };
    q["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        const r = selectFor(table, limited);
        return Promise.resolve(r).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    };
    return q;
  }

  function makeDb(): unknown {
    return {
      insert(table: { __t: string }) {
        const chain: Record<string, unknown> = { _vals: undefined };
        chain["values"] = (v: unknown) => {
          chain["_vals"] = v;
          return chain;
        };
        chain["onConflictDoNothing"] = () => chain;
        chain["returning"] = async () => {
          if (table.__t === "runs") {
            const vals = chain["_vals"] as { trigger?: string } | undefined;
            const row: RunRow = {
              id: state.nextRunId++,
              startedAt: new Date(),
              finishedAt: null,
              rechecked: 0,
              errors: 0,
              trigger: vals?.trigger ?? "scheduled",
              errorMessage: null,
            };
            state.runs.push(row);
            return [row];
          }
          return [];
        };
        chain["then"] = (resolve: (v: unknown) => unknown) =>
          Promise.resolve().then(() => resolve(undefined));
        return chain;
      },
      select(_cols?: unknown) {
        return makeQuery();
      },
      update(table: { __t: string }) {
        const chain: Record<string, unknown> = { _vals: undefined };
        chain["set"] = (v: unknown) => {
          chain["_vals"] = v;
          return chain;
        };
        chain["where"] = () => chain;
        chain["returning"] = async () => {
          if (table.__t === "runs") {
            const r = state.runs[state.runs.length - 1];
            if (r) Object.assign(r, chain["_vals"] as object);
            return r ? [r] : [];
          }
          if (table.__t === "candidates") {
            return [];
          }
          return [];
        };
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

import { sweepStaleEmailValidations } from "./email-revalidation";

beforeEach(() => {
  state.runs = [];
  state.nextRunId = 1;
  state.staleIds = [];
  state.candidates.clear();
  state.settings = {
    id: 1,
    thresholdDays: 30,
    intervalMs: 0,
    batchSize: 50,
    enabled: true,
  };
  state.failSettings = false;
  state.failingEmails.clear();
  state.singleFetchQueue = [];
  validateEmailMock.mockClear();
});

function seedCandidates(ids: number[]) {
  for (const id of ids) {
    state.candidates.set(id, {
      id,
      email: `candidate-${id}@example.com`,
      emailValidationStatus: null,
      emailValidationReason: null,
    });
  }
  state.staleIds = ids;
  state.singleFetchQueue = [...ids];
}

describe("sweepStaleEmailValidations", () => {
  it("records a run with rechecked=0 and errors=0 when no candidates are stale", async () => {
    const run = await sweepStaleEmailValidations();

    expect(state.runs).toHaveLength(1);
    expect(run.rechecked).toBe(0);
    expect(run.errors).toBe(0);
    expect(run.errorMessage).toBeNull();
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(validateEmailMock).not.toHaveBeenCalled();
  });

  it("counts per-candidate validation errors without aborting the sweep", async () => {
    seedCandidates([1, 2, 3]);
    state.failingEmails.add("candidate-2@example.com");

    const run = await sweepStaleEmailValidations();

    expect(run.rechecked).toBe(2);
    expect(run.errors).toBe(1);
    expect(run.errorMessage).toBeNull();
    expect(run.finishedAt).toBeInstanceOf(Date);
    // All three candidates were attempted even though the middle one threw.
    expect(validateEmailMock).toHaveBeenCalledTimes(3);
  });

  it("records errorMessage when the sweep itself crashes and still finalizes the run", async () => {
    state.failSettings = true;

    const run = await sweepStaleEmailValidations();

    expect(state.runs).toHaveLength(1);
    expect(run.errorMessage).toContain("settings boom");
    expect(run.rechecked).toBe(0);
    expect(run.errors).toBe(0);
    expect(run.finishedAt).toBeInstanceOf(Date);
  });

  it("records the trigger as 'scheduled' by default", async () => {
    const run = await sweepStaleEmailValidations();
    expect(run.trigger).toBe("scheduled");
  });

  it("records the trigger as 'manual' when invoked manually", async () => {
    const run = await sweepStaleEmailValidations("manual");
    expect(run.trigger).toBe("manual");
  });
});
