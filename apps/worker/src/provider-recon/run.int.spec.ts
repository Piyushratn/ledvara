import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderEntry } from "./classify.js";
import { reconcileProvider } from "./run.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../../packages/db/migrations");

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

function upPart(file: string): string {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const up = sql.search(/--\s*Up Migration/iu);
  const down = sql.search(/--\s*Down Migration/iu);
  if (up === -1) return sql;
  return sql.slice(up, down === -1 ? undefined : down);
}

interface Fixture {
  orgId: string;
  walletId: string;
}

/** Each test gets its own organization, because earlier tests' payouts stay in the table. */
async function fresh(): Promise<Fixture> {
  const org = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Recon', $1) RETURNING id",
    [`recon-${randomUUID()}`],
  );
  const orgId = org.rows[0]?.id ?? "";
  const wallet = await pool.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, 'wallet', 'wallet', 'wallet') RETURNING id",
    [orgId],
  );
  return { orgId, walletId: wallet.rows[0]?.id ?? "" };
}

async function payout(
  f: Fixture,
  amount: number,
  status: "pending" | "settled" | "failed",
): Promise<string> {
  const txn = await pool.query<{ id: string }>(
    "INSERT INTO transactions (org_id, kind) VALUES ($1, 'payout') RETURNING id",
    [f.orgId],
  );
  const txnId = txn.rows[0]?.id ?? "";
  await pool.query("UPDATE transactions SET status = $2 WHERE id = $1", [txnId, status]);
  const row = await pool.query<{ id: string }>(
    `INSERT INTO payouts (org_id, transaction_id, source_account_id, amount_minor, destination_label)
     VALUES ($1, $2, $3, $4, 'bank') RETURNING id`,
    [f.orgId, txnId, f.walletId, amount],
  );
  return row.rows[0]?.id ?? "";
}

const reported = (
  reference: string,
  amountMinor: string,
  status: "settled" | "failed" = "settled",
): ProviderEntry => ({ providerRef: `prov_${reference}`, reference, amountMinor, status });

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 4 });
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) await pool.query(upPart(file));
});

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe("reconcileProvider", () => {
  it("classifies each payout correctly and stores only the discrepancies", async () => {
    const f = await fresh();
    const good = await payout(f, 1000, "settled");
    const wrongAmount = await payout(f, 500, "settled");
    const absent = await payout(f, 700, "settled");
    const failedOk = await payout(f, 300, "failed");

    const outcome = await reconcileProvider(
      pool,
      () =>
        Promise.resolve([
          reported(good, "1000"),
          reported(wrongAmount, "499"),
          reported(failedOk, "300", "failed"),
          reported("ghost-payout", "55"),
        ]),
      { graceMs: 0 },
    );

    const mine = Object.fromEntries(
      outcome.items.filter((i) => i.orgId === f.orgId).map((i) => [i.payoutId, i.kind]),
    );
    expect(mine).toEqual({
      [good]: "matched",
      [wrongAmount]: "amount_mismatch",
      [absent]: "missing_at_provider",
      [failedOk]: "matched",
    });
    expect(
      outcome.items.some(
        (i) => i.kind === "missing_in_ledger" && i.providerRef === "prov_ghost-payout",
      ),
    ).toBe(true);

    const stored = await pool.query<{
      status: string;
      items: { kind: string; payoutId: string | null }[];
      counts: Record<string, number>;
    }>("SELECT status, items, counts FROM provider_reconciliation_runs WHERE id = $1", [
      outcome.runId,
    ]);
    const row = stored.rows[0];
    expect(row?.status).toBe("ok");
    expect(row?.items.some((i) => i.kind === "matched")).toBe(false);
    expect(row?.items.some((i) => i.payoutId === wrongAmount)).toBe(true);
    expect(row?.counts.missing_in_ledger).toBeGreaterThanOrEqual(1);
  });

  it("leaves young payouts out of the comparison until the grace window has passed", async () => {
    const f = await fresh();
    const id = await payout(f, 900, "settled");
    const wrong = [reported(id, "1")];

    const withGrace = await reconcileProvider(pool, () => Promise.resolve(wrong), {
      graceMs: 3_600_000,
    });
    expect(withGrace.items.some((i) => i.payoutId === id)).toBe(false);
    expect(withGrace.items.some((i) => i.providerRef === `prov_${id}`)).toBe(false);

    const withoutGrace = await reconcileProvider(pool, () => Promise.resolve(wrong), {
      graceMs: 0,
    });
    expect(withoutGrace.items.find((i) => i.payoutId === id)?.kind).toBe("amount_mismatch");
  });

  it("stores an error run when the provider cannot be reached, and rethrows", async () => {
    await expect(
      reconcileProvider(pool, () => Promise.reject(new Error("connection refused")), {
        graceMs: 0,
      }),
    ).rejects.toThrow("connection refused");

    const latest = await pool.query<{ status: string; error: string }>(
      "SELECT status, error FROM provider_reconciliation_runs ORDER BY started_at DESC LIMIT 1",
    );
    expect(latest.rows[0]).toMatchObject({ status: "error", error: "connection refused" });
  });
});
