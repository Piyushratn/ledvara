import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, VISIBLE_PREFIX_LENGTH } from "./api-key-token.js";

describe("api key generation", () => {
  it("makes unique keys with a visible prefix", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.key.startsWith("lv_test_")).toBe(true);
    expect(a.prefix).toBe(a.key.slice(0, VISIBLE_PREFIX_LENGTH));
  });

  it("stores a hash that is not the key and matches hashApiKey", () => {
    const { key, hash } = generateApiKey();
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
  });
});
