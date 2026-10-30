import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../../packages/db/migrations");

export interface TestApp {
  app: NestFastifyApplication;
  pool: pg.Pool;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}

function readMigrationUp(file: string): string {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const upStart = sql.search(/--\s*Up Migration/iu);
  const downStart = sql.search(/--\s*Down Migration/iu);
  if (upStart === -1) return sql;
  return sql.slice(upStart, downStart === -1 ? undefined : downStart);
}

export async function startTestApp(): Promise<TestApp> {
  const postgres: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("ledvara_test")
    .withUsername("test")
    .withPassword("test")
    .start();
  const redis: StartedRedisContainer = await new RedisContainer("redis:7-alpine").start();

  const databaseUrl = postgres.getConnectionUri();
  const redisUrl = redis.getConnectionUrl();

  // Env must be set before the app (and loadEnv) is imported.
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_SECRET = "integration-test-secret-integration-test-secret";
  process.env.TWO_FACTOR_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.APP_BASE_URL = "http://localhost:5173";

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await pool.query(readMigrationUp(file));
  }

  const { AppModule } = await import("../app.module.js");
  const { AllExceptionsFilter } = await import("../errors/all-exceptions.filter.js");

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    pool,
    async reset() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ledvara.allow_truncate = 'on'");
        await client.query("TRUNCATE users, audit_events CASCADE");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      const { Redis } = await import("ioredis");
      const redisClient = new Redis(redisUrl);
      await redisClient.flushall();
      redisClient.disconnect();
    },
    async stop() {
      await app.close();
      await pool.end();
      await postgres.stop();
      await redis.stop();
    },
  };
}
