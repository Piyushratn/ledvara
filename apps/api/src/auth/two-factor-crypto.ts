import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw || !/^[0-9a-f]{64}$/iu.test(raw)) {
    throw new Error("TWO_FACTOR_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  }
  return Buffer.from(raw, "hex");
}

/** AES-256-GCM. `aad` (the user id) binds the ciphertext to one user. */
export function encryptSecret(plaintext: string, key: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, key: Buffer, aad: string): string {
  const [version, iv, tag, ciphertext, extra] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra !== undefined) {
    throw new Error("Malformed encrypted secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
