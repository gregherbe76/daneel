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
 * Wire formats (string column, easy to grep/migrate):
 *   `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`            (5 segments, no key id)
 *   `enc:v2:<keyId>:<iv_b64>:<tag_b64>:<ciphertext_b64>`    (6 segments, tagged with key id)
 *
 * The `enc:v1:` / `enc:v2:` prefixes are the version sentinels — values
 * matching neither are treated as legacy plaintext (so reads keep working
 * before the one-shot
 * `encrypt-provider-keys` backfill has run, and so test fixtures that use
 * literal strings continue to work).
 *
 * The encryption key is derived via scrypt from the `PROVIDER_KEY_SECRET`
 * env var (recommended: a 32+ byte random secret stored as a Replit
 * secret). In non-production environments, if the secret is unset we fall
 * back to a deterministic dev-only key so local development and tests
 * don't have to wire it up — but we log a loud warning. In production,
 * encryption *requires* PROVIDER_KEY_SECRET; missing it throws.
 *
 * Key rotation:
 *   - During rotation, set `PROVIDER_KEY_SECRET_OLD` to the previous secret
 *     so existing rows can still be decrypted while the rotation script
 *     re-encrypts them.
 *   - Set `PROVIDER_KEY_ID` to opt new writes into the v2 wire format with
 *     an explicit key id (e.g. `2026-05`). Without it, new writes use v1.
 *   - `PROVIDER_KEY_ID_OLD` (default `"old"`) tags the fallback key id used
 *     when reading rows that were written under the previous secret.
 *
 * See `scripts/src/rotate-provider-keys.ts` for the rotation runbook.
 */

const VERSION_PREFIX_V1 = "enc:v1:";
const VERSION_PREFIX_V2 = "enc:v2:";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SCRYPT_SALT = "daneel:provider-secrets:v1";
const DEV_INSECURE_SECRET = "dev-insecure-provider-key";
const DEFAULT_OLD_KEY_ID = "old";

interface KeyringEntry {
  /** Optional key id; null means "untagged primary". */
  id: string | null;
  key: Buffer;
}

interface Keyring {
  primary: KeyringEntry;
  /** Optional previous key, used during rotation windows. */
  old: KeyringEntry | null;
}

let cachedKeyring: Keyring | null = null;
let warnedAboutDevKey = false;

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SCRYPT_SALT, KEY_LEN);
}

const KEY_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

function validateKeyId(value: string | undefined, envName: string): string | null {
  if (!value) return null;
  if (!KEY_ID_PATTERN.test(value)) {
    throw new Error(
      `${envName} contains invalid characters. Allowed: letters, digits, '_', '.', '-' (no ':' since it is the wire-format delimiter).`,
    );
  }
  return value;
}

function resolveKeyring(): Keyring {
  if (cachedKeyring) return cachedKeyring;

  const primarySecret = process.env["PROVIDER_KEY_SECRET"];
  const primaryId = validateKeyId(process.env["PROVIDER_KEY_ID"], "PROVIDER_KEY_ID");
  const oldSecret = process.env["PROVIDER_KEY_SECRET_OLD"];
  const oldId =
    validateKeyId(process.env["PROVIDER_KEY_ID_OLD"], "PROVIDER_KEY_ID_OLD") ||
    DEFAULT_OLD_KEY_ID;

  let primary: KeyringEntry;

  if (primarySecret && primarySecret.length > 0) {
    primary = { id: primaryId, key: deriveKey(primarySecret) };
  } else {
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
    primary = { id: primaryId, key: deriveKey(DEV_INSECURE_SECRET) };
  }

  const old: KeyringEntry | null =
    oldSecret && oldSecret.length > 0
      ? { id: oldId, key: deriveKey(oldSecret) }
      : null;

  cachedKeyring = { primary, old };
  return cachedKeyring;
}

/** For tests — re-resolve the keyring after env mutations. */
export function _resetProviderSecretKeyForTest(): void {
  cachedKeyring = null;
  warnedAboutDevKey = false;
}

/** Returns true when `value` is in the `enc:v1:` or `enc:v2:` wire format. */
export function isEncryptedProviderSecret(value: string): boolean {
  return (
    value.startsWith(VERSION_PREFIX_V1) || value.startsWith(VERSION_PREFIX_V2)
  );
}

/**
 * Encrypt a provider credential for at-rest storage. Re-encrypting an
 * already-encrypted value is a no-op (idempotent) so callers don't have to
 * track which path the value came from.
 *
 * Writes the v2 wire format (with explicit key id) when `PROVIDER_KEY_ID`
 * is set; otherwise writes the legacy v1 format for byte-for-byte
 * compatibility with rows produced before key rotation was supported.
 */
export function encryptProviderSecret(plaintext: string): string {
  if (isEncryptedProviderSecret(plaintext)) return plaintext;
  const { primary } = resolveKeyring();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, primary.key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  if (primary.id) {
    return [
      "enc:v2",
      primary.id,
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");
  }
  return [
    "enc:v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

interface ParsedSecret {
  /** Key id from the wire format, or null for v1 (untagged). */
  keyId: string | null;
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
}

function parseEncryptedSecret(stored: string): ParsedSecret {
  const parts = stored.split(":");
  if (stored.startsWith(VERSION_PREFIX_V1)) {
    if (parts.length !== 5) {
      throw new Error(
        "Malformed enc:v1 provider secret: expected 5 segments",
      );
    }
    const [, , ivB64, tagB64, ctB64] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    return {
      keyId: null,
      iv: Buffer.from(ivB64, "base64"),
      tag: Buffer.from(tagB64, "base64"),
      ct: Buffer.from(ctB64, "base64"),
    };
  }
  if (stored.startsWith(VERSION_PREFIX_V2)) {
    if (parts.length !== 6) {
      throw new Error(
        "Malformed enc:v2 provider secret: expected 6 segments",
      );
    }
    const [, , keyId, ivB64, tagB64, ctB64] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    return {
      keyId,
      iv: Buffer.from(ivB64, "base64"),
      tag: Buffer.from(tagB64, "base64"),
      ct: Buffer.from(ctB64, "base64"),
    };
  }
  throw new Error("Malformed provider secret: unknown version prefix");
}

function tryDecryptWith(
  entry: KeyringEntry,
  parsed: ParsedSecret,
): string | null {
  try {
    const decipher = createDecipheriv(ALGO, entry.key, parsed.iv);
    decipher.setAuthTag(parsed.tag);
    const plaintext = Buffer.concat([
      decipher.update(parsed.ct),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Decrypt a provider credential. Legacy plaintext values (no `enc:vN:`
 * prefix) are returned as-is so the runtime keeps working before the
 * backfill script has been run.
 *
 * During a rotation window where both `PROVIDER_KEY_SECRET` and
 * `PROVIDER_KEY_SECRET_OLD` are configured, this method transparently
 * tries both keys: the one matching the embedded key id first (for v2),
 * then falls back to whichever key is available.
 */
export function decryptProviderSecret(stored: string): string {
  if (!isEncryptedProviderSecret(stored)) return stored;
  const parsed = parseEncryptedSecret(stored);
  const { primary, old } = resolveKeyring();

  // Build an ordered list of candidate keys. If the wire format carries a
  // key id, prefer the entry whose id matches; otherwise try primary first.
  const candidates: KeyringEntry[] = [];
  if (parsed.keyId !== null) {
    if (primary.id === parsed.keyId) candidates.push(primary);
    if (old && old.id === parsed.keyId) candidates.push(old);
  }
  if (!candidates.includes(primary)) candidates.push(primary);
  if (old && !candidates.includes(old)) candidates.push(old);

  for (const candidate of candidates) {
    const result = tryDecryptWith(candidate, parsed);
    if (result !== null) return result;
  }
  throw new Error(
    "Failed to decrypt provider secret under any configured key. Check PROVIDER_KEY_SECRET / PROVIDER_KEY_SECRET_OLD.",
  );
}

/**
 * Lazy v1 → v2 migration helper. Returns a freshly-encrypted v2 ciphertext
 * for the given v1 row, or `null` when no upgrade is needed (already v2,
 * legacy plaintext, no key id configured, or the auto-upgrade flag is off).
 *
 * Opt-in via `PROVIDER_KEY_AUTO_UPGRADE=1` (or `true`) so deployments that
 * have not configured `PROVIDER_KEY_ID` yet — or that don't want background
 * re-encrypts at all — keep the old behaviour. When enabled, callers are
 * expected to fire-and-forget the resulting ciphertext back into the row
 * (see `routes/providers.ts`).
 *
 * The returned ciphertext is freshly encrypted under the current primary
 * key with a new random IV (AES-GCM, non-deterministic), so the row's
 * plaintext is unchanged — only the wire format (and the embedded key id)
 * gets refreshed.
 */
export function maybeUpgradeProviderSecretToV2(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  if (!stored.startsWith(VERSION_PREFIX_V1)) return null;
  const flag = process.env["PROVIDER_KEY_AUTO_UPGRADE"];
  if (flag !== "1" && flag !== "true") return null;
  const { primary } = resolveKeyring();
  if (primary.id === null) return null;
  let plaintext: string;
  try {
    plaintext = decryptProviderSecret(stored);
  } catch {
    return null;
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, primary.key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "enc:v2",
    primary.id,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
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
      "Failed to decrypt provider secret — returning null. Check PROVIDER_KEY_SECRET / PROVIDER_KEY_SECRET_OLD.",
    );
    return null;
  }
}

/**
 * Return the last 4 characters of the (decrypted) provider secret so the
 * Settings UI can show a masked hint like "•••• abcd" without ever sending
 * the live key over the wire. Returns null when the column is empty or the
 * secret can't be decrypted (e.g. PROVIDER_KEY_SECRET rotated without a
 * re-encrypt run).
 *
 * Secrets shorter than 4 chars produce null too — emitting a partial value
 * for tiny strings would effectively leak the whole thing.
 */
export function lastFourOfProviderSecret(
  v: string | null | undefined,
): string | null {
  const plain = maybeDecryptProviderSecret(v);
  if (!plain || plain.length < 4) return null;
  return plain.slice(-4);
}
