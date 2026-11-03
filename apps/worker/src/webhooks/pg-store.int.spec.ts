import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgWebhookStore } from "./pg-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../../packages/db/migrations");

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let store: PgWebhookStore;
let orgId: string;

function upPart(file: string): string {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const up = sql.search(/--\s*Up Migration/iu);
  const down = sql.search(/--\s*Down Migration/iu);
  if (up === -1) return sql;
  return sql.slice(up, down === -1 ? undefined : down);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 3 });
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) await pool.query(upPart(file));
  store = new PgWebhookStore(pool);
});

afterAll(async () => {
  await pool.end();
  await container.stop();
});

beforeEach(async () => {
  const org = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', $1) RETURNING id",
    [`acme-${randomUUID()}`],
  );
  orgId = org.rows[0]?.id ?? "";
});

async function endpoint(
  org: string,
  eventTypes: string[],
  enabled = true,
  url = "https://example.com/h",
): Promise<string> {
  const rows = await pool.query<{ id: string }>(
    `INSERT INTO webhook_endpoints (org_id, url, secret_enc, event_types, enabled)
     VALUES ($1, $2, 'v1.x.y.z', $3::text[], $4) RETURNING id`,
    [org, url, eventTypes, enabled],
  );
  return rows.rows[0]?.id ?? "";
}

describe("PgWebhookStore", () => {
  it("finds enabled endpoints of the same organization that match the event type", async () => {
    const all = await endpoint(orgId, ["*"]);
    const exact = await endpoint(orgId, ["payout.paid"]);
    await endpoint(orgId, ["payout.paid"], false);
    await endpoint(orgId, ["transfer.posted"]);

    const other = await pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', $1) RETURNING id",
      [`other-${randomUUID()}`],
    );
    await endpoint(other.rows[0]?.id ?? "", ["*"]);

    const ids = await store.findEndpointIds(orgId, "payout.paid");
    expect([...ids].sort()).toEqual([all, exact].sort());
  });

  it("loads an endpoint, or null when it does not exist", async () => {
    const id = await endpoint(orgId, ["*"]);
    const loaded = await store.loadEndpoint(id);
    expect(loaded).toMatchObject({ id, orgId, url: "https://example.com/h", enabled: true });
    expect(await store.loadEndpoint("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("keeps one delivery row per event and endpoint and counts attempts", async () => {
    const endpointId = await endpoint(orgId, ["*"]);
    const eventId = "33333333-3333-4333-8333-333333333333";
    const base = { endpointId, orgId, eventId, eventType: "payout.paid" };

    await store.recordAttempt({ ...base, outcome: "retry", statusCode: 500, error: "HTTP 500" });
    await store.recordAttempt({ ...base, outcome: "succeeded", statusCode: 200, error: null });

    const rows = await pool.query<{
      status: string;
      attempts: number;
      last_status_code: number;
      delivered_at: Date | null;
    }>(
      "SELECT status, attempts, last_status_code, delivered_at FROM webhook_deliveries WHERE endpoint_id = $1",
      [endpointId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ status: "succeeded", attempts: 2, last_status_code: 200 });
    expect(rows.rows[0]?.delivered_at).not.toBeNull();
  });

  it("records a pending delivery after a retryable failure", async () => {
    const endpointId = await endpoint(orgId, ["*"]);
    await store.recordAttempt({
      endpointId,
      orgId,
      eventId: "44444444-4444-4444-8444-444444444444",
      eventType: "payout.paid",
      outcome: "retry",
      statusCode: null,
      error: "timeout",
    });
    const rows = await pool.query<{ status: string; delivered_at: Date | null }>(
      "SELECT status, delivered_at FROM webhook_deliveries WHERE endpoint_id = $1",
      [endpointId],
    );
    expect(rows.rows[0]?.status).toBe("pending");
    expect(rows.rows[0]?.delivered_at).toBeNull();
  });
});
