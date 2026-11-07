import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../../packages/db/migrations");

export interface Infra {
  databaseUrl: string;
  redisUrl: string;
  pool: pg.Pool;
  stop: () => Promise<void>;
}

function upPart(file: string): string {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const up = sql.search(/--\s*Up Migration/iu);
  const down = sql.search(/--\s*Down Migration/iu);
  if (up === -1) return sql;
  return sql.slice(up, down === -1 ? undefined : down);
}

/** Postgres (with every migration applied) and Redis, without any application attached. */
export async function startInfra(): Promise<Infra> {
  const postgres = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("ledvara_chaos")
    .withUsername("test")
    .withPassword("test")
    .start();
  const redis = await new RedisContainer("redis:7-alpine").start();

  const databaseUrl = postgres.getConnectionUri();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) await pool.query(upPart(file));

  return {
    databaseUrl,
    redisUrl: redis.getConnectionUrl(),
    pool,
    async stop() {
      await pool.end();
      await postgres.stop();
      await redis.stop();
    },
  };
}
