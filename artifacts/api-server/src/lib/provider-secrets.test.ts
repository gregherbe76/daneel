import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetProviderSecretKeyForTest,
  decryptProviderSecret,
  describeProviderSecretEncryption,
  encryptProviderSecret,
  isEncryptedProviderSecret,
  maybeDecryptProviderSecret,
  maybeEncryptProviderSecret,
  maybeUpgradeProviderSecretToV2,
} from "./provider-secrets";

const originalSecret = process.env["PROVIDER_KEY_SECRET"];
const originalOldSecret = process.env["PROVIDER_KEY_SECRET_OLD"];
const originalKeyId = process.env["PROVIDER_KEY_ID"];
const originalOldKeyId = process.env["PROVIDER_KEY_ID_OLD"];
const originalAutoUpgrade = process.env["PROVIDER_KEY_AUTO_UPGRADE"];

beforeEach(() => {
  process.env["PROVIDER_KEY_SECRET"] = "test-secret-please-change";
  delete process.env["PROVIDER_KEY_SECRET_OLD"];
  delete process.env["PROVIDER_KEY_ID"];
  delete process.env["PROVIDER_KEY_ID_OLD"];
  delete process.env["PROVIDER_KEY_AUTO_UPGRADE"];
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
  restoreEnv("PROVIDER_KEY_AUTO_UPGRADE", originalAutoUpgrade);
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

  describe("maybeUpgradeProviderSecretToV2", () => {
    it("returns null when the auto-upgrade flag is off (default)", () => {
      process.env["PROVIDER_KEY_ID"] = "2026-05";
      _resetProviderSecretKeyForTest();
      // Encrypt a v1 row first (no key id at write time).
      delete process.env["PROVIDER_KEY_ID"];
      _resetProviderSecretKeyForTest();
      const v1 = encryptProviderSecret("legacy-row");
      expect(v1.startsWith("enc:v1:")).toBe(true);

      // Now turn on a key id but leave auto-upgrade off.
      process.env["PROVIDER_KEY_ID"] = "2026-05";
      _resetProviderSecretKeyForTest();
      expect(maybeUpgradeProviderSecretToV2(v1)).toBeNull();
    });

    it("returns null when PROVIDER_KEY_ID is not configured", () => {
      const v1 = encryptProviderSecret("still-v1");
      expect(v1.startsWith("enc:v1:")).toBe(true);
      process.env["PROVIDER_KEY_AUTO_UPGRADE"] = "1";
      _resetProviderSecretKeyForTest();
      expect(maybeUpgradeProviderSecretToV2(v1)).toBeNull();
    });

    it("returns a v2 ciphertext when both flag and key id are set", () => {
      // Step 1: write a v1 row under no key id.
      const v1 = encryptProviderSecret("upgrade-me");
      expect(v1.startsWith("enc:v1:")).toBe(true);

      // Step 2: configure key id + auto-upgrade.
      process.env["PROVIDER_KEY_ID"] = "2026-05";
      process.env["PROVIDER_KEY_AUTO_UPGRADE"] = "1";
      _resetProviderSecretKeyForTest();

      const v2 = maybeUpgradeProviderSecretToV2(v1);
      expect(v2).not.toBeNull();
      expect(v2!.startsWith("enc:v2:2026-05:")).toBe(true);
      expect(v2!.split(":")).toHaveLength(6);
      expect(decryptProviderSecret(v2!)).toBe("upgrade-me");
    });

    it("is a no-op for already-v2 rows, plaintext, and empty values", () => {
      process.env["PROVIDER_KEY_ID"] = "2026-05";
      process.env["PROVIDER_KEY_AUTO_UPGRADE"] = "1";
      _resetProviderSecretKeyForTest();
      const v2 = encryptProviderSecret("fresh");
      expect(v2.startsWith("enc:v2:")).toBe(true);
      expect(maybeUpgradeProviderSecretToV2(v2)).toBeNull();
      expect(maybeUpgradeProviderSecretToV2("legacy-plaintext")).toBeNull();
      expect(maybeUpgradeProviderSecretToV2(null)).toBeNull();
      expect(maybeUpgradeProviderSecretToV2(undefined)).toBeNull();
      expect(maybeUpgradeProviderSecretToV2("")).toBeNull();
    });
  });

  describe("describeProviderSecretEncryption", () => {
    it("reports empty for null/empty", () => {
      expect(describeProviderSecretEncryption(null)).toBe("empty");
      expect(describeProviderSecretEncryption(undefined)).toBe("empty");
      expect(describeProviderSecretEncryption("")).toBe("empty");
    });

    it("reports plaintext for legacy unencrypted values", () => {
      expect(describeProviderSecretEncryption("legacy-key")).toBe("plaintext");
    });

    it("reports primary for values encrypted under the current secret", () => {
      const ct = encryptProviderSecret("hello");
      expect(describeProviderSecretEncryption(ct)).toBe("primary");
    });

    it("reports old for values readable only via PROVIDER_KEY_SECRET_OLD", () => {
      const oldCt = encryptProviderSecret("rotated");
      process.env["PROVIDER_KEY_SECRET"] = "brand-new-secret";
      process.env["PROVIDER_KEY_SECRET_OLD"] = "test-secret-please-change";
      _resetProviderSecretKeyForTest();
      expect(describeProviderSecretEncryption(oldCt)).toBe("old");
    });

    it("reports unreadable when neither key can decrypt", () => {
      const ct = encryptProviderSecret("payload");
      process.env["PROVIDER_KEY_SECRET"] = "wrong-primary";
      process.env["PROVIDER_KEY_SECRET_OLD"] = "wrong-old";
      _resetProviderSecretKeyForTest();
      expect(describeProviderSecretEncryption(ct)).toBe("unreadable");
    });

    it("reports unreadable for malformed enc:vN values", () => {
      expect(describeProviderSecretEncryption("enc:v1:not-enough-segments")).toBe(
        "unreadable",
      );
    });
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
