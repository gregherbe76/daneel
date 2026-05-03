import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, jobsTable } from "@workspace/db";

// Mock the registry helper so this test file is hermetic and does not race
// with other tests (registry.test.ts) that mutate the singleton
// workflow_provider_settings row in parallel.
vi.mock("./workflows/providers/registry", () => ({
  hasRealSourcingProvider: vi.fn(),
}));

import jobsRouter from "./jobs";
import { hasRealSourcingProvider } from "./workflows/providers/registry";

const mockedHasRealSourcing = vi.mocked(hasRealSourcingProvider);

const app = express();
app.use(express.json());
app.use("/api", jobsRouter);

const TEST_MARKER = "jobs.test:";
const seededJobIds: number[] = [];

beforeEach(() => {
  mockedHasRealSourcing.mockReset();
});

afterEach(async () => {
  if (seededJobIds.length > 0) {
    await db.delete(jobsTable).where(inArray(jobsTable.id, seededJobIds));
    seededJobIds.length = 0;
  }
});

async function call(method: "GET", url: string) {
  return await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("no address"));
        return;
      }
      fetch(`http://127.0.0.1:${address.port}${url}`, { method })
        .then(async (res) => {
          const text = await res.text();
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

async function seedJob(name: string) {
  const [job] = await db
    .insert(jobsTable)
    .values({
      title: `${TEST_MARKER}${name}`,
      description: "d",
      location: "l",
      seniority: "Mid",
      mustHaveSkills: [],
    })
    .returning();
  seededJobIds.push(job!.id);
  return job!;
}

describe("GET /jobs includes hasRealSourcingProvider", () => {
  it("is false on every row when no real sourcing provider is configured", async () => {
    mockedHasRealSourcing.mockResolvedValue(false);
    const seeded = await seedJob("list-no-provider");

    const res = await call("GET", "/api/jobs");
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ id: number; hasRealSourcingProvider: boolean }>;
    const row = rows.find((r) => r.id === seeded.id);
    expect(row).toBeDefined();
    expect(row!.hasRealSourcingProvider).toBe(false);
    // Field must always be present on every row, not just the seeded one.
    for (const r of rows) {
      expect(typeof r.hasRealSourcingProvider).toBe("boolean");
      expect(r.hasRealSourcingProvider).toBe(false);
    }
    // No N+1: the helper is resolved once for the whole list response.
    expect(mockedHasRealSourcing).toHaveBeenCalledTimes(1);
  });

  it("is true on every row when a real sourcing provider is available", async () => {
    mockedHasRealSourcing.mockResolvedValue(true);
    const seeded = await seedJob("list-with-provider");

    const res = await call("GET", "/api/jobs");
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ id: number; hasRealSourcingProvider: boolean }>;
    const row = rows.find((r) => r.id === seeded.id);
    expect(row).toBeDefined();
    expect(row!.hasRealSourcingProvider).toBe(true);
    for (const r of rows) {
      expect(r.hasRealSourcingProvider).toBe(true);
    }
    expect(mockedHasRealSourcing).toHaveBeenCalledTimes(1);
  });
});
