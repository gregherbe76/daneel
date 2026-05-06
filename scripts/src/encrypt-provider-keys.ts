/**
 * One-shot backfill: encrypt any plaintext API keys still sitting in
 * `agent_providers.apiKeyEncryptedPlaceholder` (the column was misnamed —
 * historically it stored the raw value).
 *
 * The wire format and key derivation must stay byte-for-byte identical to
 * `artifacts/api-server/src/lib/provider-secrets.ts`. The logic is duplicated
 * here on purpose so this script can run as a standalone workspace package
 * without pulling api-server's full dependency graph.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run encrypt-provider-keys           # apply
 *   pnpm --filter @workspace/scripts run encrypt-provider-keys -- --dry  # preview
 *
 * Idempotent: rows already in the `enc:v1:` format are skipped, so re-running
 * is a no-op.
 *
 * Required env: PROVIDER_KEY_SECRET (same value the api-server uses).
 */

import { db, pool, agentProvidersTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION_PREFIX = "enc:v1:";
const VERSION_PREFIX_V2 = "enc:v2:";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SCRYPT_SALT = "daneel:provider-secrets:v1";

function resolveKey(): Buffer {
  const secret = process.env["PROVIDER_KEY_SECRET"];
  if (secret && secret.length > 0) {
    return scryptSync(secret, SCRYPT_SALT, KEY_LEN);
  }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "PROVIDER_KEY_SECRET is not set. Refusing to run encryption backfill in production without it.",
    );
  }
  console.warn(
    "[encrypt-provider-keys] PROVIDER_KEY_SECRET is not set — using insecure dev-only key. Set PROVIDER_KEY_SECRET to match the api-server before running this in any real environment.",
  );
  return scryptSync("dev-insecure-provider-key", SCRYPT_SALT, KEY_LEN);
}

function isEncrypted(value: string): boolean {
  // Recognize both wire formats so this backfill never re-encrypts a row
  // that was already encrypted under v1 *or* v2 (added when key rotation
  // landed). See `rotate-provider-keys.ts` for the rotation flow.
  return (
    value.startsWith(VERSION_PREFIX) || value.startsWith(VERSION_PREFIX_V2)
  );
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "enc:v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry");
  const key = resolveKey();

  const rows = await db
    .select()
    .from(agentProvidersTable)
    .where(isNotNull(agentProvidersTable.apiKeyEncryptedPlaceholder));

  let alreadyEncrypted = 0;
  let toEncrypt = 0;
  let skippedEmpty = 0;
  let updated = 0;

  for (const row of rows) {
    const v = row.apiKeyEncryptedPlaceholder;
    if (!v) {
      skippedEmpty++;
      continue;
    }
    if (isEncrypted(v)) {
      alreadyEncrypted++;
      continue;
    }
    toEncrypt++;
    if (dryRun) {
      console.log(
        `[dry] would encrypt provider id=${row.id} name=${JSON.stringify(row.name)} (plaintext length=${v.length})`,
      );
      continue;
    }
    const ciphertext = encrypt(v, key);
    await db
      .update(agentProvidersTable)
      .set({
        apiKeyEncryptedPlaceholder: ciphertext,
        updatedAt: new Date(),
      })
      .where(eq(agentProvidersTable.id, row.id));
    updated++;
    console.log(
      `[ok]  encrypted provider id=${row.id} name=${JSON.stringify(row.name)}`,
    );
  }

  console.log(
    `\nDone. total=${rows.length} alreadyEncrypted=${alreadyEncrypted} skippedEmpty=${skippedEmpty} toEncrypt=${toEncrypt} updated=${updated}${dryRun ? " (dry-run)" : ""}`,
  );
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
