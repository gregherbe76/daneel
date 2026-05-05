import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { logger } from "./logger";

/**
 * Symmetric encryption helper for provider credentials stored in the
 * `agent_providers.apiKeyEncryptedPlaceholder` column.
 *
 * Wire format (string column, easy to grep/migrate):
 *   `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`
 *
 * The `enc:v1:` prefix is the version sentinel — values without it are
 * treated as legacy plaintext (so reads keep working before the one-shot
 * `encrypt-provider-keys` backfill has run, and so test fixtures that use
 * literal strings continue to work).
 *
 * The encryption key is derived via scrypt from the `PROVIDER_KEY_SECRET`
 * env var (recommended: a 32+ byte random secret stored as a Replit
 * secret). In non-production environments, if the secret is unset we fall
 * back to a deterministic dev-only key so local development and tests
 * don't have to wire it up — but we log a loud warning. In production,
 * encryption *requires* PROVIDER_KEY_SECRET; missing it throws.
 */

const VERSION_PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SCRYPT_SALT = "daneel:provider-secrets:v1";

let cachedKey: Buffer | null = null;
let warnedAboutDevKey = false;

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env["PROVIDER_KEY_SECRET"];
  if (secret && secret.length > 0) {
    cachedKey = scryptSync(secret, SCRYPT_SALT, KEY_LEN);
    return cachedKey;
  }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "PROVIDER_KEY_SECRET is not set. Refusing to encrypt/decrypt provider credentials in production without it.",
    );
  }
  if (!warnedAboutDevKey) {
    warnedAboutDevKey = true;
    logger.warn(
      "PROVIDER_KEY_SECRET is not set — using insecure dev-only key for provider credential encryption. Set PROVIDER_KEY_SECRET before deploying.",
    );
  }
  cachedKey = scryptSync("dev-insecure-provider-key", SCRYPT_SALT, KEY_LEN);
  return cachedKey;
}

/** For tests — re-resolve the key after env mutations. */
export function _resetProviderSecretKeyForTest(): void {
  cachedKey = null;
  warnedAboutDevKey = false;
}

/** Returns true when `value` is in the `enc:v1:` wire format. */
export function isEncryptedProviderSecret(value: string): boolean {
  return value.startsWith(VERSION_PREFIX);
}

/**
 * Encrypt a provider credential for at-rest storage. Re-encrypting an
 * already-encrypted value is a no-op (idempotent) so callers don't have to
 * track which path the value came from.
 */
export function encryptProviderSecret(plaintext: string): string {
  if (isEncryptedProviderSecret(plaintext)) return plaintext;
  const key = resolveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION_PREFIX.slice(0, -1), // "enc:v1" without trailing colon
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a provider credential. Legacy plaintext values (no `enc:v1:`
 * prefix) are returned as-is so the runtime keeps working before the
 * backfill script has been run.
 */
export function decryptProviderSecret(stored: string): string {
  if (!isEncryptedProviderSecret(stored)) return stored;
  const parts = stored.split(":");
  if (parts.length !== 5) {
    throw new Error("Malformed encrypted provider secret: expected 5 segments");
  }
  const [, , ivB64, tagB64, ctB64] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const key = resolveKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Convenience wrappers for nullable column reads/writes. */
export function maybeEncryptProviderSecret(
  v: string | null | undefined,
): string | null {
  if (v == null || v === "") return null;
  return encryptProviderSecret(v);
}

export function maybeDecryptProviderSecret(
  v: string | null | undefined,
): string | null {
  if (v == null || v === "") return null;
  try {
    return decryptProviderSecret(v);
  } catch (err) {
    logger.error(
      { err },
      "Failed to decrypt provider secret — returning null. Check PROVIDER_KEY_SECRET.",
    );
    return null;
  }
}
