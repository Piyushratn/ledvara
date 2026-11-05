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

function upPart(file: string): string {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const up = sql.search(/--\s*Up Migration/iu);
  const down = sql.search(/--\s*Down Migration/iu);
  if (up === -1) return sql;
  return sql.slice(up, down === -1 ? undefined : down);
}

async function account(type: string, allowNegative: boolean): Promise<string> {
  accountCounter += 1;
  const code = `sig_${accountCounter}`;
  const rows = await pool.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
    [orgId, code, type, allowNegative],
  );
  return rows.rows[0]?.id ?? "";
}

async function pair(): Promise<{ from: string; to: string }> {
  return { from: await account("asset", true), to: await account("wallet", false) };
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

function eventFor(
  transactionId: string,
  from: string,
  to: string,
  amount: bigint,
  apiKeyId: string | null = null,
): OutboxRow {
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
      apiKeyId,
    },
    created_at: new Date().toISOString(),
  };
}

async function failure(from: string, createdAt: string): Promise<void> {
  await pool.query(
    `INSERT INTO transfer_failures (org_id, from_account_id, amount_minor, code, created_at)
     VALUES ($1, $2, 500, 'insufficient_funds', $3)`,
    [orgId, from, createdAt],
  );
}

/** Records that an earlier transfer from this account was made with a given key. */
async function priorKeyEvent(from: string, keyId: string, createdAt: string): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_events (org_id, type, aggregate_type, aggregate_id, payload, created_at)
     VALUES ($1, 'transfer.settled', 'transfer', $2, $3::jsonb, $4)`,
    [orgId, randomUUID(), JSON.stringify({ fromAccountId: from, apiKeyId: keyId }), createdAt],
  );
}

async function rulesFor(transactionId: string): Promise<{ rules: string[]; score: number }> {
  const rows = await pool.query<{ score: number; reasons: { rule: string }[] }>(
    "SELECT score, reasons FROM risk_assessments WHERE transaction_id = $1",
    [transactionId],
  );
  return {
    rules: (rows.rows[0]?.reasons ?? []).map((r) => r.rule),
    score: rows.rows[0]?.score ?? -1,
  };
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

describe("repeated_failures", () => {
  it("fires when three refused attempts happened in the previous 24 hours", async () => {
    const { from, to } = await pair();
    await failure(from, at(-60));
    await failure(from, at(-30));
    await failure(from, at(-5));
    const id = await transfer(from, to, 50_000n, at(0));
    await scoreOutboxEvent(pool, eventFor(id, from, to, 50_000n));
    expect(await rulesFor(id)).toEqual({ rules: ["repeated_failures"], score: 20 });
  });

  it("ignores failures that are older than 24 hours, later than the transfer, or on another account", async () => {
    const { from, to } = await pair();
    const other = await pair();
    await failure(from, at(-25 * 60));
    await failure(from, at(5));
    await failure(other.from, at(-10));
    await failure(other.from, at(-20));
    await failure(other.from, at(-30));
    const id = await transfer(from, to, 50_000n, at(0));
    await scoreOutboxEvent(pool, eventFor(id, from, to, 50_000n));
    expect(await rulesFor(id)).toEqual({ rules: [], score: 0 });
  });
});

describe("new_api_key", () => {
  it("fires when the account's earlier transfers used a different key", async () => {
    const { from, to } = await pair();
    const oldKey = randomUUID();
    const newKey = randomUUID();
    await transfer(from, to, 50_000n, at(-30));
    await priorKeyEvent(from, oldKey, at(-30));

    const id = await transfer(from, to, 50_000n, at(0));
    await scoreOutboxEvent(pool, eventFor(id, from, to, 50_000n, newKey));
    expect(await rulesFor(id)).toEqual({ rules: ["new_api_key"], score: 15 });
  });

  it("stays quiet when the same key was used before", async () => {
    const { from, to } = await pair();
    const key = randomUUID();
    await transfer(from, to, 50_000n, at(-30));
    await priorKeyEvent(from, key, at(-30));

    const id = await transfer(from, to, 50_000n, at(0));
    await scoreOutboxEvent(pool, eventFor(id, from, to, 50_000n, key));
    expect(await rulesFor(id)).toEqual({ rules: [], score: 0 });
  });
});
