import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  emitFailureEvents,
  reconcileAndRecord,
  reconcileOnce,
  type BalanceDrift,
} from "./reconcile.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../packages/db/migrations");

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let orgId: string;
let platform: string;
let wallet: string;

function upPart(file: string): string {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const up = sql.search(/--\s*Up Migration/iu);
  const down = sql.search(/--\s*Down Migration/iu);
  if (up === -1) return sql;
  return sql.slice(up, down === -1 ? undefined : down);
}

async function account(code: string, type: string, allowNegative: boolean): Promise<string> {
  const rows = await pool.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
    [orgId, code, type, allowNegative],
  );
  return rows.rows[0]?.id ?? "";
}

/** Posts a balanced transfer the way LedgerService does: entries plus balances, one transaction. */
async function transfer(amount: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txn = await client.query<{ id: string }>(
      "INSERT INTO transactions (org_id, kind) VALUES ($1, 'transfer') RETURNING id",
      [orgId],
    );
    const id = txn.rows[0]?.id;
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor)
       VALUES ($1, $2, $3, 'debit', $5), ($1, $2, $4, 'credit', $5)`,
      [id, orgId, platform, wallet, amount],
    );
    await client.query("UPDATE accounts SET balance_minor = balance_minor + $2 WHERE id = $1", [
      platform,
      amount,
    ]);
    await client.query("UPDATE accounts SET balance_minor = balance_minor + $2 WHERE id = $1", [
      wallet,
      amount,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  platform = await account("platform_funds", "asset", true);
  wallet = await account("wallet_one", "wallet", false);
});

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe("reconcileOnce", () => {
  it("reports a clean ledger as clean", async () => {
    await transfer(1000);
    await transfer(250);
    const report = await reconcileOnce(pool);
    expect(report.accountsChecked).toBe(2);
    expect(report.drifts).toEqual([]);
    expect(report.unbalanced).toEqual([]);
  });

  it("detects a stored balance that no longer matches the entries", async () => {
    await pool.query("UPDATE accounts SET balance_minor = balance_minor + 7 WHERE id = $1", [
      wallet,
    ]);
    const report = await reconcileOnce(pool);
    expect(report.drifts).toHaveLength(1);
    expect(report.drifts[0]).toMatchObject({ accountId: wallet, stored: "1257", derived: "1250" });
    // Put it back so later tests start clean.
    await pool.query("UPDATE accounts SET balance_minor = balance_minor - 7 WHERE id = $1", [
      wallet,
    ]);
  });

  it("detects a transaction whose debits and credits differ", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Test-only: the zero-sum rule is a deferred constraint trigger; defer it past COMMIT.
      await client.query("SET LOCAL session_replication_role = replica");
      const txn = await client.query<{ id: string }>(
        "INSERT INTO transactions (org_id, kind) VALUES ($1, 'transfer') RETURNING id",
        [orgId],
      );
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor)
         VALUES ($1, $2, $3, 'debit', 100), ($1, $2, $4, 'credit', 90)`,
        [txn.rows[0]?.id, orgId, platform, wallet],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const report = await reconcileOnce(pool);
    expect(report.unbalanced.some((row) => row.debits === "100" && row.credits === "90")).toBe(
      true,
    );
  });
});

describe("reconcileAndRecord", () => {
  it("stores one history row per run", async () => {
    const before = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM reconciliation_runs",
    );
    await reconcileAndRecord(pool);
    const after = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM reconciliation_runs",
    );
    expect((after.rows[0]?.n ?? 0) - (before.rows[0]?.n ?? 0)).toBe(1);
  });
});

describe("emitFailureEvents", () => {
  async function existingEventIds(): Promise<string[]> {
    const rows = await pool.query<{ id: string }>(
      "SELECT id FROM outbox_events WHERE type = 'ledger.reconciliation_failed'",
    );
    return rows.rows.map((row) => row.id);
  }

  it("writes one event per affected organization containing only its own findings", async () => {
    const other = await pool.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', $1) RETURNING id",
      [`other-${randomUUID()}`],
    );
    const otherOrg = other.rows[0]?.id ?? "";
    const drift = (org: string, id: string): BalanceDrift => ({
      accountId: id,
      orgId: org,
      stored: "5",
      derived: "4",
    });

    // Earlier tests may already have raised events (reconcileAndRecord found an unbalanced
    // transaction), so look only at the events this call creates.
    const known = await existingEventIds();

    const count = await emitFailureEvents(pool, {
      accountsChecked: 3,
      drifts: [drift(orgId, randomUUID()), drift(otherOrg, randomUUID())],
      unbalanced: [],
    });
    expect(count).toBe(2);

    const rows = await pool.query<{
      id: string;
      org_id: string;
      payload: { drifts: { orgId: string }[] };
    }>("SELECT id, org_id, payload FROM outbox_events WHERE type = 'ledger.reconciliation_failed'");
    const created = rows.rows.filter((row) => !known.includes(row.id));
    expect(created).toHaveLength(2);
    expect(created.map((row) => row.org_id).sort()).toEqual([orgId, otherOrg].sort());
    for (const row of created) {
      expect(row.payload.drifts).toHaveLength(1);
      expect(row.payload.drifts[0]?.orgId).toBe(row.org_id);
    }
  });

  it("writes nothing for a clean report", async () => {
    const before = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox_events");
    expect(await emitFailureEvents(pool, { accountsChecked: 2, drifts: [], unbalanced: [] })).toBe(
      0,
    );
    const after = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM outbox_events");
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
