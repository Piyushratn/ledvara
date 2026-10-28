import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import { AppError } from "../errors/app-error.js";
import { Dependencies } from "../health/dependencies.js";

export const IP_MAX_ATTEMPTS = 30;
export const IP_WINDOW_SECONDS = 15 * 60;
export const ACCOUNT_MAX_FAILURES = 5;
export const ACCOUNT_WINDOW_SECONDS = 15 * 60;
export const ACCOUNT_LOCK_SECONDS = 15 * 60;

const ipKey = (ip: string): string => `rl:login:ip:${ip}`;
const failKey = (email: string): string => `rl:login:fail:${email}`;
const lockKey = (email: string): string => `rl:login:lock:${email}`;

@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  /** Throws 429 if this IP or this account is currently blocked. Fails open if Redis is down. */
  async assertAllowed(ip: string | null, email: string): Promise<void> {
    let blocked = false;
    try {
      const redis = await this.connect();
      if ((await redis.exists(lockKey(email))) > 0) {
        blocked = true;
      } else if (ip) {
        const count = await this.bump(redis, ipKey(ip), IP_WINDOW_SECONDS);
        blocked = count > IP_MAX_ATTEMPTS;
      }
    } catch (error) {
      this.logger.error({ err: error }, "Login throttle unavailable, allowing request");
      return;
    }
    if (blocked) {
      throw new AppError(429, "too_many_attempts", "Too many attempts. Please try again later.");
    }
  }

  async recordFailure(email: string): Promise<void> {
    try {
      const redis = await this.connect();
      const failures = await this.bump(redis, failKey(email), ACCOUNT_WINDOW_SECONDS);
      if (failures >= ACCOUNT_MAX_FAILURES) {
        await redis.set(lockKey(email), "1", "EX", ACCOUNT_LOCK_SECONDS);
        await redis.del(failKey(email));
      }
    } catch (error) {
      this.logger.error({ err: error }, "Failed to record login failure");
    }
  }

  async recordSuccess(email: string): Promise<void> {
    try {
      const redis = await this.connect();
      await redis.del(failKey(email));
    } catch (error) {
      this.logger.error({ err: error }, "Failed to clear login failures");
    }
  }

  private async bump(redis: Redis, key: string, ttlSeconds: number): Promise<number> {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttlSeconds);
    }
    return count;
  }

  private async connect(): Promise<Redis> {
    const redis = this.deps.redis;
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }
    return redis;
  }
}
