import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db,
  agentProvidersTable,
  workflowProviderSettingsTable,
} from "@workspace/db";
import {
  consumeScoutState,
  issueScoutState,
  _ageScoutState,
  _resetScoutStateStore,
} from "./scout-state-store";
import scoutRouter, {
  SCOUT_PROVIDER_NAME,
  exchangeScoutToken,
  persistScoutProvider,
  _setScoutFetchForTest,
} from "./integrations-scout";
import {
  decryptProviderSecret,
  isEncryptedProviderSecret,
} from "../lib/provider-secrets";

const app = express();
app.use(express.json());
app.use("/api", scoutRouter);

async function call(
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: any; text: string; contentType: string }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("no address"));
        return;
      }
      const init: RequestInit = { method };
      if (body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(body);
      }
      fetch(`http://127.0.0.1:${address.port}${url}`, init)
        .then(async (res) => {
          const text = await res.text();
          let json: any = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          server.close();
          resolve({
            status: res.status,
            body: json,
            text,
            contentType: res.headers.get("content-type") ?? "",
          });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

async function cleanupScoutProvider(): Promise<void> {
  const rows = await db
    .select()
    .from(agentProvidersTable)
    .where(eq(agentProvidersTable.name, SCOUT_PROVIDER_NAME));
  for (const row of rows) {
    await db
      .delete(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.providerId, row.id));
    await db.delete(agentProvidersTable).where(eq(agentProvidersTable.id, row.id));
  }
  await db
    .delete(workflowProviderSettingsTable)
    .where(eq(workflowProviderSettingsTable.workflowStep, "sourcing"));
}

beforeEach(async () => {
  await _resetScoutStateStore();
});

afterEach(async () => {
  await _resetScoutStateStore();
  _setScoutFetchForTest(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupScoutProvider();
});

describe("scout state store", () => {
  it("issues unique tokens", async () => {
    const a = await issueScoutState();
    const b = await issueScoutState();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("consumes a fresh state once and rejects replays", async () => {
    const s = await issueScoutState();
    expect(await consumeScoutState(s)).toEqual({ ok: true });
    expect(await consumeScoutState(s)).toEqual({
      ok: false,
      reason: "replayed",
    });
  });

  it("rejects unknown states as missing", async () => {
    expect(await consumeScoutState("not-a-real-state")).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("rejects expired states", async () => {
    const s = await issueScoutState();
    expect(await _ageScoutState(s, 11 * 60 * 1000)).toBe(true);
    expect(await consumeScoutState(s)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("survives an API server restart mid-flow (fresh module instance can still consume the state)", async () => {
    const s = await issueScoutState();
    // Simulate a process restart by dropping the cached module and re-importing.
    // With the previous in-memory Map this would have lost the state and the
    // reload's consume call would have returned `missing`.
    vi.resetModules();
    const fresh = await import("./scout-state-store");
    expect(await fresh.consumeScoutState(s)).toEqual({ ok: true });
    // And replay protection still works against the re-imported module too.
    expect(await fresh.consumeScoutState(s)).toEqual({
      ok: false,
      reason: "replayed",
    });
  });
});

describe("POST /api/integrations/scout/state", () => {
  it("returns a state, callback URL, and a Scout connect URL", async () => {
    const res = await call("POST", "/api/integrations/scout/state");
    expect(res.status).toBe(200);
    expect(res.body.state).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.callbackUrl).toMatch(
      /^https?:\/\/[^/]+\/api\/integrations\/scout\/callback$/,
    );
    expect(res.body.connectUrl).toMatch(/\/connect\?return_to=/);
    expect(res.body.connectUrl).toContain(`state=${res.body.state}`);
    expect(res.body.connectUrl).toContain(
      encodeURIComponent(res.body.callbackUrl),
    );
  });

  it("uses SCOUT_CONNECT_BASE_URL override when present", async () => {
    vi.stubEnv("SCOUT_CONNECT_BASE_URL", "https://staging.scout.example.com");
    const res = await call("POST", "/api/integrations/scout/state");
    expect(res.status).toBe(200);
    expect(res.body.connectUrl).toMatch(
      /^https:\/\/staging\.scout\.example\.com\/connect\?/,
    );
  });
});

describe("GET /api/integrations/scout/callback", () => {
  it("happy path: exchanges the token and stores the provider", async () => {
    const state = await issueScoutState();
    _setScoutFetchForTest(async () =>
      new Response(
        JSON.stringify({
          apiKey: "scout-secret-key",
          baseUrl: "https://twin.scout.aplayer.ai",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const res = await call(
      "GET",
      `/api/integrations/scout/callback?token=tok123&state=${state}`,
    );
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.text).toContain("Connected");

    const [row] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.name, SCOUT_PROVIDER_NAME));
    expect(row?.type).toBe("twin_webhook");
    expect(row?.baseUrl).toBe("https://twin.scout.aplayer.ai");
    expect(row?.apiKeyEncryptedPlaceholder).toBeTruthy();
    expect(isEncryptedProviderSecret(row!.apiKeyEncryptedPlaceholder!)).toBe(true);
    expect(decryptProviderSecret(row!.apiKeyEncryptedPlaceholder!)).toBe(
      "scout-secret-key",
    );
    expect(row?.enabled).toBe(true);
  });

  it("rejects a missing token / state with 400 and an HTML error page", async () => {
    const res = await call("GET", "/api/integrations/scout/callback");
    expect(res.status).toBe(400);
    expect(res.contentType).toContain("text/html");
    expect(res.text).toContain("Connection failed");
  });

  it("rejects a forged state (never issued)", async () => {
    const res = await call(
      "GET",
      "/api/integrations/scout/callback?token=tok&state=deadbeef",
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain("missing");
  });

  it("rejects a replayed state", async () => {
    const state = await issueScoutState();
    expect(await consumeScoutState(state)).toEqual({ ok: true }); // first use
    const res = await call(
      "GET",
      `/api/integrations/scout/callback?token=tok&state=${state}`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain("replayed");
  });

  it("rejects an expired state", async () => {
    const state = await issueScoutState();
    await _ageScoutState(state, 11 * 60 * 1000);
    const res = await call(
      "GET",
      `/api/integrations/scout/callback?token=tok&state=${state}`,
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain("expired");
  });

  it("propagates Scout-side error in the query string", async () => {
    const res = await call(
      "GET",
      "/api/integrations/scout/callback?error=user_denied",
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain("user_denied");
  });

  it("retires the state on an error redirect so it cannot be reused", async () => {
    const state = await issueScoutState();
    const errRes = await call(
      "GET",
      `/api/integrations/scout/callback?error=user_denied&state=${state}`,
    );
    expect(errRes.status).toBe(400);
    // A second attempt with the same state must now be rejected as replayed.
    expect(await consumeScoutState(state)).toEqual({
      ok: false,
      reason: "replayed",
    });
  });

  it("returns 502 when the exchange endpoint fails", async () => {
    const state = await issueScoutState();
    _setScoutFetchForTest(async () => new Response("nope", { status: 500 }));
    const res = await call(
      "GET",
      `/api/integrations/scout/callback?token=bad&state=${state}`,
    );
    expect(res.status).toBe(502);
    expect(res.text).toContain("Connection failed");
    const rows = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.name, SCOUT_PROVIDER_NAME));
    expect(rows).toHaveLength(0);
  });

  it("returns 502 when the exchange response is malformed", async () => {
    const state = await issueScoutState();
    _setScoutFetchForTest(
      async () =>
        new Response(JSON.stringify({ apiKey: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const res = await call(
      "GET",
      `/api/integrations/scout/callback?token=tok&state=${state}`,
    );
    expect(res.status).toBe(502);
    expect(res.text).toContain("malformed");
  });
});

describe("exchangeScoutToken", () => {
  it("posts the token to /api/connect/exchange and returns parsed credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const mock: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          apiKey: "k",
          baseUrl: "https://twin.example.com",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await exchangeScoutToken("the-token", mock);
    expect(result).toEqual({
      apiKey: "k",
      baseUrl: "https://twin.example.com",
    });
    expect(calls[0]?.url).toMatch(/\/api\/connect\/exchange$/);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ token: "the-token" }));
  });
});

describe("DELETE /api/integrations/scout/connection", () => {
  it("returns { removed: false } when no Scout provider exists", async () => {
    const result = await call("DELETE", "/api/integrations/scout/connection");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ removed: false });
  });

  it("clears sourcing assignment then deletes the provider row", async () => {
    // Connect Scout (this also auto-assigns sourcing because no setting exists).
    const { providerId, assignedSourcing } = await persistScoutProvider(
      "https://twin.example.com",
      "k",
    );
    expect(assignedSourcing).toBe(true);
    // Sanity: a naive provider delete would fail because of the FK restrict.
    const res = await call("DELETE", "/api/integrations/scout/connection");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: true });
    const remaining = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, providerId));
    expect(remaining).toHaveLength(0);
    const settings = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.providerId, providerId));
    expect(settings).toHaveLength(0);
  });
});

describe("persistScoutProvider auto-assigns sourcing", () => {
  it("auto-assigns sourcing when no setting exists", async () => {
    const result = await persistScoutProvider("https://twin.example.com", "k");
    expect(result.assignedSourcing).toBe(true);
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "sourcing"));
    expect(setting?.providerId).toBe(result.providerId);
  });

  it("does NOT touch sourcing when a setting already exists", async () => {
    // Seed a different sourcing assignment first.
    const [other] = await db
      .insert(agentProvidersTable)
      .values({
        name: "scout.test:other-sourcing",
        type: "github",
        enabled: true,
      })
      .returning();
    try {
      await db.insert(workflowProviderSettingsTable).values({
        workflowStep: "sourcing",
        providerId: other!.id,
        enabled: true,
      });
      const result = await persistScoutProvider(
        "https://twin.example.com",
        "k",
      );
      expect(result.assignedSourcing).toBe(false);
      const [setting] = await db
        .select()
        .from(workflowProviderSettingsTable)
        .where(eq(workflowProviderSettingsTable.workflowStep, "sourcing"));
      expect(setting?.providerId).toBe(other!.id);
    } finally {
      await db
        .delete(workflowProviderSettingsTable)
        .where(eq(workflowProviderSettingsTable.providerId, other!.id));
      await db
        .delete(agentProvidersTable)
        .where(eq(agentProvidersTable.id, other!.id));
    }
  });

  it("upserts in place when the Scout provider already exists", async () => {
    const first = await persistScoutProvider("https://old.example.com", "old");
    const second = await persistScoutProvider("https://new.example.com", "new");
    expect(second.providerId).toBe(first.providerId);
    const [row] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, second.providerId));
    expect(row?.baseUrl).toBe("https://new.example.com");
    expect(isEncryptedProviderSecret(row!.apiKeyEncryptedPlaceholder!)).toBe(true);
    expect(decryptProviderSecret(row!.apiKeyEncryptedPlaceholder!)).toBe("new");
  });
});
