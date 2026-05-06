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
  _resetScoutStateStore,
} from "./scout-state-store";
import enrichRouter, {
  ENRICH_PROVIDER_NAME,
  exchangeEnrichToken,
  persistEnrichProvider,
  _setEnrichFetchForTest,
} from "./integrations-enrich";
import {
  decryptProviderSecret,
  isEncryptedProviderSecret,
} from "../lib/provider-secrets";

const app = express();
app.use(express.json());
app.use("/api", enrichRouter);

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

async function cleanupEnrichProvider(): Promise<void> {
  const rows = await db
    .select()
    .from(agentProvidersTable)
    .where(eq(agentProvidersTable.name, ENRICH_PROVIDER_NAME));
  for (const row of rows) {
    await db
      .delete(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.providerId, row.id));
    await db.delete(agentProvidersTable).where(eq(agentProvidersTable.id, row.id));
  }
  await db
    .delete(workflowProviderSettingsTable)
    .where(eq(workflowProviderSettingsTable.workflowStep, "enrichment"));
}

beforeEach(async () => {
  await _resetScoutStateStore();
  await cleanupEnrichProvider();
});

afterEach(async () => {
  await _resetScoutStateStore();
  _setEnrichFetchForTest(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await cleanupEnrichProvider();
});

describe("POST /api/integrations/enrich/state", () => {
  it("returns a state, callback URL, and an Enrich connect URL", async () => {
    const res = await call("POST", "/api/integrations/enrich/state");
    expect(res.status).toBe(200);
    expect(res.body.state).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.callbackUrl).toMatch(
      /^https?:\/\/[^/]+\/api\/integrations\/enrich\/callback$/,
    );
    expect(res.body.connectUrl).toMatch(/\/connect\?return_to=/);
    expect(res.body.connectUrl).toContain(`state=${res.body.state}`);
    expect(res.body.connectUrl).toContain(
      encodeURIComponent(res.body.callbackUrl),
    );
  });

  it("uses ENRICH_CONNECT_BASE_URL override when present", async () => {
    vi.stubEnv("ENRICH_CONNECT_BASE_URL", "https://staging.enrich.example.com");
    const res = await call("POST", "/api/integrations/enrich/state");
    expect(res.status).toBe(200);
    expect(res.body.connectUrl).toMatch(
      /^https:\/\/staging\.enrich\.example\.com\/connect\?/,
    );
  });

  it("captures autoAssignSteps=false and skips auto-assignment in the callback", async () => {
    const issued = await call("POST", "/api/integrations/enrich/state", {
      autoAssignSteps: false,
    });
    expect(issued.status).toBe(200);
    const state = issued.body.state as string;

    _setEnrichFetchForTest(async () =>
      new Response(
        JSON.stringify({
          apiKey: "k",
          baseUrl: "https://enrich.example.com",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const cb = await call(
      "GET",
      `/api/integrations/enrich/callback?token=tok&state=${state}`,
    );
    expect(cb.status).toBe(200);
    const settings = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "enrichment"));
    expect(settings).toHaveLength(0);
    expect(cb.text).toMatch(/"assignedSteps":\s*\[\]/);
  });

  it("auto-assigns by default and surfaces assignedSteps in the callback HTML", async () => {
    const issued = await call("POST", "/api/integrations/enrich/state");
    const state = issued.body.state as string;

    _setEnrichFetchForTest(async () =>
      new Response(
        JSON.stringify({
          apiKey: "k",
          baseUrl: "https://enrich.example.com",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const cb = await call(
      "GET",
      `/api/integrations/enrich/callback?token=tok&state=${state}`,
    );
    expect(cb.status).toBe(200);
    expect(cb.text).toContain('"assignedSteps":["enrichment"]');
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "enrichment"));
    expect(setting).toBeDefined();
  });
});

describe("GET /api/integrations/enrich/callback", () => {
  it("happy path: exchanges the token and stores the provider", async () => {
    const state = await issueScoutState();
    _setEnrichFetchForTest(async () =>
      new Response(
        JSON.stringify({
          apiKey: "enrich-secret-key",
          baseUrl: "https://twin.enrich.aplayer.ai",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const res = await call(
      "GET",
      `/api/integrations/enrich/callback?token=tok123&state=${state}`,
    );
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.text).toContain("Connected");

    const [row] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.name, ENRICH_PROVIDER_NAME));
    expect(row?.type).toBe("twin_webhook");
    expect(row?.baseUrl).toBe("https://twin.enrich.aplayer.ai");
    expect(isEncryptedProviderSecret(row!.apiKeyEncryptedPlaceholder!)).toBe(true);
    expect(decryptProviderSecret(row!.apiKeyEncryptedPlaceholder!)).toBe(
      "enrich-secret-key",
    );
    expect(row?.enabled).toBe(true);
  });

  it("rejects a forged state", async () => {
    const res = await call(
      "GET",
      "/api/integrations/enrich/callback?token=tok&state=deadbeef",
    );
    expect(res.status).toBe(400);
    expect(res.text).toContain("missing");
  });

  it("returns 502 when the exchange endpoint fails", async () => {
    const state = await issueScoutState();
    _setEnrichFetchForTest(async () => new Response("nope", { status: 500 }));
    const res = await call(
      "GET",
      `/api/integrations/enrich/callback?token=bad&state=${state}`,
    );
    expect(res.status).toBe(502);
    const rows = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.name, ENRICH_PROVIDER_NAME));
    expect(rows).toHaveLength(0);
  });
});

describe("exchangeEnrichToken", () => {
  it("posts the token to /api/connect/exchange and returns parsed credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const mock: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          apiKey: "k",
          baseUrl: "https://enrich.example.com",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await exchangeEnrichToken("the-token", mock);
    expect(result).toEqual({
      apiKey: "k",
      baseUrl: "https://enrich.example.com",
    });
    expect(calls[0]?.url).toMatch(/\/api\/connect\/exchange$/);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ token: "the-token" }));
  });
});

describe("DELETE /api/integrations/enrich/connection", () => {
  it("returns { removed: false } when no Enrich provider exists", async () => {
    const result = await call("DELETE", "/api/integrations/enrich/connection");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ removed: false });
  });

  it("clears enrichment assignment then deletes the provider row", async () => {
    const { providerId, assignedSteps } = await persistEnrichProvider(
      "https://enrich.example.com",
      "k",
    );
    expect(assignedSteps).toEqual(["enrichment"]);
    const res = await call("DELETE", "/api/integrations/enrich/connection");
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

describe("persistEnrichProvider auto-assigns enrichment", () => {
  it("auto-assigns enrichment when no setting exists", async () => {
    const result = await persistEnrichProvider("https://enrich.example.com", "k");
    expect(result.assignedSteps).toEqual(["enrichment"]);
    const [setting] = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "enrichment"));
    expect(setting?.providerId).toBe(result.providerId);
  });

  it("respects autoAssign=false and skips wiring enrichment", async () => {
    const result = await persistEnrichProvider(
      "https://enrich.example.com",
      "k",
      { autoAssign: false },
    );
    expect(result.assignedSteps).toEqual([]);
    const settings = await db
      .select()
      .from(workflowProviderSettingsTable)
      .where(eq(workflowProviderSettingsTable.workflowStep, "enrichment"));
    expect(settings).toHaveLength(0);
  });

  it("does NOT touch enrichment when a setting already exists", async () => {
    const [other] = await db
      .insert(agentProvidersTable)
      .values({
        name: "enrich.test:other-enrichment",
        type: "github",
        enabled: true,
      })
      .returning();
    try {
      await db.insert(workflowProviderSettingsTable).values({
        workflowStep: "enrichment",
        providerId: other!.id,
        enabled: true,
      });
      const result = await persistEnrichProvider(
        "https://enrich.example.com",
        "k",
      );
      expect(result.assignedSteps).toEqual([]);
      const [setting] = await db
        .select()
        .from(workflowProviderSettingsTable)
        .where(eq(workflowProviderSettingsTable.workflowStep, "enrichment"));
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

  it("upserts in place when the Enrich provider already exists", async () => {
    const first = await persistEnrichProvider("https://old.example.com", "old");
    const second = await persistEnrichProvider("https://new.example.com", "new");
    expect(second.providerId).toBe(first.providerId);
    const [row] = await db
      .select()
      .from(agentProvidersTable)
      .where(eq(agentProvidersTable.id, second.providerId));
    expect(row?.baseUrl).toBe("https://new.example.com");
    expect(decryptProviderSecret(row!.apiKeyEncryptedPlaceholder!)).toBe("new");
  });
});
