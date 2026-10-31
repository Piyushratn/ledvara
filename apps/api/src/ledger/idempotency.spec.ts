import { describe, expect, it } from "vitest";
import { canonicalJson, hashRequest } from "./idempotency.service.js";

describe("request hashing", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalJson({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("changes when a value changes", () => {
    const a = hashRequest("POST", "/v1/transfers", { amount: 100 });
    const b = hashRequest("POST", "/v1/transfers", { amount: 101 });
    expect(a).not.toBe(b);
  });

  it("changes with the path and method", () => {
    const body = { amount: 100 };
    expect(hashRequest("POST", "/v1/transfers", body)).not.toBe(
      hashRequest("POST", "/v1/payouts", body),
    );
  });
});
