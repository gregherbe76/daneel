import { describe, expect, it, beforeEach, vi } from "vitest";

type AnyRow = Record<string, unknown>;
type Pred = (row: AnyRow) => boolean;
type ColRef = { __col: string };
type OrderRef = { __col: string; __order: "asc" | "desc" };

interface BulkJobRow {
  id: number;
  action: string;
  ids: number[];
  payload: Record<string, unknown> | null;
  total: number;
  processed: number;
  skipped: number;
  status: string;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface CandidateRow {
  id: number;
  name: string;
  email: string | null;
  headline: string | null;
  location: string | null;
  currentCompany: string | null;
  source: string | null;
  emailValidationStatus: string | null;
  emailSource: string | null;
  linkedIn: string | null;
  githubUrl: string | null;
}

interface ApplicationRow {
  id: number;
  jobId: number;
  candidateId: number;
  stage: string;
  updatedAt: Date;
}

const state = {
  jobs: new Map<number, BulkJobRow>(),
  nextJobId: 1,
  candidates: new Map<number, CandidateRow>(),
  applications: new Map<number, ApplicationRow>(),
  nextAppId: 1,
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
  const desc = (col: ColRef): OrderRef => ({ __col: col.__col, __order: "desc" });
  return { eq, inArray, and, or, desc };
});

vi.mock("@workspace/db", () => {
  const bulkJobsTable = {
    __t: "bulk_jobs",
    id: { __col: "id" },
    status: { __col: "status" },
    createdAt: { __col: "createdAt" },
  };
  const candidatesTable = {
    __t: "candidates",
    id: { __col: "id" },
  };
  const applicationsTable = {
    __t: "applications",
    id: { __col: "id" },
    jobId: { __col: "jobId" },
    candidateId: { __col: "candidateId" },
  };

  function getStore(t: { __t: string }): Map<number, AnyRow> {
    if (t.__t === "bulk_jobs") return state.jobs as unknown as Map<number, AnyRow>;
    if (t.__t === "candidates") return state.candidates as unknown as Map<number, AnyRow>;
    if (t.__t === "applications") return state.applications as unknown as Map<number, AnyRow>;
    throw new Error(`unknown table ${t.__t}`);
  }

  function project(rows: AnyRow[], cols?: Record<string, ColRef>): AnyRow[] {
    if (!cols) return rows;
    return rows.map((r) => {
      const out: AnyRow = {};
      for (const [k, v] of Object.entries(cols)) out[k] = r[v.__col];
      return out;
    });
  }

  function selectChain(cols?: Record<string, ColRef>) {
    const ctx: {
      table: { __t: string } | null;
      where: Pred | null;
      order: OrderRef | ColRef | null;
      limit: number | null;
    } = { table: null, where: null, order: null, limit: null };

    const exec = async (): Promise<AnyRow[]> => {
      if (!ctx.table) throw new Error("select() missing .from()");
      let rows = Array.from(getStore(ctx.table).values()).map((r) => ({ ...r }));
      if (ctx.where) rows = rows.filter(ctx.where);
      if (ctx.order) {
        const k = ctx.order.__col;
        const dir = (ctx.order as OrderRef).__order ?? "asc";
        rows.sort((a, b) => {
          const av = a[k] as number | string | Date;
          const bv = b[k] as number | string | Date;
          if (av < bv) return dir === "asc" ? -1 : 1;
          if (av > bv) return dir === "asc" ? 1 : -1;
          return 0;
        });
      }
      if (ctx.limit != null) rows = rows.slice(0, ctx.limit);
      return project(rows, cols);
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
      orderBy(o: OrderRef | ColRef) {
        ctx.order = o;
        return chain;
      },
      limit(n: number) {
        ctx.limit = n;
        return chain;
      },
      then<T>(resolve: (v: AnyRow[]) => T, reject?: (e: unknown) => unknown) {
        return exec().then(resolve, reject);
      },
    };
    return chain;
  }

  const db = {
    insert(t: { __t: string }) {
      const ctx: { vals?: Record<string, unknown> } = {};
      const chain = {
        values(v: Record<string, unknown>) {
          ctx.vals = v;
          return chain;
        },
        async returning(): Promise<AnyRow[]> {
          if (t.__t !== "bulk_jobs") return [];
          const id = state.nextJobId++;
          const now = new Date();
          const v = ctx.vals ?? {};
          const row: BulkJobRow = {
            id,
            action: v["action"] as string,
            ids: v["ids"] as number[],
            payload: (v["payload"] as Record<string, unknown> | null) ?? null,
            total: v["total"] as number,
            processed: 0,
            skipped: 0,
            status: (v["status"] as string) ?? "pending",
            result: null,
            errorMessage: null,
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            finishedAt: null,
          };
          state.jobs.set(id, row);
          return [row];
        },
      };
      return chain;
    },
    select(cols?: Record<string, ColRef>) {
      return selectChain(cols);
    },
    update(t: { __t: string }) {
      const ctx: { vals?: Record<string, unknown>; where: Pred | null } = {
        where: null,
      };
      const exec = async (): Promise<AnyRow[]> => {
        const matched: AnyRow[] = [];
        for (const row of getStore(t).values()) {
          if (!ctx.where || ctx.where(row)) {
            Object.assign(row, ctx.vals);
            matched.push(row);
          }
        }
        return matched;
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
        returning(cols?: Record<string, ColRef>) {
          return exec().then((rows) => project(rows, cols));
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
        const removed: AnyRow[] = [];
        for (const [id, row] of Array.from(getStore(t).entries())) {
          if (!ctx.where || ctx.where(row)) {
            getStore(t).delete(id);
            removed.push(row);
          }
        }
        return removed;
      };
      const chain = {
        where(p: Pred) {
          ctx.where = p;
          return chain;
        },
        returning(cols?: Record<string, ColRef>) {
          return exec().then((rows) => project(rows, cols));
        },
        then<T>(resolve: (v: undefined) => T, reject?: (e: unknown) => unknown) {
          return exec().then(() => resolve(undefined), reject);
        },
      };
      return chain;
    },
  };

  return { db, bulkJobsTable, candidatesTable, applicationsTable };
});

const revalidateMock = vi.fn();
vi.mock("./email-revalidation", () => ({
  revalidateCandidateEmail: (id: number) => revalidateMock(id),
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  enqueueBulkJob,
  getBulkJob,
  listActiveBulkJobs,
  startBulkJobsWorker,
  stopBulkJobsWorker,
  __testInternals,
} = await import("./bulk-jobs");

function seedCandidate(c: Partial<CandidateRow> & { id: number; name: string }) {
  const row: CandidateRow = {
    id: c.id,
    name: c.name,
    email: c.email ?? null,
    headline: c.headline ?? null,
    location: c.location ?? null,
    currentCompany: c.currentCompany ?? null,
    source: c.source ?? null,
    emailValidationStatus: c.emailValidationStatus ?? null,
    emailSource: c.emailSource ?? null,
    linkedIn: c.linkedIn ?? null,
    githubUrl: c.githubUrl ?? null,
  };
  state.candidates.set(row.id, row);
  return row;
}

function seedApplication(jobId: number, candidateId: number, stage = "Sourced") {
  const id = state.nextAppId++;
  const row: ApplicationRow = {
    id,
    jobId,
    candidateId,
    stage,
    updatedAt: new Date(0),
  };
  state.applications.set(id, row);
  return row;
}

beforeEach(() => {
  state.jobs.clear();
  state.candidates.clear();
  state.applications.clear();
  state.nextJobId = 1;
  state.nextAppId = 1;
  revalidateMock.mockReset();
  __testInternals.resetWorkerState();
});

describe("enqueueBulkJob", () => {
  it("dedupes ids, persists pending status, and caches total", async () => {
    const job = await enqueueBulkJob({
      action: "delete",
      ids: [1, 2, 2, 3, 1],
      payload: null,
    });
    // Stop the worker the enqueue scheduled before its timer fires so it
    // doesn't try to drain the (legitimate) job in the background mid-test.
    stopBulkJobsWorker();

    expect(job.status).toBe("pending");
    expect(job.total).toBe(3);
    expect(job.ids).toEqual([1, 2, 3]);
    expect(job.processed).toBe(0);
    expect(job.skipped).toBe(0);

    const fetched = await getBulkJob(job.id);
    expect(fetched?.id).toBe(job.id);
    expect(fetched?.action).toBe("delete");
  });

  it("listActiveBulkJobs returns pending and running but not completed jobs", async () => {
    const a = await enqueueBulkJob({ action: "delete", ids: [1] });
    const b = await enqueueBulkJob({ action: "delete", ids: [2] });
    const c = await enqueueBulkJob({ action: "delete", ids: [3] });
    stopBulkJobsWorker();

    state.jobs.get(b.id)!.status = "running";
    state.jobs.get(c.id)!.status = "completed";

    const active = await listActiveBulkJobs();
    const ids = active.map((j) => j.id).sort();
    expect(ids).toEqual([a.id, b.id]);
  });
});

describe("processChunk", () => {
  function makeJob(overrides: Partial<BulkJobRow> & { action: string; ids: number[] }): BulkJobRow {
    return {
      id: 999,
      action: overrides.action,
      ids: overrides.ids,
      payload: overrides.payload ?? null,
      total: overrides.ids.length,
      processed: 0,
      skipped: 0,
      status: "running",
      result: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: new Date(),
      finishedAt: null,
    };
  }

  it("delete: removes existing candidates and counts missing ids as skipped", async () => {
    seedCandidate({ id: 1, name: "Ada" });
    seedCandidate({ id: 3, name: "Grace" });
    // id 2 is intentionally absent so we can verify it counts as skipped.

    const job = makeJob({ action: "delete", ids: [1, 2, 3] });
    const result = await __testInternals.processChunk(job, [1, 2, 3]);

    expect(result.processedDelta).toBe(2);
    expect(result.skippedDelta).toBe(1);
    expect(state.candidates.has(1)).toBe(false);
    expect(state.candidates.has(3)).toBe(false);
  });

  it("move-stage: updates only candidates with an application for that job", async () => {
    seedCandidate({ id: 1, name: "Ada" });
    seedCandidate({ id: 2, name: "Grace" });
    seedCandidate({ id: 3, name: "Linus" });
    seedApplication(10, 1, "Sourced");
    seedApplication(10, 2, "Sourced");
    // Candidate 3 has an application for a DIFFERENT job — must not be moved.
    seedApplication(99, 3, "Sourced");

    const job = makeJob({
      action: "move-stage",
      ids: [1, 2, 3],
      payload: { jobId: 10, stage: "Interview" },
    });
    const result = await __testInternals.processChunk(job, [1, 2, 3]);

    expect(result.processedDelta).toBe(2);
    expect(result.skippedDelta).toBe(1);
    const stages = Array.from(state.applications.values())
      .filter((a) => a.jobId === 10)
      .map((a) => a.stage);
    expect(stages).toEqual(["Interview", "Interview"]);
    // Other-job application is untouched.
    expect(
      Array.from(state.applications.values()).find((a) => a.jobId === 99)?.stage,
    ).toBe("Sourced");
  });

  it("move-stage: throws when payload is missing required fields", async () => {
    const job = makeJob({ action: "move-stage", ids: [1], payload: { jobId: 10 } });
    await expect(__testInternals.processChunk(job, [1])).rejects.toThrow(
      /payload\.jobId and payload\.stage/,
    );
  });

  it("export-csv: returns CSV lines preserving the requested chunk order", async () => {
    seedCandidate({
      id: 2,
      name: "Grace, Hopper",
      email: "grace@example.com",
      linkedIn: "https://linkedin.com/in/grace",
    });
    seedCandidate({
      id: 1,
      name: 'Ada "the founder"',
      email: null,
      githubUrl: "https://github.com/ada",
    });
    // id 3 is missing; should be skipped without producing a line.

    const job = makeJob({ action: "export-csv", ids: [1, 2, 3] });
    const result = await __testInternals.processChunk(job, [1, 2, 3]);

    expect(result.processedDelta).toBe(2);
    expect(result.skippedDelta).toBe(1);
    expect(result.csvLines).toHaveLength(2);
    // Order matches the chunk order, not insertion order.
    expect(result.csvLines![0]).toContain('"Ada ""the founder"""');
    expect(result.csvLines![0]).toContain("https://github.com/ada");
    expect(result.csvLines![1]).toContain('"Grace, Hopper"');
    expect(result.csvLines![1]).toContain("grace@example.com");
  });

  it("recheck-email: classifies valid / skipped / error per id and orders results", async () => {
    revalidateMock.mockImplementation(async (id: number) => {
      if (id === 1)
        return { id, email: "a@x.com", emailValidationStatus: "valid", emailValidationReason: null };
      if (id === 2) return null; // candidate not found
      if (id === 3)
        return { id, email: null, emailValidationStatus: null, emailValidationReason: null };
      if (id === 4) throw new Error("dns blew up");
      return null;
    });

    const job = makeJob({ action: "recheck-email", ids: [1, 2, 3, 4] });
    const result = await __testInternals.processChunk(job, [1, 2, 3, 4]);

    expect(result.recheckResults).toBeDefined();
    const byId = new Map(result.recheckResults!.map((r) => [r.id, r]));
    expect(byId.get(1)!.status).toBe("valid");
    expect(byId.get(2)!.status).toBe("skipped");
    expect(byId.get(2)!.reason).toBe("candidate not found");
    expect(byId.get(3)!.status).toBe("skipped");
    expect(byId.get(3)!.reason).toBe("no email on file");
    expect(byId.get(4)!.status).toBe("error");
    expect(byId.get(4)!.reason).toContain("dns blew up");
    // Result list is sorted to match the chunk order (so the persisted
    // per-id table renders the same way the recruiter selected them).
    expect(result.recheckResults!.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    // Only the "valid" outcome counts as processed; the rest are skipped.
    expect(result.processedDelta).toBe(1);
    expect(result.skippedDelta).toBe(3);
  });
});

describe("runJob", () => {
  it("completes a delete job end-to-end and stamps finishedAt", async () => {
    seedCandidate({ id: 1, name: "Ada" });
    seedCandidate({ id: 2, name: "Grace" });
    const enq = await enqueueBulkJob({ action: "delete", ids: [1, 2] });
    stopBulkJobsWorker();
    __testInternals.resetWorkerState();

    await __testInternals.runJob(state.jobs.get(enq.id)!);

    const final = await getBulkJob(enq.id);
    expect(final?.status).toBe("completed");
    expect(final?.processed).toBe(2);
    expect(final?.skipped).toBe(0);
    expect(final?.finishedAt).toBeInstanceOf(Date);
    expect(final?.errorMessage).toBeNull();
    expect(state.candidates.size).toBe(0);
  });

  it("export-csv: assembles header + per-chunk CSV rows in result.csv", async () => {
    seedCandidate({ id: 1, name: "Ada", email: "ada@x.com" });
    seedCandidate({ id: 2, name: "Grace", email: "grace@x.com" });
    const enq = await enqueueBulkJob({ action: "export-csv", ids: [1, 2] });
    stopBulkJobsWorker();
    __testInternals.resetWorkerState();

    await __testInternals.runJob(state.jobs.get(enq.id)!);

    const final = await getBulkJob(enq.id);
    expect(final?.status).toBe("completed");
    const csv = (final?.result as { csv: string }).csv;
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "name,email,headline,location,currentCompany,source,emailValidationStatus,emailSource,profileUrl",
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Ada");
    expect(lines[2]).toContain("Grace");
  });

  it("recheck-email: persists per-id results in result.results", async () => {
    revalidateMock.mockResolvedValue({
      id: 1,
      email: "a@x.com",
      emailValidationStatus: "valid",
      emailValidationReason: null,
    });
    seedCandidate({ id: 1, name: "Ada", email: "a@x.com" });
    const enq = await enqueueBulkJob({ action: "recheck-email", ids: [1] });
    stopBulkJobsWorker();
    __testInternals.resetWorkerState();

    await __testInternals.runJob(state.jobs.get(enq.id)!);

    const final = await getBulkJob(enq.id);
    expect(final?.status).toBe("completed");
    const results = (final?.result as { results: { id: number; status: string }[] }).results;
    expect(results).toEqual([{ id: 1, status: "valid", reason: null }]);
  });

  it("resumes export-csv from the prior `processed` offset and prepends the saved CSV", async () => {
    // Simulate a job that processed 1 of 2 ids before a restart and persisted
    // its partial CSV to result.csv. After restart, runJob should pick up at
    // offset 1 and produce a CSV that contains BOTH the prior line and the
    // new one, without re-emitting the header.
    seedCandidate({ id: 1, name: "Ada", email: "ada@x.com" });
    seedCandidate({ id: 2, name: "Grace", email: "grace@x.com" });
    const enq = await enqueueBulkJob({ action: "export-csv", ids: [1, 2] });
    stopBulkJobsWorker();
    __testInternals.resetWorkerState();

    const row = state.jobs.get(enq.id)!;
    row.processed = 1;
    row.skipped = 0;
    row.status = "running";
    const priorCsv = "name,email,headline,location,currentCompany,source,emailValidationStatus,emailSource,profileUrl\nAda,ada@x.com,,,,,,,";
    row.result = { csv: priorCsv };

    await __testInternals.runJob(row);

    const final = await getBulkJob(enq.id);
    expect(final?.status).toBe("completed");
    expect(final?.processed).toBe(2);
    const csv = (final?.result as { csv: string }).csv;
    // The header from the prior run is preserved (not duplicated), and the
    // resumed chunk appended the second candidate.
    expect(csv.split("\n").filter((l) => l.startsWith("name,email"))).toHaveLength(1);
    expect(csv).toContain("Ada,ada@x.com");
    expect(csv).toContain("Grace,grace@x.com");
  });

  it("marks the job failed and records errorMessage when a chunk throws", async () => {
    // move-stage with no payload throws inside processChunk.
    const enq = await enqueueBulkJob({ action: "move-stage", ids: [1] });
    stopBulkJobsWorker();
    __testInternals.resetWorkerState();

    await __testInternals.runJob(state.jobs.get(enq.id)!);

    const final = await getBulkJob(enq.id);
    expect(final?.status).toBe("failed");
    expect(final?.errorMessage).toMatch(/payload\.jobId and payload\.stage/);
    expect(final?.finishedAt).toBeInstanceOf(Date);
  });
});

describe("startBulkJobsWorker boot-time requeue", () => {
  it("flips any rows left in `running` back to `pending` so they get re-picked", async () => {
    // Simulate a row that was mid-flight when the previous process died.
    const now = new Date();
    state.jobs.set(42, {
      id: 42,
      action: "delete",
      ids: [1, 2, 3],
      payload: null,
      total: 3,
      processed: 1,
      skipped: 0,
      status: "running",
      result: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: null,
    });
    state.nextJobId = 43;

    await startBulkJobsWorker();
    // Stop immediately so the in-process tick doesn't try to actually drain
    // the job — we're only asserting the requeue side effect of startup.
    stopBulkJobsWorker();

    const row = state.jobs.get(42)!;
    expect(row.status).toBe("pending");
    // Progress counters are preserved so the resume path still picks up from
    // the right offset.
    expect(row.processed).toBe(1);
  });
});
