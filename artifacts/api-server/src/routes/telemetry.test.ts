import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import request from "supertest";
import app from "../app";

const ALLOWED_EVENTS = [
  "workflow_started",
  "workflow_completed",
  "provider_card_viewed",
  "provider_connect_clicked",
  "provider_connected",
] as const;

const ENV_KEYS = [
  "POSTHOG_PERSONAL_API_KEY",
  "POSTHOG_PROJECT_ID",
  "POSTHOG_HOST",
] as const;

const originalEnv: Record<string, string | undefined> = {};
let originalFetch: typeof fetch;

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originalEnv[k];
    }
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("GET /api/telemetry/dashboard", () => {
  it("returns configured:false with empty events for every allow-listed event when env vars are missing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await request(app).get("/api/telemetry/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.range).toBe("7d");
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events).toHaveLength(ALLOWED_EVENTS.length);

    for (const event of ALLOWED_EVENTS) {
      const stats = res.body.events.find(
        (e: { event: string }) => e.event === event,
      );
      expect(stats).toBeDefined();
      expect(stats.total).toBe(0);
      expect(stats.daily).toEqual([]);
    }
    // No upstream call should ever be issued without credentials.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns shaped daily/total data when PostHog responds, and only queries the five allow-listed events", async () => {
    process.env["POSTHOG_PERSONAL_API_KEY"] = "phk_test";
    process.env["POSTHOG_PROJECT_ID"] = "12345";
    process.env["POSTHOG_HOST"] = "https://eu.posthog.example";

    const eventRows: Array<[string, string, number]> = [
      ["workflow_started", "2026-05-01", 3],
      ["workflow_started", "2026-05-02", 5],
      ["workflow_completed", "2026-05-02", 4],
      ["provider_card_viewed", "2026-05-03", 7],
      ["provider_connect_clicked", "2026-05-03", 2],
      ["provider_connected", "2026-05-04", 1],
      // A non-allow-listed event leaking back from PostHog must be dropped.
      ["secret_event_we_did_not_ask_for", "2026-05-04", 99],
    ];
    // Distinct-values query returns a single row of two arrays.
    const distinctRows = [[["native-openai", "github"], ["sourcing", "candidate_matching"]]];

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const q: string = body.query.query;
      if (q.includes("groupUniqArray")) {
        return jsonResponse({ results: distinctRows });
      }
      return jsonResponse({ results: eventRows });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await request(app)
      .get("/api/telemetry/dashboard")
      .query({ range: "30d" });

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.range).toBe("30d");

    // Exactly the five allow-listed events come back, in the expected order,
    // and no additional events leaked through.
    const returnedEvents = res.body.events.map(
      (e: { event: string }) => e.event,
    );
    expect(returnedEvents).toEqual([...ALLOWED_EVENTS]);

    const byEvent: Record<
      string,
      { total: number; daily: { date: string; count: number }[] }
    > = Object.fromEntries(
      res.body.events.map(
        (e: {
          event: string;
          total: number;
          daily: { date: string; count: number }[];
        }) => [e.event, { total: e.total, daily: e.daily }],
      ),
    );
    expect(byEvent["workflow_started"].total).toBe(8);
    expect(byEvent["workflow_started"].daily).toEqual([
      { date: "2026-05-01", count: 3 },
      { date: "2026-05-02", count: 5 },
    ]);
    expect(byEvent["workflow_completed"].total).toBe(4);
    expect(byEvent["provider_card_viewed"].total).toBe(7);
    expect(byEvent["provider_connect_clicked"].total).toBe(2);
    expect(byEvent["provider_connected"].total).toBe(1);

    // The lib issues two parallel HogQL calls (event aggregation +
    // distinct-filter discovery). Both must be allow-list-scoped.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of (fetchMock as Mock).mock.calls) {
      const [url, init] = call as unknown as [string, RequestInit];
      expect(url).toBe(
        "https://eu.posthog.example/api/projects/12345/query/",
      );
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer phk_test",
      );
      const body = JSON.parse(String(init.body));
      expect(body.query.kind).toBe("HogQLQuery");
      const hogql: string = body.query.query;
      // 30d window is propagated to every issued query.
      expect(hogql).toContain("INTERVAL 30 DAY");
      // Every issued query restricts to exactly the allow-listed events.
      for (const event of ALLOWED_EVENTS) {
        expect(hogql).toContain(`'${event}'`);
      }
      // No event name outside the allow-list may appear in any query.
      expect(hogql).not.toMatch(/secret_event_we_did_not_ask_for/);
      expect(hogql).not.toMatch(/'candidate_created'/);
    }
  });

  it("falls back to a 7-day window when range is missing or invalid", async () => {
    process.env["POSTHOG_PERSONAL_API_KEY"] = "phk_test";
    process.env["POSTHOG_PROJECT_ID"] = "12345";

    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await request(app)
      .get("/api/telemetry/dashboard")
      .query({ range: "bogus" });

    expect(res.status).toBe(200);
    expect(res.body.range).toBe("7d");
    // Every issued HogQL must use the 7-day window.
    expect((fetchMock as Mock).mock.calls.length).toBeGreaterThan(0);
    for (const call of (fetchMock as Mock).mock.calls) {
      const [, init] = call as unknown as [string, RequestInit];
      const hogql: string = JSON.parse(String(init.body)).query.query;
      expect(hogql).toContain("INTERVAL 7 DAY");
    }
  });

  it("returns 502 with an error message when the PostHog upstream fails", async () => {
    process.env["POSTHOG_PERSONAL_API_KEY"] = "phk_test";
    process.env["POSTHOG_PROJECT_ID"] = "12345";

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "upstream blew up",
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await request(app).get("/api/telemetry/dashboard");

    expect(res.status).toBe(502);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toMatch(/PostHog query failed/i);
    expect(res.body.error).toMatch(/503/);
  });
});
