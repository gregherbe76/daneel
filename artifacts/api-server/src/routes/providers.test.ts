import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, agentProvidersTable } from "@workspace/db";
import {
  encryptProviderSecret,
  isEncryptedProviderSecret,
  decryptProviderSecret,
} from "../lib/provider-secrets";
import providersRouter from "./providers";

// Mounted on /api so the route paths in this test match the production prefix.
const app = express();
app.use(express.json());
app.use("/api", providersRouter);

const TEST_MARKER = "providers.test:";
const seededIds: number[] = [];

afterEach(async () => {
  if (seededIds.length === 0) return;
  await db
    .delete(agentProvidersTable)
    .where(inArray(agentProvidersTable.id, seededIds));
  seededIds.length = 0;
});

async function seedProvider(opts: {
  name: string;
  apiKeyPlaintext?: string | null;
}) {
  const [row] = await db
    .insert(agentProvidersTable)
    .values({
      name: `${TEST_MARKER}${opts.name}`,
      type: "custom_webhook",
      webhookUrl: "https://example.com/hook",
      apiKeyEncryptedPlaceholder:
        opts.apiKeyPlaintext != null
          ? encryptProviderSecret(opts.apiKeyPlaintext)
          : null,
    })
    .returning();
  if (!row) throw new Error("failed to insert test provider");
  seededIds.push(row.id);
  return row;
}

async function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("no address"));
        return;
      }
      fetch(`http://127.0.0.1:${address.port}${url}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
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

async function getStoredKey(id: number): Promise<string | null> {
  const [row] = await db
    .select()
    .from(agentProvidersTable)
    .where(eq(agentProvidersTable.id, id));
  return row?.apiKeyEncryptedPlaceholder ?? null;
}

describe("GET /api/providers — masked-key serialization", () => {
  it("returns apiKeyLast4 only and never leaks the encrypted column or plaintext", async () => {
    const plaintextKey = "sk-supersecret-12345-abcd";
    const seeded = await seedProvider({
      name: "leak-check",
      apiKeyPlaintext: plaintextKey,
    });

    const res = await call("GET", "/api/providers");
    expect(res.status).toBe(200);

    const row = (res.body as Array<Record<string, unknown>>).find(
      (p) => (p as { id: number }).id === seeded.id,
    );
    expect(row).toBeTruthy();

    // Last-4 hint is exposed for the masked placeholder.
    expect(row).toMatchObject({ apiKeyLast4: "abcd" });

    // The encrypted column is stripped entirely — neither the ciphertext nor
    // any field containing the plaintext should appear in the response.
    expect(row).not.toHaveProperty("apiKeyEncryptedPlaceholder");

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(plaintextKey);
    expect(serialized).not.toContain("enc:v1:");
    expect(serialized).not.toContain("enc:v2:");
  });

  it("returns apiKeyLast4: null when no key is stored", async () => {
    const seeded = await seedProvider({ name: "no-key", apiKeyPlaintext: null });

    const res = await call("GET", "/api/providers");
    expect(res.status).toBe(200);
    const row = (res.body as Array<Record<string, unknown>>).find(
      (p) => (p as { id: number }).id === seeded.id,
    );
    expect(row).toMatchObject({ apiKeyLast4: null });
    expect(row).not.toHaveProperty("apiKeyEncryptedPlaceholder");
  });

  it("GET /api/providers/:id also strips the encrypted column", async () => {
    const seeded = await seedProvider({
      name: "single-leak-check",
      apiKeyPlaintext: "sk-another-secret-wxyz",
    });
    const res = await call("GET", `/api/providers/${seeded.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ apiKeyLast4: "wxyz" });
    expect(res.body).not.toHaveProperty("apiKeyEncryptedPlaceholder");
    expect(JSON.stringify(res.body)).not.toContain("sk-another-secret-wxyz");
  });
});

describe("PUT /api/providers/:id — preserve key when body field is empty", () => {
  const basePayload = (overrides: Record<string, unknown> = {}) => ({
    name: `${TEST_MARKER}leak-check`,
    type: "custom_webhook",
    webhookUrl: "https://example.com/hook",
    enabled: true,
    ...overrides,
  });

  it("leaves the encrypted column untouched when apiKeyPlaceholder is null", async () => {
    const original = await seedProvider({
      name: "preserve-null",
      apiKeyPlaintext: "sk-original-key-1234",
    });
    const before = await getStoredKey(original.id);
    expect(before).toBeTruthy();
    expect(isEncryptedProviderSecret(before!)).toBe(true);

    const res = await call("PUT", `/api/providers/${original.id}`, {
      ...basePayload({ name: original.name }),
      apiKeyPlaceholder: null,
    });
    expect(res.status).toBe(200);

    const after = await getStoredKey(original.id);
    expect(after).toBe(before);
    expect(decryptProviderSecret(after!)).toBe("sk-original-key-1234");
  });

  it("leaves the encrypted column untouched when apiKeyPlaceholder is the empty string", async () => {
    const original = await seedProvider({
      name: "preserve-empty",
      apiKeyPlaintext: "sk-original-key-5678",
    });
    const before = await getStoredKey(original.id);

    const res = await call("PUT", `/api/providers/${original.id}`, {
      ...basePayload({ name: original.name }),
      apiKeyPlaceholder: "",
    });
    expect(res.status).toBe(200);

    const after = await getStoredKey(original.id);
    expect(after).toBe(before);
    expect(decryptProviderSecret(after!)).toBe("sk-original-key-5678");
  });

  it("leaves the encrypted column untouched when apiKeyPlaceholder is omitted entirely", async () => {
    const original = await seedProvider({
      name: "preserve-omitted",
      apiKeyPlaintext: "sk-original-key-9999",
    });
    const before = await getStoredKey(original.id);

    const res = await call("PUT", `/api/providers/${original.id}`, {
      ...basePayload({ name: original.name }),
      // no apiKeyPlaceholder field at all
    });
    expect(res.status).toBe(200);

    const after = await getStoredKey(original.id);
    expect(after).toBe(before);
    expect(decryptProviderSecret(after!)).toBe("sk-original-key-9999");
  });

  it("re-encrypts to a new value when apiKeyPlaceholder is a non-empty string", async () => {
    const original = await seedProvider({
      name: "rotate-key",
      apiKeyPlaintext: "sk-original-key-old1",
    });
    const before = await getStoredKey(original.id);

    const res = await call("PUT", `/api/providers/${original.id}`, {
      ...basePayload({ name: original.name }),
      apiKeyPlaceholder: "sk-replacement-key-new2",
    });
    expect(res.status).toBe(200);

    const after = await getStoredKey(original.id);
    expect(after).not.toBe(before);
    expect(after).toBeTruthy();
    expect(isEncryptedProviderSecret(after!)).toBe(true);
    expect(decryptProviderSecret(after!)).toBe("sk-replacement-key-new2");

    // And the response stays masked — the new plaintext must not echo back.
    expect(res.body).not.toHaveProperty("apiKeyEncryptedPlaceholder");
    expect(res.body).toMatchObject({ apiKeyLast4: "new2" });
    expect(JSON.stringify(res.body)).not.toContain("sk-replacement-key-new2");
  });
});
