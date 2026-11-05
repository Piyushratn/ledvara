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
  const code = `acct_${accountCounter}`;
  const rows = await pool.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
    [orgId, code, type, allowNegative],
  );
  return rows.rows[0]?.id ?? "";
}

async function pair(): Promise<{ from: string; to: string }> {
  return { from: await account("asset", true), to: await account("wallet", false) };
}

/** A settled transfer at a chosen time. Balances are not touched: scoring only reads entries. */
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

const ODD_AMOUNT = 1_050_000n; // INR 10,500: large, but not a round multiple of INR 1,000

async function burst(from: string, to: string, count: number, startMinute: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await transfer(from, to, ODD_AMOUNT, at(startMinute + i));
  }
}

async function assessmentFor(transactionId: string): Promise<{
  score: number;
  flagged: boolean;
  reasons: { rule: string }[];
  inputs: { history: { countLast10Min: number; priorCount: number } };
} | null> {
  const rows = await pool.query<{
    score: number;
    flagged: boolean;
    reasons: { rule: string }[];
    inputs: { history: { countLast10Min: number; priorCount: number } };
  }>("SELECT score, flagged, reasons, inputs FROM risk_assessments WHERE transaction_id = $1", [
    transactionId,
  ]);
  return rows.rows[0] ?? null;
}

async function reviewCount(transactionId: string): Promise<number> {
  const rows = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM review_items WHERE transaction_id = $1 AND status = 'pending'",
    [transactionId],
  );
  return rows.rows[0]?.n ?? 0;
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

describe("scoreOutboxEvent", () => {
  it("scores an ordinary transfer as 0 and creates no review item", async () => {
    const { from, to } = await pair();
    const id = await transfer(from, to, 50_000n, at(0));
    const result = await scoreOutboxEvent(pool, eventFor(id, from, to, 50_000n));
    expect(result).toEqual({ status: "scored", score: 0, flagged: false });
    expect((await assessmentFor(id))?.reasons).toEqual([]);
    expect(await reviewCount(id)).toBe(0);
  });

  it("flags a burst of transfers and queues exactly one review item", async () => {
    const { from, to } = await pair();
    await burst(from, to, 9, -9);
    const id = await transfer(from, to, ODD_AMOUNT, at(0));

    const result = await scoreOutboxEvent(pool, eventFor(id, from, to, ODD_AMOUNT));
    expect(result).toEqual({ status: "scored", score: 70, flagged: true });

    const stored = await assessmentFor(id);
    expect(stored?.reasons.map((r) => r.rule).sort()).toEqual([
      "velocity_amount",
      "velocity_count",
    ]);
    expect(stored?.inputs.history.countLast10Min).toBe(9);
    expect(await reviewCount(id)).toBe(1);
  });

  it("is idempotent: scoring the same transfer twice stores one assessment", async () => {
    const { from, to } = await pair();
    await burst(from, to, 9, -9);
    const id = await transfer(from, to, ODD_AMOUNT, at(0));
    const event = eventFor(id, from, to, ODD_AMOUNT);

    expect((await scoreOutboxEvent(pool, event)).status).toBe("scored");
    expect((await scoreOutboxEvent(pool, event)).status).toBe("duplicate");

    const count = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM risk_assessments WHERE transaction_id = $1",
      [id],
    );
    expect(count.rows[0]?.n).toBe(1);
    expect(await reviewCount(id)).toBe(1);
  });

  it("counts only the same account's earlier transfers", async () => {
    const busy = await pair();
    await burst(busy.from, busy.to, 9, -9);

    // Another account is unaffected by the busy one.
    const quiet = await pair();
    const quietId = await transfer(quiet.from, quiet.to, ODD_AMOUNT, at(0));
    const quietResult = await scoreOutboxEvent(
      pool,
      eventFor(quietId, quiet.from, quiet.to, ODD_AMOUNT),
    );
    expect(quietResult).toEqual({ status: "scored", score: 0, flagged: false });

    // Transfers that happen after the scored one do not count against it.
    const later = await pair();
    const firstId = await transfer(later.from, later.to, ODD_AMOUNT, at(0));
    await burst(later.from, later.to, 9, 1);
    const laterResult = await scoreOutboxEvent(
      pool,
      eventFor(firstId, later.from, later.to, ODD_AMOUNT),
    );
    expect(laterResult).toEqual({ status: "scored", score: 0, flagged: false });
  });

  it("ignores transfers older than the 10-minute window for velocity", async () => {
    const { from, to } = await pair();
    await burst(from, to, 9, -40);
    const id = await transfer(from, to, 50_000n, at(0));
    await scoreOutboxEvent(pool, eventFor(id, from, to, 50_000n));
    const stored = await assessmentFor(id);
    expect(stored?.reasons.map((r) => r.rule)).not.toContain("velocity_count");
    expect(stored?.inputs.history.priorCount).toBe(9);
  });

  it("skips other event types, bad payloads and unknown transactions", async () => {
    const { from, to } = await pair();
    const id = await transfer(from, to, 50_000n, at(0));
    const refund = { ...eventFor(id, from, to, 50_000n), type: "refund.created" };
    expect(await scoreOutboxEvent(pool, refund)).toMatchObject({ status: "skipped" });

    const broken = { ...eventFor(id, from, to, 50_000n), payload: { id: "nope" } };
    expect(await scoreOutboxEvent(pool, broken)).toMatchObject({ status: "skipped" });

    const unknown = eventFor(randomUUID(), from, to, 50_000n);
    expect(await scoreOutboxEvent(pool, unknown)).toMatchObject({ status: "skipped" });
    expect(await assessmentFor(id)).toBeNull();
  });
});
