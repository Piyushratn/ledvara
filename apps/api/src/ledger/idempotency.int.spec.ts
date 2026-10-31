import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let a: string;
let b: string;
let svc: import("./idempotency.service.js").IdempotencyService;
let ledger: import("./ledger.service.js").LedgerService;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
  const { IdempotencyService } = await import("./idempotency.service.js");
  const { LedgerService } = await import("./ledger.service.js");
  svc = ctx.app.get(IdempotencyService);
  ledger = ctx.app.get(LedgerService);
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
  const x = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, 'acct_a', 'A', 'asset', true) RETURNING id",
    [orgId],
  );
  const y = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, 'acct_b', 'B', 'liability', true) RETURNING id",
    [orgId],
  );
  a = x[0]?.id ?? "";
  b = y[0]?.id ?? "";
});

function move(key: string, hash: string, amount = 100n) {
  return svc.run(orgId, key, hash, async (tx) => {
    const txn = await ledger.post(
      {
        orgId,
        kind: "transfer",
        entries: [
          { accountId: a, direction: "debit", amountMinor: amount },
          { accountId: b, direction: "credit", amountMinor: amount },
        ],
      },
      tx,
    );
    return { status: 201, body: { id: txn.id } };
  });
}

async function txnCount(): Promise<number> {
  const rows = await api.query<{ count: string }>("SELECT count(*) FROM transactions");
  return Number(rows[0]?.count);
}

describe("idempotency", () => {
  it("replays the original response for the same key and body", async () => {
    const first = await move("k1", "h1");
    const second = await move("k1", "h1");
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual(first.body);
    expect(await txnCount()).toBe(1);
  });

  it("rejects the same key with a different body", async () => {
    await move("k1", "h1");
    await expect(move("k1", "h2")).rejects.toMatchObject({ code: "idempotency_key_reuse" });
    expect(await txnCount()).toBe(1);
  });

  it("moves money exactly once for 50 concurrent duplicates", async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => move("burst", "h1")));
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(await txnCount()).toBe(1);
    const rows = await api.query<{ balance_minor: string }>(
      "SELECT balance_minor FROM accounts WHERE id = $1",
      [b],
    );
    expect(rows[0]?.balance_minor).toBe("100");
  });

  it("lets the key be reused after a failed attempt rolled back", async () => {
    await expect(
      svc.run(orgId, "k2", "h1", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    const retry = await move("k2", "h1");
    expect(retry.replayed).toBe(false);
  });

  it("scopes keys to the organization", async () => {
    const other = await api.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', 'other') RETURNING id",
    );
    await move("shared", "h1");
    const result = await svc.run(other[0]?.id ?? "", "shared", "h9", () =>
      Promise.resolve({ status: 200, body: { ok: true } }),
    );
    expect(result.replayed).toBe(false);
  });
});
