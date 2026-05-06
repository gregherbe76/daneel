import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, agentProvidersTable } from "@workspace/db";
import providersRouter from "./providers";
import {
  _resetProviderSecretKeyForTest,
  encryptProviderSecret,
} from "../lib/provider-secrets";

const app = express();
app.use(express.json());
app.use("/api", providersRouter);

const TEST_MARKER = "providers-encryption-status.test:";
const seededProviderIds: number[] = [];

const originalSecret = process.env["PROVIDER_KEY_SECRET"];
const originalOldSecret = process.env["PROVIDER_KEY_SECRET_OLD"];

beforeEach(() => {
  process.env["PROVIDER_KEY_SECRET"] = "encryption-status-test-primary";
  delete process.env["PROVIDER_KEY_SECRET_OLD"];
  _resetProviderSecretKeyForTest();
});

afterEach(async () => {
  if (seededProviderIds.length > 0) {
    await db
      .delete(agentProvidersTable)
      .where(inArray(agentProvidersTable.id, seededProviderIds));
    seededProviderIds.length = 0;
  }
  if (originalSecret === undefined) delete process.env["PROVIDER_KEY_SECRET"];
  else process.env["PROVIDER_KEY_SECRET"] = originalSecret;
  if (originalOldSecret === undefined)
    delete process.env["PROVIDER_KEY_SECRET_OLD"];
  else process.env["PROVIDER_KEY_SECRET_OLD"] = originalOldSecret;
  _resetProviderSecretKeyForTest();
});

async function call(method: "GET", url: string) {
  return await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("no address"));
        return;
      }
      fetch(`http://127.0.0.1:${address.port}${url}`, { method })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

async function seedProvider(suffix: string, encryptedKey: string | null) {
  const [row] = await db
    .insert(agentProvidersTable)
    .values({
      name: `${TEST_MARKER}${suffix}`,
      type: "custom_webhook",
      apiKeyEncryptedPlaceholder: encryptedKey,
    })
    .returning();
  seededProviderIds.push(row!.id);
  return row!;
}

describe("GET /providers/encryption-status", () => {
  it("counts rows by which key decrypts them", async () => {
    // Row 1: encrypted under the OLD secret only.
    process.env["PROVIDER_KEY_SECRET"] = "encryption-status-test-old";
    _resetProviderSecretKeyForTest();
    const oldCt = encryptProviderSecret("rotated-value");

    // Switch back to the primary, with the previous secret kept as fallback.
    process.env["PROVIDER_KEY_SECRET"] = "encryption-status-test-primary";
    process.env["PROVIDER_KEY_SECRET_OLD"] = "encryption-status-test-old";
    _resetProviderSecretKeyForTest();

    const primaryCt = encryptProviderSecret("on-primary");

    await seedProvider("old-key", oldCt);
    await seedProvider("primary-key", primaryCt);
    await seedProvider("plaintext", "legacy-plaintext");
    await seedProvider("unreadable", "enc:v1:not-enough-segments");
    await seedProvider("empty", null);

    const baseline = await call("GET", "/api/providers/encryption-status");
    expect(baseline.status).toBe(200);
    const b = baseline.body;
    // Other rows may exist in this dev DB; assert the deltas we just seeded
    // are reflected (i.e. each bucket contains at least our contribution).
    expect(b.primaryKey).toBeGreaterThanOrEqual(1);
    expect(b.oldKey).toBeGreaterThanOrEqual(1);
    expect(b.plaintext).toBeGreaterThanOrEqual(1);
    expect(b.unreadable).toBeGreaterThanOrEqual(1);
    expect(b.totalEncrypted).toBeGreaterThanOrEqual(b.primaryKey + b.oldKey + b.unreadable);
    expect(b.needsRotation).toBe(b.oldKey + b.plaintext + b.unreadable);
    expect(b.needsRotation).toBeGreaterThan(0);
  });
});
