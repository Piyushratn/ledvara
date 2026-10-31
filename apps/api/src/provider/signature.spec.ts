import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "./signature.js";

const body = '{"a":1}';
const now = 1_700_000_000;

describe("provider signature", () => {
  it("accepts a correct signature", () => {
    expect(verifySignature("s3cretkey", body, signPayload("s3cretkey", body, now), now)).toBe(true);
  });

  it("rejects a wrong secret, changed body and stale timestamp", () => {
    const header = signPayload("s3cretkey", body, now);
    expect(verifySignature("another-key", body, header, now)).toBe(false);
    expect(verifySignature("s3cretkey", '{"a":2}', header, now)).toBe(false);
    expect(verifySignature("s3cretkey", body, header, now + 301)).toBe(false);
  });

  it("rejects malformed headers", () => {
    expect(verifySignature("s3cretkey", body, "garbage", now)).toBe(false);
  });
});
