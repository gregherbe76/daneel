import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TwinAgentBrowserProvider, TwinQuotaExceededError } from "./twin-agent";
import type { AgentProviderRunInput } from "./interface";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  } as unknown as Response;
}

function sseResponse(chunks: string[]): Response {
  let i = 0;
  const reader = {
    async read() {
      if (i >= chunks.length) return { done: true, value: undefined };
      const enc = new TextEncoder().encode(chunks[i++]);
      return { done: false, value: enc };
    },
  };
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

const ORIGINAL_FETCH = globalThis.fetch;

const candidate = {
  name: "Ada Lovelace",
  headline: "Founding Engineer",
  location: "London",
  currentCompany: "Babbage Co",
  email: null,
  linkedinUrl: "https://linkedin.com/in/ada",
  githubUrl: "",
  username: null,
  confidence: 0.9,
  emailSource: null,
  skills: ["Math"],
  summary: "Pioneer.",
  evidence: "Public profile.",
  potentialRisks: "",
  source: "Whatever Twin Said",
};

const baseInput: AgentProviderRunInput = {
  step: "sourcing",
  runId: 7,
  jobId: 13,
  payload: {
    job: {
      title: "Founding Engineer",
      description: "...",
      location: "London",
      seniority: "senior",
      mustHaveSkills: ["TypeScript"],
    },
    count: 5,
  },
};

describe("TwinAgentBrowserProvider", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns sync candidates and re-tags them with source='Twin Agent Browser'", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ candidates: [candidate], stats: { returnedCount: 1 } }),
    );
    const p = new TwinAgentBrowserProvider(1, "Twin", "tk_live", null);
    const out = await p.run(baseInput);
    if (Array.isArray(out)) throw new Error("expected stats wrapper");
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].source).toBe("Twin Agent Browser");
    expect(out.candidates[0].name).toBe("Ada Lovelace");
  });

  it("throws TwinQuotaExceededError on HTTP 402, parsing upgradeUrl from body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({ upgradeUrl: "https://twin.aplayer.ai/billing" }),
    } as unknown as Response);
    const p = new TwinAgentBrowserProvider(1, "Twin", "tk_live", null);
    let caught: unknown;
    try {
      await p.run(baseInput);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TwinQuotaExceededError);
    const e = caught as TwinQuotaExceededError;
    expect(e.code).toBe("QUOTA_EXCEEDED");
    expect(e.upgradeUrl).toBe("https://twin.aplayer.ai/billing");
  });

  it("refuses to run without an API key", async () => {
    const p = new TwinAgentBrowserProvider(1, "Twin", undefined, null);
    await expect(p.run(baseInput)).rejects.toThrow(/API key is not set/);
  });

  it("rejects non-sourcing steps", async () => {
    const p = new TwinAgentBrowserProvider(1, "Twin", "k", null);
    await expect(
      p.run({ ...baseInput, step: "candidate_matching" }),
    ).rejects.toThrow(/only supports the "sourcing" step/);
  });

  it("consumes an SSE stream and merges candidate + stats frames", async () => {
    const chunks = [
      `event: candidate\ndata: ${JSON.stringify(candidate)}\n\n`,
      `event: candidate\ndata: ${JSON.stringify({ ...candidate, name: "Grace Hopper" })}\n\n`,
      `event: stats\ndata: ${JSON.stringify({ returnedCount: 2, consideredCount: 12 })}\n\n`,
      `event: done\ndata: {"ok":true}\n\n`,
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sseResponse(chunks));
    const p = new TwinAgentBrowserProvider(1, "Twin", "k", { streaming: true });
    const out = await p.run(baseInput);
    if (Array.isArray(out)) throw new Error("expected stats wrapper");
    expect(out.candidates.map((c) => c.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(out.candidates.every((c) => c.source === "Twin Agent Browser")).toBe(true);
    expect(out.stats?.returnedCount).toBe(2);
  });

  it("uses the configured baseUrl override when set", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const p = new TwinAgentBrowserProvider(1, "Twin", "k", { baseUrl: "https://staging.twin.test/" });
    await p.run(baseInput);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://staging.twin.test/api/sourcing/run",
      expect.any(Object),
    );
  });

  it("validateConnection returns ok with plan/quota suffix on success", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ plan: "pro", email: "ada@example.com", quotaRemaining: 42 }),
    );
    const p = new TwinAgentBrowserProvider(1, "Twin", "k", null);
    const r = await p.validateConnection();
    expect(r.ok).toBe(true);
    expect(r.error).toContain("pro");
    expect(r.error).toContain("42 runs remaining");
  });

  it("validateConnection returns ok=false with explicit message on 401", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response);
    const p = new TwinAgentBrowserProvider(1, "Twin", "bad", null);
    const r = await p.validateConnection();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid Twin API key/);
  });
});
