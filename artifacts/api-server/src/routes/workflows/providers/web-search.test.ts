import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const extractCandidates = vi.fn();
vi.mock("../../../lib/extract-candidates", () => ({
  extractCandidates: (...args: unknown[]) => extractCandidates(...args),
}));

import { WebSearchSourcingProvider, type WebSearchPayload, type WebSearchStats } from "./web-search";
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

const payload: WebSearchPayload = {
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

describe("WebSearchSourcingProvider.run drop counts", () => {
  beforeEach(() => {
    extractCandidates.mockReset();
    process.env.SERPAPI_KEY = "test-key";
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("populates stats with extractedCount, droppedFabricated, droppedNoProfile, returnedCount", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        organic_results: [
          { title: "Alice — LinkedIn", link: "https://linkedin.com/in/alice", snippet: "TS engineer" },
          { title: "Bob — GitHub", link: "https://github.com/bob", snippet: "Node dev" },
          { title: "Carol", link: "https://carol.dev", snippet: "Full-stack" },
        ],
        search_information: { total_results: 1234 },
      }),
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
          // Missing name → should be dropped as no-profile
          name: "",
          headline: "h",
          profileUrl: "https://github.com/bob",
          currentCompany: null,
          location: null,
          evidence: "Node dev",
          sourceType: "github",
        },
      ],
      stats: {
        inputCount: 3,
        classifiedCount: 3,
        llmEmittedCount: 4,
        droppedFabricatedUrl: 1,
        droppedFabricatedEvidence: 1,
      },
    });

    const provider = new WebSearchSourcingProvider(1, "Web");
    const result = await provider.run(input);
    if (Array.isArray(result)) throw new Error("expected stats form");

    const stats = result.stats as WebSearchStats;
    expect(stats).toMatchObject({
      searchTotalCount: 1234,
      consideredCount: 3,
      extractedCount: 2,
      droppedNoProfile: 1,
      droppedFabricated: 2,
      returnedCount: 1,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.name).toBe("Alice");
  });

  it("returns zeroed stats when SerpAPI returns no organic results", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ organic_results: [], search_information: { total_results: 0 } }),
    ) as unknown as typeof fetch;

    const provider = new WebSearchSourcingProvider(2, "Web");
    const result = await provider.run(input);
    if (Array.isArray(result)) throw new Error("expected stats form");

    const stats = result.stats as WebSearchStats;
    expect(stats).toMatchObject({
      searchTotalCount: 0,
      consideredCount: 0,
      extractedCount: 0,
      droppedNoProfile: 0,
      droppedFabricated: 0,
      returnedCount: 0,
    });
    expect(extractCandidates).not.toHaveBeenCalled();
  });
});
