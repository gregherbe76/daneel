/**
 * Rotate the provider encryption secret without losing saved keys.
 *
 * Operational runbook: `docs/provider-key-rotation.md`.
 *
 * Reads every encrypted row in `agent_providers.apiKeyEncryptedPlaceholder`,
 * decrypts it under `PROVIDER_KEY_SECRET_OLD`, and re-encrypts it under the
 * current `PROVIDER_KEY_SECRET`. Rows that are still plaintext (no `enc:`
 * prefix) are skipped — run `encrypt-provider-keys` first if you need them
 * encrypted.
 *
 * Wire format and key derivation must stay byte-for-byte identical to
 * `artifacts/api-server/src/lib/provider-secrets.ts`. The logic is duplicated
 * here on purpose so this script can run as a standalone workspace package
 * without pulling api-server's full dependency graph.
 *
 * Run with:
 *   PROVIDER_KEY_SECRET_OLD=<old> PROVIDER_KEY_SECRET=<new> \
 *     pnpm --filter @workspace/scripts run rotate-provider-keys           # apply
 *   PROVIDER_KEY_SECRET_OLD=<old> PROVIDER_KEY_SECRET=<new> \
 *     pnpm --filter @workspace/scripts run rotate-provider-keys -- --dry  # preview
 *
 * Optional env:
 *   PROVIDER_KEY_ID       — when set, rows are re-encrypted in the v2 wire
 *                           format with this key id (e.g. `2026-05`). Without
 *                           it, rows are written back in the v1 format for
 *                           byte-for-byte compatibility with pre-rotation rows.
 *   PROVIDER_KEY_ID_OLD   — when set, the script tries the OLD key first for
 *                           any v2 row whose embedded keyId matches; otherwise
 *                           it just tries the new key, then the old one.
 *
 * Idempotent: rows already re-encrypted under the new key are detected (by a
 * successful decrypt under the new key) and skipped, so re-running is safe.
 *
 * Runbook (zero-downtime rotation):
 *   1. Pick a new secret value (no special env var needed — keep it noted
 *      somewhere safe until rotation completes).
 *   2. On the running api-server, set `PROVIDER_KEY_SECRET_OLD` to the
 *      *current* secret and `PROVIDER_KEY_SECRET` to the *new* secret, then
 *      restart. Reads of existing rows will fall back to the OLD key.
 *   3. Run this script with the same OLD/NEW values.
 *   4. Once it reports `failed=0`, remove `PROVIDER_KEY_SECRET_OLD` from the
 *      environment and restart.
 *
 * The canonical operational runbook lives in `docs/provider-key-rotation.md`;
 * keep this header comment in sync with it when behavior changes.
 */

import { db, pool, agentProvidersTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const VERSION_PREFIX_V1 = "enc:v1:";
const VERSION_PREFIX_V2 = "enc:v2:";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SCRYPT_SALT = "daneel:provider-secrets:v1";

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SCRYPT_SALT, KEY_LEN);
}

const KEY_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function validateKeyId(value: string | null, envName: string): string | null {
  if (!value) return null;
  if (!KEY_ID_PATTERN.test(value)) {
    throw new Error(
      `${envName} contains invalid characters. Allowed: letters, digits, '_', '.', '-' (no ':' since it is the wire-format delimiter).`,
    );
  }
  return value;
}

function isEncrypted(value: string): boolean {
  return (
    value.startsWith(VERSION_PREFIX_V1) || value.startsWith(VERSION_PREFIX_V2)
  );
}

interface Parsed {
  keyId: string | null;
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
}

function parse(stored: string): Parsed {
  const parts = stored.split(":");
  if (stored.startsWith(VERSION_PREFIX_V1)) {
    if (parts.length !== 5) {
      throw new Error("Malformed enc:v1 secret: expected 5 segments");
    }
    return {
      keyId: null,
      iv: Buffer.from(parts[2]!, "base64"),
      tag: Buffer.from(parts[3]!, "base64"),
      ct: Buffer.from(parts[4]!, "base64"),
    };
  }
  if (stored.startsWith(VERSION_PREFIX_V2)) {
    if (parts.length !== 6) {
      throw new Error("Malformed enc:v2 secret: expected 6 segments");
    }
    return {
      keyId: parts[2]!,
      iv: Buffer.from(parts[3]!, "base64"),
      tag: Buffer.from(parts[4]!, "base64"),
      ct: Buffer.from(parts[5]!, "base64"),
    };
  }
  throw new Error("Unknown wire format");
}

function tryDecrypt(parsed: Parsed, key: Buffer): string | null {
  try {
    const decipher = createDecipheriv(ALGO, key, parsed.iv);
    decipher.setAuthTag(parsed.tag);
    return Buffer.concat([
      decipher.update(parsed.ct),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function encrypt(plaintext: string, key: Buffer, keyId: string | null): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  if (keyId) {
    return [
      "enc:v2",
      keyId,
      iv.toString("base64"),
      tag.toString("base64"),
      ct.toString("base64"),
    ].join(":");
  }
  return [
    "enc:v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry");

  const oldSecret = process.env["PROVIDER_KEY_SECRET_OLD"];
  const newSecret = process.env["PROVIDER_KEY_SECRET"];
  const newKeyId = process.env["PROVIDER_KEY_ID"] || null;

  if (!oldSecret || oldSecret.length === 0) {
    throw new Error(
      "PROVIDER_KEY_SECRET_OLD is required. Set it to the previous secret used to encrypt the rows.",
    );
  }
  if (!newSecret || newSecret.length === 0) {
    throw new Error(
      "PROVIDER_KEY_SECRET is required. Set it to the new secret to re-encrypt rows under.",
    );
  }
  if (oldSecret === newSecret) {
    throw new Error(
      "PROVIDER_KEY_SECRET_OLD and PROVIDER_KEY_SECRET are identical — nothing to rotate.",
    );
  }

  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret);
  const newKeyIdValidated = validateKeyId(newKeyId, "PROVIDER_KEY_ID");
  const oldKeyId = validateKeyId(
    process.env["PROVIDER_KEY_ID_OLD"] || null,
    "PROVIDER_KEY_ID_OLD",
  );

  const rows = await db
    .select()
    .from(agentProvidersTable)
    .where(isNotNull(agentProvidersTable.apiKeyEncryptedPlaceholder));

  let plaintextSkipped = 0;
  let alreadyOnNewKey = 0;
  let rotated = 0;
  let failed = 0;

  for (const row of rows) {
    const v = row.apiKeyEncryptedPlaceholder;
    if (!v) continue;

    if (!isEncrypted(v)) {
      plaintextSkipped++;
      console.warn(
        `[skip] provider id=${row.id} name=${JSON.stringify(row.name)} is plaintext — run encrypt-provider-keys first`,
      );
      continue;
    }

    let parsed: Parsed;
    try {
      parsed = parse(v);
    } catch (err) {
      failed++;
      console.error(
        `[fail] provider id=${row.id} name=${JSON.stringify(row.name)}: ${(err as Error).message}`,
      );
      continue;
    }

    // Key ordering: when the v2 row's embedded keyId matches PROVIDER_KEY_ID_OLD,
    // try OLD first to avoid spurious GCM auth-tag failures on the new key.
    // Otherwise we always check the NEW key first (idempotency: a row already
    // rotated decrypts cleanly under it and is skipped).
    const preferOldFirst =
      parsed.keyId !== null && oldKeyId !== null && parsed.keyId === oldKeyId;

    if (!preferOldFirst) {
      const underNew = tryDecrypt(parsed, newKey);
      if (underNew !== null) {
        alreadyOnNewKey++;
        continue;
      }
    }

    let plaintext = tryDecrypt(parsed, oldKey);
    if (plaintext === null && preferOldFirst) {
      // Fall back to the new key in case the row was already rotated.
      const underNew = tryDecrypt(parsed, newKey);
      if (underNew !== null) {
        alreadyOnNewKey++;
        continue;
      }
    }
    if (plaintext === null) {
      failed++;
      console.error(
        `[fail] provider id=${row.id} name=${JSON.stringify(row.name)}: cannot decrypt under PROVIDER_KEY_SECRET_OLD`,
      );
      continue;
    }

    if (dryRun) {
      console.log(
        `[dry] would rotate provider id=${row.id} name=${JSON.stringify(row.name)}`,
      );
      rotated++;
      continue;
    }

    const ciphertext = encrypt(plaintext, newKey, newKeyIdValidated);
    await db
      .update(agentProvidersTable)
      .set({
        apiKeyEncryptedPlaceholder: ciphertext,
        updatedAt: new Date(),
      })
      .where(eq(agentProvidersTable.id, row.id));
    rotated++;
    console.log(
      `[ok]  rotated provider id=${row.id} name=${JSON.stringify(row.name)}`,
    );
  }

  console.log(
    `\nDone. total=${rows.length} rotated=${rotated} alreadyOnNewKey=${alreadyOnNewKey} plaintextSkipped=${plaintextSkipped} failed=${failed}${dryRun ? " (dry-run)" : ""}`,
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
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
