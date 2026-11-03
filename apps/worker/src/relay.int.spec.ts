import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { relayOnce, type JobQueue } from "./relay.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../packages/db/migrations");

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let orgId: string;

class FakeQueue implements JobQueue {
  readonly jobs = new Map<string, { name: string; data: unknown }>();
  failNext = false;
  add(name: string, data: unknown, options: { jobId: string }): Promise<unknown> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("redis down"));
    }
    if (!this.jobs.has(options.jobId)) this.jobs.set(options.jobId, { name, data });
    return Promise.resolve();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 10 });
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const up = sql.search(/--\s*Up Migration/iu);
    const down = sql.search(/--\s*Down Migration/iu);
    await pool.query(up === -1 ? sql : sql.slice(up, down === -1 ? undefined : down));
  }
});

afterAll(async () => {
  await pool.end();
  await container.stop();
});

beforeEach(async () => {
  await pool.query("DELETE FROM outbox_events");
  await pool.query("DELETE FROM organizations");
  const org = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id",
  );
  orgId = org.rows[0]?.id ?? "";
});

async function addEvents(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await pool.query(
      "INSERT INTO outbox_events (org_id, type, aggregate_type, aggregate_id, payload) VALUES ($1, 'transfer.settled', 'transfer', gen_random_uuid(), '{}')",
      [orgId],
    );
  }
}

async function unpublished(): Promise<number> {
  const r = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM outbox_events WHERE published_at IS NULL",
  );
  return Number(r.rows[0]?.n);
}

describe("outbox relay", () => {
  it("enqueues each event once and marks it published", async () => {
    await addEvents(5);
    const queue = new FakeQueue();
    expect(await relayOnce(pool, queue, 50)).toBe(5);
    expect(queue.jobs.size).toBe(5);
    expect(await unpublished()).toBe(0);
    expect(await relayOnce(pool, queue, 50)).toBe(0);
  });

  it("keeps events unpublished when the queue fails, then delivers them later", async () => {
    await addEvents(3);
    const queue = new FakeQueue();
    queue.failNext = true;
    await expect(relayOnce(pool, queue, 50)).rejects.toThrow("redis down");
    expect(await unpublished()).toBe(3);
    expect(await relayOnce(pool, queue, 50)).toBe(3);
    expect(queue.jobs.size).toBe(3);
  });

  it("never relays the same event twice when relays run in parallel", async () => {
    await addEvents(40);
    const queue = new FakeQueue();
    const counts = await Promise.all(Array.from({ length: 6 }, () => relayOnce(pool, queue, 10)));
    let total = counts.reduce((a, b) => a + b, 0);
    while ((await unpublished()) > 0) total += await relayOnce(pool, queue, 10);
    expect(total).toBe(40);
    expect(queue.jobs.size).toBe(40);
  });

  it("relays oldest first and respects the batch size", async () => {
    await addEvents(7);
    const queue = new FakeQueue();
    expect(await relayOnce(pool, queue, 3)).toBe(3);
    expect(await unpublished()).toBe(4);
  });
});
