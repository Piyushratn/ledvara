import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let accountA: string;
let accountB: string;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
});

afterAll(async () => {
  await ctx.stop();
});

beforeEach(async () => {
  await ctx.reset();
  const org = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id",
  );
  orgId = org[0]?.id ?? "";
  const a = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, 'acct_a', 'A', 'asset', true) RETURNING id",
    [orgId],
  );
  const b = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, 'acct_b', 'B', 'liability', true) RETURNING id",
    [orgId],
  );
  accountA = a[0]?.id ?? "";
  accountB = b[0]?.id ?? "";
});

/** Runs inserts in one real DB transaction, like the posting service will. */
async function post(entries: { account: string; direction: "debit" | "credit"; amount: number }[]) {
  const client = await ctx.pool.connect();
  try {
    await client.query("BEGIN");
    const txn = await client.query<{ id: string }>(
      "INSERT INTO transactions (org_id, kind) VALUES ($1, 'transfer') RETURNING id",
      [orgId],
    );
    const txnId = txn.rows[0]?.id;
    for (const entry of entries) {
      await client.query(
        "INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor) VALUES ($1, $2, $3, $4, $5)",
        [txnId, orgId, entry.account, entry.direction, entry.amount],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function entryCount(): Promise<number> {
  const rows = await api.query<{ count: string }>("SELECT count(*) FROM ledger_entries");
  return Number(rows[0]?.count);
}

describe("zero-sum rule enforced by the database", () => {
  it("commits a balanced transaction", async () => {
    await post([
      { account: accountA, direction: "debit", amount: 500 },
      { account: accountB, direction: "credit", amount: 500 },
    ]);
    expect(await entryCount()).toBe(2);
  });

  it("commits a balanced transaction with three entries", async () => {
    await post([
      { account: accountA, direction: "debit", amount: 500 },
      { account: accountB, direction: "credit", amount: 450 },
      { account: accountB, direction: "credit", amount: 50 },
    ]);
    expect(await entryCount()).toBe(3);
  });

  it("rejects an unbalanced transaction at commit and stores nothing", async () => {
    await expect(
      post([
        { account: accountA, direction: "debit", amount: 500 },
        { account: accountB, direction: "credit", amount: 400 },
      ]),
    ).rejects.toThrow(/unbalanced/u);
    expect(await entryCount()).toBe(0);
  });

  it("rejects a transaction with a single entry", async () => {
    await expect(post([{ account: accountA, direction: "debit", amount: 500 }])).rejects.toThrow(
      /at least 2 entries/u,
    );
    expect(await entryCount()).toBe(0);
  });

  it("rejects zero and negative amounts", async () => {
    await expect(
      post([
        { account: accountA, direction: "debit", amount: 0 },
        { account: accountB, direction: "credit", amount: 0 },
      ]),
    ).rejects.toThrow(/amount_minor/u);
    await expect(
      post([
        { account: accountA, direction: "debit", amount: -5 },
        { account: accountB, direction: "credit", amount: -5 },
      ]),
    ).rejects.toThrow(/amount_minor/u);
  });

  it("rejects an entry pointing at another organization's account", async () => {
    const other = await api.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', 'other') RETURNING id",
    );
    const foreign = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, 'acct_x', 'X', 'asset') RETURNING id",
      [other[0]?.id],
    );
    await expect(
      post([
        { account: accountA, direction: "debit", amount: 500 },
        { account: foreign[0]?.id ?? "", direction: "credit", amount: 500 },
      ]),
    ).rejects.toThrow(/org mismatch/u);
  });
});
