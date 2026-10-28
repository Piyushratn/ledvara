import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import type { Dependencies } from "../health/dependencies.js";
import {
  ACCOUNT_MAX_FAILURES,
  IP_MAX_ATTEMPTS,
  LoginThrottleService,
} from "./login-throttle.service.js";

class FakeRedis {
  status = "ready";
  private readonly store = new Map<string, string>();

  async connect(): Promise<void> {}

  async exists(key: string): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? "0") + 1;
    this.store.set(key, String(next));
    return next;
  }

  async expire(): Promise<number> {
    return 1;
  }

  async set(key: string, value: string, ...options: unknown[]): Promise<string> {
    void options;
    this.store.set(key, value);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    for (const key of keys) this.store.delete(key);
    return keys.length;
  }
}

function makeService(redis: unknown = new FakeRedis()): LoginThrottleService {
  return new LoginThrottleService({ redis } as unknown as Dependencies);
}

async function failTimes(
  service: LoginThrottleService,
  email: string,
  times: number,
): Promise<void> {
  for (let i = 0; i < times; i++) await service.recordFailure(email);
}

describe("LoginThrottleService", () => {
  it("allows a fresh account", async () => {
    await expect(makeService().assertAllowed("1.1.1.1", "a@example.com")).resolves.toBeUndefined();
  });

  it("locks an account after too many failures", async () => {
    const service = makeService();
    await failTimes(service, "a@example.com", ACCOUNT_MAX_FAILURES);
    const attempt = service.assertAllowed("1.1.1.1", "a@example.com");
    await expect(attempt).rejects.toBeInstanceOf(AppError);
  });

  it("does not lock before the limit", async () => {
    const service = makeService();
    await failTimes(service, "a@example.com", ACCOUNT_MAX_FAILURES - 1);
    await expect(service.assertAllowed("1.1.1.1", "a@example.com")).resolves.toBeUndefined();
  });

  it("clears failures after a successful login", async () => {
    const service = makeService();
    await failTimes(service, "a@example.com", ACCOUNT_MAX_FAILURES - 1);
    await service.recordSuccess("a@example.com");
    await failTimes(service, "a@example.com", ACCOUNT_MAX_FAILURES - 1);
    await expect(service.assertAllowed("1.1.1.1", "a@example.com")).resolves.toBeUndefined();
  });

  it("keeps accounts independent", async () => {
    const service = makeService();
    await failTimes(service, "a@example.com", ACCOUNT_MAX_FAILURES);
    await expect(service.assertAllowed("1.1.1.1", "b@example.com")).resolves.toBeUndefined();
  });

  it("blocks an IP that makes too many attempts", async () => {
    const service = makeService();
    for (let i = 0; i < IP_MAX_ATTEMPTS; i++) {
      await service.assertAllowed("9.9.9.9", `user${i}@example.com`);
    }
    await expect(service.assertAllowed("9.9.9.9", "late@example.com")).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("fails open when Redis is down", async () => {
    const broken = {
      status: "ready",
      exists: async () => {
        throw new Error("redis down");
      },
    };
    await expect(
      makeService(broken).assertAllowed("1.1.1.1", "a@example.com"),
    ).resolves.toBeUndefined();
  });
});
