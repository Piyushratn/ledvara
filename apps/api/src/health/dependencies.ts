import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import pg from "pg";
import { loadEnv } from "../config/env.js";

@Injectable()
export class Dependencies implements OnApplicationShutdown {
  private readonly pool: pg.Pool;
  private readonly redis: Redis;

  constructor() {
    const env = loadEnv();
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 2000,
    });
    // lazyConnect + no retries: a down Redis must fail fast in /readyz, not hang.
    this.redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 2000,
    });
    this.redis.on("error", () => {
      // Errors are reported through ping(); this keeps Node from crashing on unhandled events.
    });
  }

  async pingPostgres(): Promise<boolean> {
    try {
      await this.pool.query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  async pingRedis(): Promise<boolean> {
    try {
      if (this.redis.status === "wait" || this.redis.status === "end") {
        await this.redis.connect();
      }
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end().catch(() => undefined);
    this.redis.disconnect();
  }
}
