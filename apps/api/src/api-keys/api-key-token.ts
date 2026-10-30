import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "lv_test_";
export const VISIBLE_PREFIX_LENGTH = 12;

export interface GeneratedKey {
  key: string;
  prefix: string;
  hash: string;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): GeneratedKey {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, VISIBLE_PREFIX_LENGTH), hash: hashApiKey(key) };
}
