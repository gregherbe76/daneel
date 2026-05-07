import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtendSourcingProvider } from "./extend";
import type { AgentProviderRunInput } from "./interface";
import type { SourcingCandidate } from "./native-openai-sourcing";

type ResultObj = { candidates: SourcingCandidate[]; stats: Record<string, unknown> };
const asObj = (r: unknown): ResultObj => r as ResultObj;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ORIGINAL_FETCH = globalThis.fetch;

function makeInput(
  exampleProfileUrls: string[] = ["https://linkedin.com/in/torvalds"],
): AgentProviderRunInput {
  return {
    step: "sourcing",
    runId: 7,
    jobId: 1,
    payload: {
      job: {
        title: "Senior Backend Engineer",
        description: "Distributed systems, Postgres, Go.",
        location: "Remote",
        seniority: "Senior",
        mustHaveSkills: ["Go", "Postgres"],
        exampleProfileUrls,
      },
    },
  } as unknown as AgentProviderRunInput;
}

/**
 * Build an ExtendSourcingProvider with no-op sleep + a controllable clock.
 * `nowSequence` returns successive values from `nowValues` so polling-loop
 * tests can simulate elapsed time without real timers.
 */
function makeProvider(opts?: {
  apiKey?: string;
  baseUrl?: string;
  nowValues?: number[];
}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const nowValues = opts?.nowValues ?? [];
  let i = 0;
  const now = vi.fn(() => {
    if (i < nowValues.length) return nowValues[i++]!;
    return nowValues.length > 0 ? nowValues[nowValues.length - 1]! : 0;
  });
  const provider = new ExtendSourcingProvider(
    99,
    "Extend",
    opts?.apiKey ?? "ex_sk_test",
    { baseUrl: opts?.baseUrl ?? null },
    { sleep, now },
  );
  return { provider, sleep, now };
}

describe("ExtendSourcingProvider.run", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("short-circuits with 'no_profile_urls' when exampleProfileUrls is empty (no fetch)", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { provider } = makeProvider();

    const result = asObj(await provider.run(makeInput([])));

    expect(result.candidates).toEqual([]);
    expect((result.stats as Record<string, unknown>).extend_error).toBe("no_profile_urls");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'auth_failed' when no API key is set, without calling fetch", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { provider } = makeProvider({ apiKey: "" });

    const result = asObj(await provider.run(makeInput()));

    expect(result.candidates).toEqual([]);
    expect((result.stats as Record<string, unknown>).extend_error).toBe("auth_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls until 'completed' and maps Extend candidates to SourcingCandidate", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      // POST /find-similar → 202 with analysis_id
      .mockResolvedValueOnce(jsonResponse({ analysis_id: "ax_123" }, 202))
      // 1st poll → still running
      .mockResolvedValueOnce(jsonResponse({ status: "running" }, 200))
      // 2nd poll → completed with two candidates
      .mockResolvedValueOnce(
        jsonResponse(
          {
            status: "completed",
            total_found: 2,
            below_minimum: false,
            pattern: { title: "Distributed-systems engineer" },
            candidates: [
              {
                name: "Jane Doe",
                linkedinUrl: "https://linkedin.com/in/janedoe",
                score: 8.5,
                scoreReason: "Strong Postgres + Go background",
              },
              {
                name: "John Roe",
                linkedinUrl: "https://linkedin.com/in/johnroe",
                score: 6,
                scoreReason: ["Go senior", "Distributed systems lead"],
              },
              { name: "", linkedinUrl: "" }, // dropped: missing fields
            ],
          },
          200,
        ),
      );

    const { provider, sleep } = makeProvider({ nowValues: [0, 1000, 2000, 3000, 4000] });
    const result = asObj(await provider.run(makeInput()));

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      name: "Jane Doe",
      linkedinUrl: "https://linkedin.com/in/janedoe",
      confidence: 0.85,
      summary: "Strong Postgres + Go background",
      source: "Extend pattern-match",
    });
    expect(result.candidates[1]?.summary).toBe("Go senior\nDistributed systems lead");
    expect((result.stats as Record<string, unknown>).extend_analysis_id).toBe("ax_123");
    expect((result.stats as Record<string, unknown>).extend_pattern_title).toBe(
      "Distributed-systems engineer",
    );
    expect((result.stats as Record<string, unknown>).extend_total_found).toBe(2);
    // 1 initial sleep + 2 inter-poll sleeps after running responses
    expect(sleep).toHaveBeenCalled();
  });

  it("surfaces 'pipeline_failed' when poll returns status: failed", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ analysis_id: "ax_999" }, 202))
      .mockResolvedValueOnce(
        jsonResponse({ status: "failed", error: "LinkedIn cookie expired" }, 200),
      );

    const { provider } = makeProvider({ nowValues: [0, 1000, 2000] });
    const result = asObj(await provider.run(makeInput()));

    expect(result.candidates).toEqual([]);
    expect((result.stats as Record<string, unknown>).extend_error).toBe("pipeline_failed");
    expect((result.stats as Record<string, unknown>).extend_analysis_id).toBe("ax_999");
  });

  it("returns 'extend_timeout' when total polling exceeds 12 min budget", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ analysis_id: "ax_slow" }, 202))
      // every poll returns "running"; clock will trip the 12-min budget
      .mockResolvedValue(jsonResponse({ status: "running" }, 200));

    // Successive `now()` jumps the clock past 12 * 60 * 1000 = 720_000ms.
    const { provider } = makeProvider({
      nowValues: [0, 100, 200, 300, 800_000, 800_000],
    });

    const result = asObj(await provider.run(makeInput()));

    expect(result.candidates).toEqual([]);
    expect((result.stats as Record<string, unknown>).extend_error).toBe("extend_timeout");
    expect((result.stats as Record<string, unknown>).extend_analysis_id).toBe("ax_slow");
  });

  it("maps POST /find-similar HTTP 401 to 'auth_failed' (no polling)", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "invalid key" }, 401));

    const { provider } = makeProvider();
    const result = asObj(await provider.run(makeInput()));

    expect(result.candidates).toEqual([]);
    expect((result.stats as Record<string, unknown>).extend_error).toBe("auth_failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps POST /find-similar HTTP 402 to 'premium_required'", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "premium" }, 402));

    const { provider } = makeProvider();
    const result = asObj(await provider.run(makeInput()));

    expect((result.stats as Record<string, unknown>).extend_error).toBe("premium_required");
  });

  it("sends Authorization: Bearer <key>, JSON body, and User-Agent header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ analysis_id: "ax_smoke" }, 202))
      .mockResolvedValueOnce(
        jsonResponse({ status: "completed", candidates: [] }, 200),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { provider } = makeProvider({ nowValues: [0, 1000, 2000] });
    await provider.run(makeInput());

    const [postUrl, postInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(postUrl).toBe("https://pattern.aplayer.ai/api/v1/find-similar");
    expect(postInit.method).toBe("POST");
    const headers = postInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer ex_sk_test");
    expect(headers["User-Agent"]).toContain("Daneel/");
    const body = JSON.parse(postInit.body as string);
    expect(body.profile_urls).toEqual(["https://linkedin.com/in/torvalds"]);
    expect(body.search_location).toBe("Remote");
  });

  it("respects baseUrl override and strips trailing slashes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ analysis_id: "ax_x" }, 202))
      .mockResolvedValueOnce(
        jsonResponse({ status: "completed", candidates: [] }, 200),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { provider } = makeProvider({
      baseUrl: "https://staging.extend.example/v1/",
      nowValues: [0, 1000, 2000],
    });
    await provider.run(makeInput());

    const [postUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(postUrl).toBe("https://staging.extend.example/v1/find-similar");
    const [pollUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(pollUrl).toBe("https://staging.extend.example/v1/find-similar/ax_x");
  });
});

describe("ExtendSourcingProvider.validateConnection", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns ok:false when no API key is set", async () => {
    const { provider } = makeProvider({ apiKey: "" });
    const result = await provider.validateConnection();
    expect(result.ok).toBe(false);
  });

  it("returns ok:true when GET /me responds 200", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ email: "user@example.com" }, 200),
    );
    const { provider } = makeProvider();
    const result = await provider.validateConnection();
    expect(result.ok).toBe(true);
  });

  it("treats 401/403 as invalid key", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 403));
    const { provider: p1 } = makeProvider();
    const { provider: p2 } = makeProvider();
    const r401 = await p1.validateConnection();
    const r403 = await p2.validateConnection();
    expect(r401.ok).toBe(false);
    expect(r401.error).toMatch(/Invalid/i);
    expect(r403.ok).toBe(false);
  });

  it("treats 402 as premium required", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({}, 402),
    );
    const { provider } = makeProvider();
    const result = await provider.validateConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Premium/i);
  });

  it("returns timeout error on AbortError", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const { provider } = makeProvider();
    const result = await provider.validateConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });
});
