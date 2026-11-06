import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutboxRow } from "../relay.js";
import { scoreOutboxEvent } from "./score-transfer.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../../packages/db/migrations");

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let orgId: string;
let accountCounter = 0;

const BASE = Date.parse("2026-11-04T10:00:00Z");
const at = (minutes: number): string => new Date(BASE + minutes * 60_000).toISOString();
const ODD_AMOUNT = 1_050_000n; // INR 10,500, not a round multiple of INR 1,000

function upPart(file: string): string {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const up = sql.search(/--\s*Up Migration/iu);
  const down = sql.search(/--\s*Down Migration/iu);
  if (up === -1) return sql;
  return sql.slice(up, down === -1 ? undefined : down);
}

async function account(type: string, allowNegative: boolean): Promise<string> {
  accountCounter += 1;
  const code = `rev_${accountCounter}`;
  const rows = await pool.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
    [orgId, code, type, allowNegative],
  );
  return rows.rows[0]?.id ?? "";
}

async function transfer(
  from: string,
  to: string,
  amount: bigint,
  createdAt: string,
): Promise<string> {
  const client = await pool.connect();
  let id: string;
  try {
    await client.query("BEGIN");
    const txn = await client.query<{ id: string }>(
      "INSERT INTO transactions (org_id, kind, created_at) VALUES ($1, 'transfer', $2) RETURNING id",
      [orgId, createdAt],
    );
    id = txn.rows[0]?.id ?? "";
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor)
       VALUES ($1, $2, $3, 'debit', $5), ($1, $2, $4, 'credit', $5)`,
      [id, orgId, from, to, amount.toString()],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await pool.query("UPDATE transactions SET status = 'settled' WHERE id = $1", [id]);
  return id;
}

function eventFor(transactionId: string, from: string, to: string, amount: bigint): OutboxRow {
  return {
    id: randomUUID(),
    org_id: orgId,
    type: "transfer.settled",
    aggregate_type: "transfer",
    aggregate_id: transactionId,
    payload: {
      id: transactionId,
      fromAccountId: from,
      toAccountId: to,
      amountMinor: amount.toString(),
    },
    created_at: new Date().toISOString(),
  };
}

async function reviewEvents(
  transactionId: string,
): Promise<{ aggregate_id: string; payload: { transactionId: string; score: number } }[]> {
  const rows = await pool.query<{
    aggregate_id: string;
    payload: { transactionId: string; score: number };
  }>(
    `SELECT aggregate_id, payload FROM outbox_events
      WHERE org_id = $1 AND type = 'risk.review_required' AND payload->>'transactionId' = $2`,
    [orgId, transactionId],
  );
  return rows.rows;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 4 });
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) await pool.query(upPart(file));
  const org = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', $1) RETURNING id",
    [`acme-${randomUUID()}`],
  );
  orgId = org.rows[0]?.id ?? "";
});

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe("risk.review_required event", () => {
  it("is written once, with the review item, when a transfer is flagged", async () => {
    const from = await account("asset", true);
    const to = await account("wallet", false);
    for (let i = 0; i < 9; i++) await transfer(from, to, ODD_AMOUNT, at(-9 + i));
    const id = await transfer(from, to, ODD_AMOUNT, at(0));
    const event = eventFor(id, from, to, ODD_AMOUNT);

    expect(await scoreOutboxEvent(pool, event)).toEqual({
      status: "scored",
      score: 70,
      flagged: true,
    });
    // A redelivered event must not produce a second alert.
    expect((await scoreOutboxEvent(pool, event)).status).toBe("duplicate");

    const events = await reviewEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.score).toBe(70);

    const review = await pool.query<{ id: string }>(
      "SELECT id FROM review_items WHERE transaction_id = $1",
      [id],
    );
    expect(events[0]?.aggregate_id).toBe(review.rows[0]?.id);
  });

  it("is not written for an unflagged transfer", async () => {
    const from = await account("asset", true);
    const to = await account("wallet", false);
    const id = await transfer(from, to, 50_000n, at(0));
    expect((await scoreOutboxEvent(pool, eventFor(id, from, to, 50_000n))).status).toBe("scored");
    expect(await reviewEvents(id)).toHaveLength(0);
  });
});
