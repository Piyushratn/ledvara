import { describe, expect, it } from "vitest";
import { checkKeyLimit, KEY_LIMIT, type CounterRedis } from "./api-key-limiter.js";

class FakeCounter implements CounterRedis {
  private readonly counts = new Map<string, number>();
  incr(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return Promise.resolve(next);
  }
  expire(): Promise<number> {
    return Promise.resolve(1);
  }
  ttl(): Promise<number> {
    return Promise.resolve(42);
  }
}

describe("checkKeyLimit", () => {
  it("allows requests up to the limit and reports remaining", async () => {
    const redis = new FakeCounter();
    const first = await checkKeyLimit(redis, "k1");
    expect(first).toMatchObject({ allowed: true, limit: KEY_LIMIT, remaining: KEY_LIMIT - 1 });
  });

  it("blocks the request after the limit", async () => {
    const redis = new FakeCounter();
    for (let i = 0; i < KEY_LIMIT; i++) await checkKeyLimit(redis, "k1");
    const over = await checkKeyLimit(redis, "k1");
    expect(over.allowed).toBe(false);
    expect(over.remaining).toBe(0);
    expect(over.resetSeconds).toBe(42);
  });

  it("counts each key separately", async () => {
    const redis = new FakeCounter();
    for (let i = 0; i < KEY_LIMIT; i++) await checkKeyLimit(redis, "k1");
    expect((await checkKeyLimit(redis, "k2")).allowed).toBe(true);
  });
});
