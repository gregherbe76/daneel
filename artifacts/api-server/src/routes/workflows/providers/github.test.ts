import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { GithubSourcingProvider, type SourcingPayload } from "./github";
import type { AgentProviderRunInput } from "./interface";

type FetchHandler = (url: string) => unknown;

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  const status = init?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => init?.headers?.[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installFetch(handler: FetchHandler) {
  const fn = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const result = handler(url);
    if (result instanceof Error) throw result;
    return result as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const basePayload: SourcingPayload = {
  job: {
    title: "Senior Engineer",
    location: "Berlin",
    seniority: "senior",
    mustHaveSkills: ["TypeScript"],
  },
  count: 4,
};

const baseInput: AgentProviderRunInput = {
  step: "sourcing",
  runId: 1,
  jobId: 1,
  payload: basePayload,
};

const ORIGINAL_FETCH = globalThis.fetch;

describe("GithubSourcingProvider.run drop counts", () => {
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("populates stats with droppedNoBio, droppedStale, droppedFetchError, returnedCount", async () => {
    const now = Date.now();
    const recentIso = new Date(now - 1000 * 60 * 60 * 24).toISOString(); // 1 day ago
    const staleIso = new Date(now - 1000 * 60 * 60 * 24 * 365).toISOString(); // ~1 year ago

    const users: Record<string, { bio: string | null; events?: string }> = {
      good: { bio: "Loves TypeScript", events: recentIso },
      nobio: { bio: "", events: recentIso },
      stale: { bio: "Has bio", events: staleIso },
      broken: { bio: "Has bio", events: recentIso },
    };

    installFetch((url) => {
      if (url.includes("/search/users")) {
        return jsonResponse({
          total_count: 42,
          items: Object.keys(users).map((login) => ({
            login,
            html_url: `https://github.com/${login}`,
          })),
        });
      }
      const userMatch = url.match(/\/users\/([^/?]+)(\/.*)?$/);
      if (!userMatch) return jsonResponse({}, { status: 404 });
      const login = decodeURIComponent(userMatch[1]);
      const sub = userMatch[2] ?? "";
      const u = users[login];
      if (!u) return jsonResponse({}, { status: 404 });

      if (login === "broken" && sub.startsWith("/repos")) {
        return jsonResponse({ message: "boom" }, { status: 500 });
      }
      if (sub.startsWith("/repos")) {
        return jsonResponse([
          { name: "proj", html_url: `https://github.com/${login}/proj`, stargazers_count: 5, language: "TypeScript", fork: false },
        ]);
      }
      if (sub.startsWith("/events/public")) {
        return jsonResponse([{ type: "PushEvent", created_at: u.events, payload: { commits: [] } }]);
      }
      // /users/<login>
      return jsonResponse({
        login,
        name: login,
        bio: u.bio,
        location: "Berlin",
        html_url: `https://github.com/${login}`,
        email: null,
      });
    });

    const provider = new GithubSourcingProvider(1, "GH", {
      requireBio: true,
      activeWithinMonths: 6,
    });

    const result = await provider.run(baseInput);
    if (Array.isArray(result)) throw new Error("expected stats form");

    expect(result.stats).toMatchObject({
      searchTotalCount: 42,
      consideredCount: 4,
      extractedCount: 4,
      droppedNoBio: 1,
      droppedStale: 1,
      droppedFetchError: 1,
      droppedFabricated: 0,
      returnedCount: 1,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.username).toBe("good");
  });

  it("does not enforce bio/activity filters when config is empty", async () => {
    installFetch((url) => {
      if (url.includes("/search/users")) {
        return jsonResponse({
          total_count: 2,
          items: [
            { login: "alice", html_url: "https://github.com/alice" },
            { login: "bob", html_url: "https://github.com/bob" },
          ],
        });
      }
      const userMatch = url.match(/\/users\/([^/?]+)(\/.*)?$/);
      if (!userMatch) return jsonResponse({}, { status: 404 });
      const login = decodeURIComponent(userMatch[1]);
      const sub = userMatch[2] ?? "";
      if (sub.startsWith("/repos")) return jsonResponse([]);
      if (sub.startsWith("/events/public")) return jsonResponse([]);
      return jsonResponse({
        login,
        name: login,
        bio: "",
        location: "",
        html_url: `https://github.com/${login}`,
        email: `${login}@example.com`,
      });
    });

    const provider = new GithubSourcingProvider(2, "GH");
    const result = await provider.run({ ...baseInput, payload: { ...basePayload, count: 2 } });
    if (Array.isArray(result)) throw new Error("expected stats form");

    expect(result.stats).toMatchObject({
      droppedNoBio: 0,
      droppedStale: 0,
      droppedFetchError: 0,
      returnedCount: 2,
      consideredCount: 2,
    });
  });
});
