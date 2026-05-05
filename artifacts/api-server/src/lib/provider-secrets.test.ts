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

beforeEach(() => {
  process.env["PROVIDER_KEY_SECRET"] = "test-secret-please-change";
  _resetProviderSecretKeyForTest();
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env["PROVIDER_KEY_SECRET"];
  } else {
    process.env["PROVIDER_KEY_SECRET"] = originalSecret;
  }
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

  it("maybeEncryptProviderSecret handles null/empty", () => {
    expect(maybeEncryptProviderSecret(null)).toBeNull();
    expect(maybeEncryptProviderSecret(undefined)).toBeNull();
    expect(maybeEncryptProviderSecret("")).toBeNull();
    const v = maybeEncryptProviderSecret("k");
    expect(v).toBeTruthy();
    expect(maybeDecryptProviderSecret(v)).toBe("k");
  });
});
