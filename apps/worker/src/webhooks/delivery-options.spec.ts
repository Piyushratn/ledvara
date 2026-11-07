import { describe, expect, it } from "vitest";
import { DELIVERY_JOB_OPTIONS, MAX_DELIVERY_ATTEMPTS } from "./deliver.js";

describe("delivery job options", () => {
  it("retries with exponential backoff and jitter", () => {
    expect(DELIVERY_JOB_OPTIONS.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(DELIVERY_JOB_OPTIONS.backoff.type).toBe("exponential");
    expect(DELIVERY_JOB_OPTIONS.backoff.delay).toBe(10_000);
    expect(DELIVERY_JOB_OPTIONS.backoff.jitter).toBeGreaterThan(0);
    expect(DELIVERY_JOB_OPTIONS.backoff.jitter).toBeLessThanOrEqual(1);
  });
});
