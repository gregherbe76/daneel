import { describe, expect, it, beforeEach, vi } from "vitest";

// In-memory state shared between the drizzle-orm + @workspace/db mocks below.
type AnyRow = Record<string, unknown>;
type Pred = (row: AnyRow) => boolean;
type ColRef = { __col: string };

interface JobRow {
  id: number;
  status: string;
  finishedAt: Date | null;
  updatedAt: Date;
}
interface SettingsRow {
  id: number;
  retentionDays: number;
  updatedAt: Date;
}

const state = {
  jobs: [] as JobRow[],
  settings: null as SettingsRow | null,
  // When true, every read of bulk_jobs_settings throws — used to exercise the
  // sweep's defensive fallback path (corrupt / unreachable settings table).
  failOnSettingsRead: false,
};

vi.mock("drizzle-orm", () => {
  const eq =
    (col: ColRef, val: unknown): Pred =>
    (row) =>
      row[col.__col] === val;
  const inArray =
    (col: ColRef, vals: unknown[]): Pred =>
    (row) =>
      vals.includes(row[col.__col]);
  const and =
    (...preds: Pred[]): Pred =>
    (row) =>
      preds.every((p) => p(row));
  const or =
    (...preds: Pred[]): Pred =>
    (row) =>
      preds.some((p) => p(row));
  const desc = (col: ColRef): ColRef => col;

  // The real sweep uses `lt(sql\`coalesce(${finishedAt}, ${updatedAt})\`, cutoff)`.
  // We model `sql` by capturing the column refs interpolated into the template
  // and `lt` by reading the first non-null column from the captured list — the
  // same semantics as PG's coalesce.
  type CoalesceRef = { __coalesceCols: string[] };
  const sql = (_strings: TemplateStringsArray, ...values: unknown[]): CoalesceRef => ({
    __coalesceCols: values
      .filter(
        (v): v is ColRef =>
          typeof v === "object" && v !== null && "__col" in (v as object),
      )
      .map((v) => v.__col),
  });
  const lt =
    (key: ColRef | CoalesceRef, cutoff: Date): Pred =>
    (row) => {
      const cols = "__coalesceCols" in key ? key.__coalesceCols : [key.__col];
      for (const c of cols) {
        const v = row[c];
        if (v != null) return (v as Date).getTime() < cutoff.getTime();
      }
      return false;
    };

  return { eq, inArray, and, or, desc, sql, lt };
});

vi.mock("@workspace/db", () => {
  const bulkJobsTable = {
    __t: "bulk_jobs",
    id: { __col: "id" },
    status: { __col: "status" },
    finishedAt: { __col: "finishedAt" },
    updatedAt: { __col: "updatedAt" },
  };
  const bulkJobsSettingsTable = {
    __t: "bulk_jobs_settings",
    id: { __col: "id" },
    retentionDays: { __col: "retentionDays" },
    updatedAt: { __col: "updatedAt" },
  };

  function selectChain() {
    const ctx: { table: { __t: string } | null; where: Pred | null } = {
      table: null,
      where: null,
    };
    const exec = async (): Promise<AnyRow[]> => {
      if (!ctx.table) throw new Error("select() missing .from()");
      if (ctx.table.__t === "bulk_jobs_settings") {
        if (state.failOnSettingsRead) {
          throw new Error("simulated DB read failure");
        }
        const rows: AnyRow[] = state.settings
          ? [{ ...state.settings } as unknown as AnyRow]
          : [];
        return ctx.where ? rows.filter(ctx.where) : rows;
      }
      throw new Error(`select() not modelled for table ${ctx.table.__t}`);
    };
    const chain = {
      from(t: { __t: string }) {
        ctx.table = t;
        return chain;
      },
      where(p: Pred) {
        ctx.where = p;
        return chain;
      },
      then<T>(resolve: (v: AnyRow[]) => T, reject?: (e: unknown) => unknown) {
        return exec().then(resolve, reject);
      },
    };
    return chain;
  }

  const db = {
    select() {
      return selectChain();
    },
    insert(t: { __t: string }) {
      const ctx: { vals?: Record<string, unknown> } = {};
      const chain = {
        values(v: Record<string, unknown>) {
          ctx.vals = v;
          return chain;
        },
        // The real insert chains `.onConflictDoNothing()` before `.returning()`.
        onConflictDoNothing() {
          return chain;
        },
        async returning(): Promise<AnyRow[]> {
          if (t.__t !== "bulk_jobs_settings") return [];
          // Mirror PG ON CONFLICT DO NOTHING: if the singleton row already
          // exists, the insert returns nothing.
          if (state.settings) return [];
          const v = ctx.vals ?? {};
          state.settings = {
            id: (v["id"] as number | undefined) ?? 1,
            retentionDays: v["retentionDays"] as number,
            updatedAt: new Date(),
          };
          return [{ ...state.settings } as unknown as AnyRow];
        },
      };
      return chain;
    },
    update(t: { __t: string }) {
      const ctx: { vals?: Record<string, unknown>; where: Pred | null } = {
        where: null,
      };
      const exec = async (): Promise<AnyRow[]> => {
        if (t.__t !== "bulk_jobs_settings") return [];
        if (!state.settings) return [];
        if (ctx.where && !ctx.where(state.settings as unknown as AnyRow)) return [];
        Object.assign(state.settings, ctx.vals);
        return [{ ...state.settings } as unknown as AnyRow];
      };
      const chain = {
        set(v: Record<string, unknown>) {
          ctx.vals = v;
          return chain;
        },
        where(p: Pred) {
          ctx.where = p;
          return chain;
        },
        returning() {
          return exec();
        },
        then<T>(resolve: (v: undefined) => T, reject?: (e: unknown) => unknown) {
          return exec().then(() => resolve(undefined), reject);
        },
      };
      return chain;
    },
    delete(t: { __t: string }) {
      const ctx: { where: Pred | null } = { where: null };
      const exec = async (): Promise<AnyRow[]> => {
        if (t.__t !== "bulk_jobs") return [];
        const removed: JobRow[] = [];
        state.jobs = state.jobs.filter((row) => {
          if (!ctx.where || ctx.where(row as unknown as AnyRow)) {
            removed.push(row);
            return false;
          }
          return true;
        });
        return removed.map((r) => ({ id: r.id }));
      };
      const chain = {
        where(p: Pred) {
          ctx.where = p;
          return chain;
        },
        returning() {
          return exec();
        },
        then<T>(resolve: (v: undefined) => T, reject?: (e: unknown) => unknown) {
          return exec().then(() => resolve(undefined), reject);
        },
      };
      return chain;
    },
  };

  return {
    db,
    bulkJobsTable,
    bulkJobsSettingsTable,
    // bulk-jobs.ts re-imports these for unrelated code paths; stub the table
    // tags so the module loads even though we never exercise those paths here.
    candidatesTable: { __t: "candidates" },
    applicationsTable: { __t: "applications" },
  };
});

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./email-revalidation", () => ({
  revalidateCandidateEmail: vi.fn(),
}));

const { getBulkJobsSettings, updateBulkJobsSettings } = await import(
  "./bulk-jobs-settings"
);
const { sweepBulkJobRetention } = await import("./bulk-jobs");

function seedJob(
  id: number,
  status: string,
  finishedAt: Date | null,
  updatedAt: Date,
): void {
  state.jobs.push({ id, status, finishedAt, updatedAt });
}

beforeEach(() => {
  state.jobs = [];
  state.settings = null;
  state.failOnSettingsRead = false;
});

describe("getBulkJobsSettings / updateBulkJobsSettings", () => {
  it("seeds the singleton row with the 7-day default on first read", async () => {
    expect(state.settings).toBeNull();
    const row = await getBulkJobsSettings();
    expect(row.retentionDays).toBe(7);
    expect(state.settings?.id).toBe(1);
  });

  it("round-trips: a write via updateBulkJobsSettings is visible to the next read", async () => {
    const updated = await updateBulkJobsSettings({ retentionDays: 21 });
    expect(updated.retentionDays).toBe(21);
    const fresh = await getBulkJobsSettings();
    expect(fresh.retentionDays).toBe(21);
  });
});

describe("sweepBulkJobRetention reads retentionDays from the live setting", () => {
  it("uses the freshly-saved retentionDays on the very next sweep call", async () => {
    const now = new Date("2026-05-15T12:00:00Z");
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    seedJob(1, "completed", tenDaysAgo, tenDaysAgo);

    // First, widen retention to 30 days — the 10-day-old row must survive.
    await updateBulkJobsSettings({ retentionDays: 30 });
    const swept1 = await sweepBulkJobRetention(now);
    expect(swept1).toBe(0);
    expect(state.jobs).toHaveLength(1);

    // Then, tighten retention to 5 days — the same row must now be removed
    // by the next sweep without any restart.
    await updateBulkJobsSettings({ retentionDays: 5 });
    const swept2 = await sweepBulkJobRetention(now);
    expect(swept2).toBe(1);
    expect(state.jobs).toHaveLength(0);
  });

  it("never sweeps in-flight (pending / running) rows, regardless of age", async () => {
    const now = new Date("2026-05-15T12:00:00Z");
    const ancient = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    seedJob(1, "running", null, ancient);
    seedJob(2, "pending", null, ancient);
    seedJob(3, "completed", ancient, ancient);

    const swept = await sweepBulkJobRetention(now);
    expect(swept).toBe(1);
    expect(state.jobs.map((j) => j.id).sort()).toEqual([1, 2]);
  });
});

describe("sweepBulkJobRetention falls back to the 7-day default", () => {
  it("when the settings row is corrupt (retentionDays <= 0)", async () => {
    // Seed a corrupt row directly — bypassing updateBulkJobsSettings, which
    // would never persist a non-positive value through the API. This mirrors
    // the real-world failure mode the fallback is defending against.
    state.settings = { id: 1, retentionDays: 0, updatedAt: new Date() };
    const now = new Date("2026-05-15T12:00:00Z");
    // 10 days old → outside the 7-day default window → must be deleted.
    const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    // 3 days old → inside the 7-day default window → must survive.
    const recent = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    seedJob(1, "completed", old, old);
    seedJob(2, "completed", recent, recent);

    const swept = await sweepBulkJobRetention(now);
    expect(swept).toBe(1);
    expect(state.jobs.map((j) => j.id)).toEqual([2]);
  });

  it("when the settings table read throws (DB unreachable / row missing)", async () => {
    state.failOnSettingsRead = true;
    const now = new Date("2026-05-15T12:00:00Z");
    const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    seedJob(1, "completed", old, old);

    // The sweep must NOT bubble the read error up — it should log a warning
    // and fall back to the 7-day default so old rows still get cleaned up.
    const swept = await sweepBulkJobRetention(now);
    expect(swept).toBe(1);
    expect(state.jobs).toHaveLength(0);
  });
});
