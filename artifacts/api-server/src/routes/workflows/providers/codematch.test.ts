import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeMatchProvider } from "./codematch";
import type { EvaluateInput } from "./evaluation-interface";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const ORIGINAL_FETCH = globalThis.fetch;

const baseInput: EvaluateInput = {
  candidate: {
    id: 42,
    name: "Linus Torvalds",
    githubUsername: "torvalds",
    githubUrl: "https://github.com/torvalds",
  },
  jobId: 1,
  runId: 7,
};

function makeProvider() {
  return new CodeMatchProvider(99, "CodeMatch", "cm_sk_test", { baseUrl: null });
}

describe("CodeMatchProvider.evaluate", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns evaluated:true with parsed scores on a 200 response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        scores: {
          technical_depth: 88,
          ownership: 92,
          consistency: 81,
          taste: 85,
          impact: 95,
          overall: 89,
        },
        strengths: ["Kernel maintainer", "Long-term consistency"],
        red_flags: [],
        summary: "Top 0.1% systems engineer.",
        report_url: "https://assess.codes/r/abc",
      }),
    );

    const result = await makeProvider().evaluate(baseInput);

    expect(result.evaluated).toBe(true);
    expect(result.error).toBeNull();
    expect(result.scores).toEqual({
      technical_depth: 88,
      ownership: 92,
      consistency: 81,
      taste: 85,
      impact: 95,
      overall: 89,
    });
    expect(result.strengths).toEqual(["Kernel maintainer", "Long-term consistency"]);
    expect(result.report_url).toBe("https://assess.codes/r/abc");
    expect(result.provider_type).toBe("codematch");
  });

  it("maps HTTP 402 to error code 'premium_required' without throwing", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ detail: "premium required" }, 402),
    );

    const result = await makeProvider().evaluate(baseInput);

    expect(result.evaluated).toBe(false);
    expect(result.error).toBe("premium_required");
    expect(result.scores).toBeNull();
    expect(result.strengths).toEqual([]);
    expect(result.summary).toContain("Premium");
  });

  it("maps HTTP 404 to 'github_user_not_found' and 429 to 'rate_limited'", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({}, 429));

    const r404 = await makeProvider().evaluate(baseInput);
    const r429 = await makeProvider().evaluate(baseInput);

    expect(r404.evaluated).toBe(false);
    expect(r404.error).toBe("github_user_not_found");
    expect(r429.evaluated).toBe(false);
    expect(r429.error).toBe("rate_limited");
  });

  it("short-circuits with 'no_github_username' when the candidate has no username (no fetch)", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const result = await makeProvider().evaluate({
      ...baseInput,
      candidate: { ...baseInput.candidate, githubUsername: null },
    });

    expect(result.evaluated).toBe(false);
    expect(result.error).toBe("no_github_username");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'auth_failed' when no API key is set, without calling fetch", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const provider = new CodeMatchProvider(1, "CodeMatch", undefined, null);

    const result = await provider.evaluate(baseInput);

    expect(result.evaluated).toBe(false);
    expect(result.error).toBe("auth_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'invalid_response' when 200 body has malformed scores", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        scores: { technical_depth: "high" /* not a number */ },
        strengths: ["x"],
        red_flags: [],
      }),
    );

    const result = await makeProvider().evaluate(baseInput);

    expect(result.evaluated).toBe(false);
    expect(result.error).toBe("invalid_response");
  });

  it("sends Authorization: Bearer <key>, JSON body, and User-Agent header", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        scores: {
          technical_depth: 50,
          ownership: 50,
          consistency: 50,
          taste: 50,
          impact: 50,
          overall: 50,
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await makeProvider().evaluate(baseInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://assess.codes/api/v1/evaluate");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer cm_sk_test");
    expect(headers["User-Agent"]).toContain("Daneel/");
    expect(JSON.parse(init.body as string)).toEqual({ github_username: "torvalds" });
  });

  it("maps HTTP 401/403 to 'auth_failed'", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 403));

    const r401 = await makeProvider().evaluate(baseInput);
    const r403 = await makeProvider().evaluate(baseInput);

    expect(r401.evaluated).toBe(false);
    expect(r401.error).toBe("auth_failed");
    expect(r403.evaluated).toBe(false);
    expect(r403.error).toBe("auth_failed");
  });

  it("returns 'timeout' when fetch is aborted (AbortError)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const result = await makeProvider().evaluate(baseInput);

    expect(result.evaluated).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("returns 'network_error' on a generic fetch rejection (not abort)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("fetch failed: ECONNRESET"),
    );

    const result = await makeProvider().evaluate(baseInput);

    expect(result.evaluated).toBe(false);
    expect(result.error).toBe("network_error");
  });

  it("respects baseUrl override and strips trailing slashes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 500));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const provider = new CodeMatchProvider(1, "CodeMatch", "k", {
      baseUrl: "https://staging.assess.codes/v2/",
    });

    await provider.evaluate(baseInput);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://staging.assess.codes/v2/evaluate");
  });
});

describe("CodeMatchProvider.validateConnection", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns ok:false with no API key", async () => {
    const provider = new CodeMatchProvider(1, "CodeMatch", undefined, null);
    const result = await provider.validateConnection();
    expect(result.ok).toBe(false);
  });

  it("treats 401/403 as invalid key", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({}, 401));
    const result = await makeProvider().validateConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid/i);
  });

  it("treats 200 / 402 / 404 / 429 all as 'reachable + auth ok'", async () => {
    for (const status of [200, 402, 404, 429]) {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        jsonResponse({}, status),
      );
      const result = await makeProvider().validateConnection();
      expect(result.ok).toBe(true);
    }
  });
});
