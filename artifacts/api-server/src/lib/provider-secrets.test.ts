import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetProviderSecretKeyForTest,
  decryptProviderSecret,
  encryptProviderSecret,
  isEncryptedProviderSecret,
  maybeDecryptProviderSecret,
  maybeEncryptProviderSecret,
} from "./provider-secrets";

const originalSecret = process.env["PROVIDER_KEY_SECRET"];
const originalOldSecret = process.env["PROVIDER_KEY_SECRET_OLD"];
const originalKeyId = process.env["PROVIDER_KEY_ID"];
const originalOldKeyId = process.env["PROVIDER_KEY_ID_OLD"];

beforeEach(() => {
  process.env["PROVIDER_KEY_SECRET"] = "test-secret-please-change";
  delete process.env["PROVIDER_KEY_SECRET_OLD"];
  delete process.env["PROVIDER_KEY_ID"];
  delete process.env["PROVIDER_KEY_ID_OLD"];
  _resetProviderSecretKeyForTest();
});

function restoreEnv(name: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = original;
  }
}

afterEach(() => {
  restoreEnv("PROVIDER_KEY_SECRET", originalSecret);
  restoreEnv("PROVIDER_KEY_SECRET_OLD", originalOldSecret);
  restoreEnv("PROVIDER_KEY_ID", originalKeyId);
  restoreEnv("PROVIDER_KEY_ID_OLD", originalOldKeyId);
  _resetProviderSecretKeyForTest();
});

describe("provider-secrets", () => {
  it("roundtrips a value through encrypt/decrypt", () => {
    const ciphertext = encryptProviderSecret("scout-secret-key");
    expect(isEncryptedProviderSecret(ciphertext)).toBe(true);
    expect(ciphertext).not.toContain("scout-secret-key");
    expect(decryptProviderSecret(ciphertext)).toBe("scout-secret-key");
  });

  it("uses a fresh IV so the same plaintext yields different ciphertexts", () => {
    const a = encryptProviderSecret("same-key");
    const b = encryptProviderSecret("same-key");
    expect(a).not.toBe(b);
    expect(decryptProviderSecret(a)).toBe("same-key");
    expect(decryptProviderSecret(b)).toBe("same-key");
  });

  it("re-encrypting an already-encrypted value is a no-op", () => {
    const ciphertext = encryptProviderSecret("k");
    expect(encryptProviderSecret(ciphertext)).toBe(ciphertext);
  });

  it("treats legacy plaintext (no enc:v1: prefix) as a passthrough on decrypt", () => {
    expect(decryptProviderSecret("legacy-plaintext")).toBe("legacy-plaintext");
    expect(isEncryptedProviderSecret("legacy-plaintext")).toBe(false);
  });

  it("rejects tampered ciphertext via the GCM auth tag", () => {
    const ct = encryptProviderSecret("hello");
    // Flip a character in the ciphertext segment (last segment).
    const parts = ct.split(":");
    const last = parts[4]!;
    parts[4] = last[0] === "A" ? "B" + last.slice(1) : "A" + last.slice(1);
    const tampered = parts.join(":");
    expect(() => decryptProviderSecret(tampered)).toThrow();
  });

  it("fails to decrypt under a different key (verifies the secret matters)", () => {
    const ct = encryptProviderSecret("something");
    process.env["PROVIDER_KEY_SECRET"] = "a-completely-different-secret";
    _resetProviderSecretKeyForTest();
    expect(() => decryptProviderSecret(ct)).toThrow();
  });

  it("writes the v2 wire format when PROVIDER_KEY_ID is set", () => {
    process.env["PROVIDER_KEY_ID"] = "2026-05";
    _resetProviderSecretKeyForTest();
    const ct = encryptProviderSecret("v2-value");
    expect(ct.startsWith("enc:v2:2026-05:")).toBe(true);
    expect(ct.split(":")).toHaveLength(6);
    expect(decryptProviderSecret(ct)).toBe("v2-value");
  });

  it("decrypts old rows under PROVIDER_KEY_SECRET_OLD during rotation", () => {
    // Encrypt under the original ("old") secret.
    const oldCt = encryptProviderSecret("rotated-value");

    // Rotate: new primary, old becomes the fallback.
    process.env["PROVIDER_KEY_SECRET"] = "brand-new-secret";
    process.env["PROVIDER_KEY_SECRET_OLD"] = "test-secret-please-change";
    _resetProviderSecretKeyForTest();

    // Existing v1 rows still decrypt via the OLD fallback key.
    expect(decryptProviderSecret(oldCt)).toBe("rotated-value");

    // New writes are encrypted under the new primary and roundtrip.
    const newCt = encryptProviderSecret("fresh-value");
    expect(decryptProviderSecret(newCt)).toBe("fresh-value");
  });

  it("prefers the key whose id matches the v2 keyId during rotation", () => {
    // Write a v2 row tagged with the OLD key id.
    process.env["PROVIDER_KEY_ID"] = "old-id";
    _resetProviderSecretKeyForTest();
    const oldCt = encryptProviderSecret("tagged-value");
    expect(oldCt.startsWith("enc:v2:old-id:")).toBe(true);

    // Switch to a new primary, with the previous secret kept as fallback
    // under the matching key id.
    process.env["PROVIDER_KEY_SECRET"] = "another-new-secret";
    process.env["PROVIDER_KEY_ID"] = "new-id";
    process.env["PROVIDER_KEY_SECRET_OLD"] = "test-secret-please-change";
    process.env["PROVIDER_KEY_ID_OLD"] = "old-id";
    _resetProviderSecretKeyForTest();

    expect(decryptProviderSecret(oldCt)).toBe("tagged-value");
  });

  it("throws a clear error when neither key can decrypt the value", () => {
    const ct = encryptProviderSecret("payload");
    process.env["PROVIDER_KEY_SECRET"] = "wrong-primary";
    process.env["PROVIDER_KEY_SECRET_OLD"] = "wrong-old";
    _resetProviderSecretKeyForTest();
    expect(() => decryptProviderSecret(ct)).toThrow(/any configured key/);
  });

  it("maybeEncryptProviderSecret handles null/empty", () => {
    expect(maybeEncryptProviderSecret(null)).toBeNull();
    expect(maybeEncryptProviderSecret(undefined)).toBeNull();
    expect(maybeEncryptProviderSecret("")).toBeNull();
    const v = maybeEncryptProviderSecret("k");
    expect(v).toBeTruthy();
    expect(maybeDecryptProviderSecret(v)).toBe("k");
  });
});
