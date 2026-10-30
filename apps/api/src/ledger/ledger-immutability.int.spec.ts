import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let txnId: string;
let orgId: string;

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
  const client = await ctx.pool.connect();
  try {
    await client.query("BEGIN");
    const txn = await client.query<{ id: string }>(
      "INSERT INTO transactions (org_id, kind, reference) VALUES ($1, 'transfer', 'ref-1') RETURNING id",
      [orgId],
    );
    txnId = txn.rows[0]?.id ?? "";
    await client.query(
      "INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor) VALUES ($1, $2, $3, 'debit', 500), ($1, $2, $4, 'credit', 500)",
      [txnId, orgId, a[0]?.id, b[0]?.id],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
});

describe("ledger tables are append-only", () => {
  it("rejects UPDATE on ledger_entries", async () => {
    await expect(api.query("UPDATE ledger_entries SET amount_minor = 1")).rejects.toThrow(
      /append-only/u,
    );
    await expect(api.query("UPDATE ledger_entries SET direction = 'credit'")).rejects.toThrow(
      /append-only/u,
    );
  });

  it("rejects DELETE on ledger_entries and transactions", async () => {
    await expect(api.query("DELETE FROM ledger_entries")).rejects.toThrow(/append-only/u);
    await expect(api.query("DELETE FROM transactions")).rejects.toThrow(/append-only/u);
  });

  it("rejects TRUNCATE without the test opt-in", async () => {
    await expect(api.query("TRUNCATE ledger_entries")).rejects.toThrow(/append-only/u);
    await expect(api.query("TRUNCATE transactions CASCADE")).rejects.toThrow(/append-only/u);
  });

  it("rejects deleting an account or organization that has history", async () => {
    await expect(api.query("DELETE FROM accounts")).rejects.toThrow();
    await expect(api.query("DELETE FROM organizations")).rejects.toThrow();
  });

  it("allows status changes on a transaction but nothing else", async () => {
    await api.query("UPDATE transactions SET status = 'pending' WHERE id = $1", [txnId]);
    const rows = await api.query<{ status: string }>(
      "SELECT status FROM transactions WHERE id = $1",
      [txnId],
    );
    expect(rows[0]?.status).toBe("pending");

    await expect(
      api.query("UPDATE transactions SET reference = 'tampered' WHERE id = $1", [txnId]),
    ).rejects.toThrow(/only status may change/u);
    await expect(
      api.query("UPDATE transactions SET kind = 'payout' WHERE id = $1", [txnId]),
    ).rejects.toThrow(/only status may change/u);
    await expect(
      api.query("UPDATE transactions SET created_at = now() - interval '1 day' WHERE id = $1", [
        txnId,
      ]),
    ).rejects.toThrow(/only status may change/u);
  });

  it("keeps the entries intact after every attempt", async () => {
    await api.query("UPDATE ledger_entries SET amount_minor = 1").catch(() => undefined);
    await api.query("DELETE FROM ledger_entries").catch(() => undefined);
    const rows = await api.query<{ amount_minor: string }>(
      "SELECT amount_minor FROM ledger_entries ORDER BY seq",
    );
    expect(rows.map((r) => r.amount_minor)).toEqual(["500", "500"]);
  });
});
