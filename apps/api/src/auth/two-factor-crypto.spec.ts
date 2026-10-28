import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "./two-factor-crypto.js";

const key = Buffer.alloc(32, 7);

describe("two-factor crypto", () => {
  it("round-trips a secret", () => {
    const encrypted = encryptSecret("JBSWY3DPEHPK3PXP", key, "user-1");
    expect(decryptSecret(encrypted, key, "user-1")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("never stores the plaintext and uses a fresh IV every time", () => {
    const a = encryptSecret("JBSWY3DPEHPK3PXP", key, "user-1");
    const b = encryptSecret("JBSWY3DPEHPK3PXP", key, "user-1");
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(b);
  });

  it("fails with the wrong key", () => {
    const encrypted = encryptSecret("JBSWY3DPEHPK3PXP", key, "user-1");
    expect(() => decryptSecret(encrypted, Buffer.alloc(32, 8), "user-1")).toThrowError();
  });

  it("fails when moved to another user", () => {
    const encrypted = encryptSecret("JBSWY3DPEHPK3PXP", key, "user-1");
    expect(() => decryptSecret(encrypted, key, "user-2")).toThrowError();
  });

  it("fails when the ciphertext is tampered with", () => {
    const parts = encryptSecret("JBSWY3DPEHPK3PXP", key, "user-1").split(".");
    parts[3] = Buffer.from("tampered-data").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key, "user-1")).toThrowError();
  });

  it("rejects malformed payloads", () => {
    expect(() => decryptSecret("garbage", key, "user-1")).toThrowError();
  });

  it("validates the encryption key format", () => {
    expect(() => parseEncryptionKey(undefined)).toThrowError();
    expect(() => parseEncryptionKey("too-short")).toThrowError();
    expect(parseEncryptionKey("ab".repeat(32))).toHaveLength(32);
  });
});
