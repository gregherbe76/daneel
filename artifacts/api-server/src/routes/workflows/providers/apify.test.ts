import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const extractCandidates = vi.fn();
vi.mock("../../../lib/extract-candidates", () => ({
  extractCandidates: (...args: unknown[]) => extractCandidates(...args),
}));

import { ApifySourcingProvider, type ApifyPayload, type ApifyStats } from "./apify";
import type { AgentProviderRunInput } from "./interface";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_TOKEN = process.env.APIFY_TOKEN;

const payload: ApifyPayload = {
  job: {
    title: "Senior Engineer",
    location: "Berlin",
    seniority: "senior",
    mustHaveSkills: ["TypeScript"],
  },
};

const input: AgentProviderRunInput = {
  step: "sourcing",
  runId: 1,
  jobId: 1,
  payload,
};

describe("ApifySourcingProvider.buildQuery", () => {
  it("composes role + skills + location + default site filter", () => {
    const provider = new ApifySourcingProvider(1, "Apify", "tok");
    const query = provider.buildQuery(payload);
    expect(query).toContain('"Senior Engineer"');
    expect(query).toContain("senior");
    expect(query).toContain("TypeScript");
    expect(query).toContain("Berlin");
    expect(query).toContain("(site:linkedin.com/in OR site:github.com)");
  });

  it("respects custom targetSites and excludeSites", () => {
    const provider = new ApifySourcingProvider(1, "Apify", "tok", {
      targetSites: ["linkedin.com/in"],
      excludeSites: ["pinterest.com"],
    });
    const query = provider.buildQuery(payload);
    expect(query).toContain("site:linkedin.com/in");
    expect(query).not.toContain("site:github.com");
    expect(query).toContain("-site:pinterest.com");
  });

  it("uses the configured actor id and falls back to the default", () => {
    const def = new ApifySourcingProvider(1, "Apify", "tok");
    expect(def.actorId).toBe("apify/google-search-scraper");
    const custom = new ApifySourcingProvider(1, "Apify", "tok", {
      actorId: "user/some-actor",
    });
    expect(custom.actorId).toBe("user/some-actor");
  });
});

describe("ApifySourcingProvider.run", () => {
  beforeEach(() => {
    extractCandidates.mockReset();
    delete process.env.APIFY_TOKEN;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.APIFY_TOKEN;
    } else {
      process.env.APIFY_TOKEN = ORIGINAL_TOKEN;
    }
  });

  it("throws when no token is configured", async () => {
    const provider = new ApifySourcingProvider(1, "Apify");
    await expect(provider.run(input)).rejects.toThrow(/Apify token is not configured/);
  });

  it("flattens organicResults from dataset items, normalizes via extractCandidates, and tags Apify", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        {
          searchQuery: { term: "Senior Engineer TypeScript" },
          organicResults: [
            { title: "Alice — LinkedIn", url: "https://linkedin.com/in/alice", description: "TS engineer" },
            { title: "Bob — GitHub", url: "https://github.com/bob", description: "Node dev" },
          ],
        },
      ]),
    ) as unknown as typeof fetch;

    extractCandidates.mockResolvedValue({
      candidates: [
        {
          name: "Alice",
          headline: "Engineer",
          profileUrl: "https://linkedin.com/in/alice",
          currentCompany: null,
          location: null,
          evidence: "TS engineer",
          sourceType: "linkedin",
        },
        {
          name: "Bob",
          headline: "Dev",
          profileUrl: "https://github.com/bob",
          currentCompany: null,
          location: null,
          evidence: "Node dev",
          sourceType: "github",
        },
      ],
      stats: {
        classifiedCount: 2,
        droppedFabricatedUrl: 0,
        droppedFabricatedEvidence: 0,
      },
    });

    const provider = new ApifySourcingProvider(1, "Apify", "tok");
    const result = await provider.run(input);

    const data = Array.isArray(result) ? { candidates: result, stats: undefined } : result;
    expect(data.candidates).toHaveLength(2);
    const alice = data.candidates[0];
    expect(alice.source).toBe("Apify");
    expect(alice.linkedinUrl).toBe("https://linkedin.com/in/alice");
    expect(alice.email).toBeNull();
    const bob = data.candidates[1];
    expect(bob.githubUrl).toBe("https://github.com/bob");
    expect(bob.username).toBe("bob");

    const stats = data.stats as ApifyStats;
    expect(stats.extractedCount).toBe(2);
    expect(stats.returnedCount).toBe(2);
    expect(stats.droppedNoProfile).toBe(0);
    expect(stats.droppedFabricated).toBe(0);
  });

  it("accepts flat dataset items (one row per result)", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        { title: "Alice", url: "https://linkedin.com/in/alice", description: "TS" },
        { title: "Bob", url: "https://github.com/bob", description: "Node" },
      ]),
    ) as unknown as typeof fetch;
    extractCandidates.mockResolvedValue({
      candidates: [],
      stats: { classifiedCount: 2, droppedFabricatedUrl: 0, droppedFabricatedEvidence: 0 },
    });

    const provider = new ApifySourcingProvider(1, "Apify", "tok");
    await provider.run(input);

    const callArg = extractCandidates.mock.calls[0]?.[0] as { results: unknown[] };
    expect(callArg.results).toHaveLength(2);
  });

  it("counts candidates dropped for missing name/profileUrl", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse([
        {
          organicResults: [
            { title: "Alice", url: "https://linkedin.com/in/alice", description: "TS" },
          ],
        },
      ]),
    ) as unknown as typeof fetch;
    extractCandidates.mockResolvedValue({
      candidates: [
        {
          name: "",
          headline: "h",
          profileUrl: "https://linkedin.com/in/alice",
          currentCompany: null,
          location: null,
          evidence: "TS",
          sourceType: "linkedin",
        },
      ],
      stats: { classifiedCount: 1, droppedFabricatedUrl: 0, droppedFabricatedEvidence: 0 },
    });

    const provider = new ApifySourcingProvider(1, "Apify", "tok");
    const result = await provider.run(input);
    const data = Array.isArray(result) ? { candidates: result, stats: undefined } : result;
    const stats = data.stats as ApifyStats;
    expect(data.candidates).toHaveLength(0);
    expect(stats.droppedNoProfile).toBe(1);
    expect(stats.returnedCount).toBe(0);
  });

  it("returns an empty result with zeroed stats when the actor returns no rows", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    const provider = new ApifySourcingProvider(1, "Apify", "tok");
    const result = await provider.run(input);
    const data = Array.isArray(result) ? { candidates: result, stats: undefined } : result;
    const stats = data.stats as ApifyStats;
    expect(data.candidates).toHaveLength(0);
    expect(stats.extractedCount).toBe(0);
    expect(stats.returnedCount).toBe(0);
    expect(extractCandidates).not.toHaveBeenCalled();
  });

  it("env APIFY_TOKEN takes precedence over the persisted key", async () => {
    process.env.APIFY_TOKEN = "env-token";
    const fetchMock = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const provider = new ApifySourcingProvider(1, "Apify", "row-token");
    await provider.run(input);
    const init = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0][1];
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe("Bearer env-token");
  });

  it("throws a clear error when the actor returns a non-array payload", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ foo: "bar" })) as unknown as typeof fetch;
    const provider = new ApifySourcingProvider(1, "Apify", "tok");
    await expect(provider.run(input)).rejects.toThrow(/non-array dataset payload/);
  });
});

describe("ApifySourcingProvider.validateConnection", () => {
  beforeEach(() => {
    delete process.env.APIFY_TOKEN;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.APIFY_TOKEN;
    } else {
      process.env.APIFY_TOKEN = ORIGINAL_TOKEN;
    }
  });

  it("returns ok=false when no token is set", async () => {
    const provider = new ApifySourcingProvider(1, "Apify");
    const res = await provider.validateConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not set/);
  });

  it("returns ok=true on a successful /users/me lookup", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ data: { username: "tester", plan: { description: "FREE" } } }),
    ) as unknown as typeof fetch;
    const provider = new ApifySourcingProvider(1, "Apify", "tok");
    const res = await provider.validateConnection();
    expect(res.ok).toBe(true);
    expect(res.error).toMatch(/tester/);
    expect(res.error).toMatch(/FREE/);
  });

  it("returns ok=false on HTTP failure", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ error: { message: "bad token" } }, 401),
    ) as unknown as typeof fetch;
    const provider = new ApifySourcingProvider(1, "Apify", "tok");
    const res = await provider.validateConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Apify HTTP 401/);
  });
});
