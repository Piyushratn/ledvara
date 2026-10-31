import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let funding: string;
let walletA: string;
let walletB: string;
let writeKey: string;
let readKey: string;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
});

afterAll(async () => {
  await ctx.stop();
});

async function account(code: string, type: string, allowNegative = false): Promise<string> {
  const rows = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
    [orgId, code, type, allowNegative],
  );
  return rows[0]?.id ?? "";
}

async function post(token: string, body: unknown, key?: string) {
  const res = await ctx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: "POST",
      url: "/v1/transfers",
      headers: {
        authorization: `Bearer ${token}`,
        ...(key ? { "idempotency-key": key } : {}),
      },
      payload: body as object,
    });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

beforeEach(async () => {
  await ctx.reset();
  await api.signUpVerified("alice@example.com");
  const alice = await api.session("alice@example.com");
  const org = await api.call("POST", "/v1/orgs", {
    token: alice.accessToken,
    body: { name: "Acme", slug: "acme" },
  });
  orgId = org.body.id as string;
  const w = await api.call("POST", `/v1/orgs/${orgId}/api-keys`, {
    token: alice.accessToken,
    body: { name: "w", scopes: ["ledger:write", "ledger:read"] },
  });
  const r = await api.call("POST", `/v1/orgs/${orgId}/api-keys`, {
    token: alice.accessToken,
    body: { name: "r", scopes: ["ledger:read"] },
  });
  writeKey = w.body.key as string;
  readKey = r.body.key as string;

  funding = await account("platform_funds", "asset", true);
  walletA = await account("wallet_a", "wallet");
  walletB = await account("wallet_b", "wallet");
  // Fund wallet A with 1000 paise.
  await api.query(
    `WITH t AS (INSERT INTO transactions (org_id, kind, status) VALUES ($1::uuid, 'transfer', 'settled') RETURNING id)
     INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor)
     SELECT t.id, $1::uuid, $2::uuid, 'debit', 1000 FROM t
     UNION ALL
     SELECT t.id, $1::uuid, $3::uuid, 'credit', 1000 FROM t`,
    [orgId, funding, walletA],
  );
  await api.query("UPDATE accounts SET balance_minor = 1000 WHERE id IN ($1, $2)", [
    funding,
    walletA,
  ]);
});

describe("POST /v1/transfers", () => {
  it("requires an API key and an Idempotency-Key", async () => {
    const body = { fromAccountId: walletA, toAccountId: walletB, amountMinor: 100 };
    expect((await post("lv_test_nope", body, "k")).status).toBe(401);
    const missing = await post(writeKey, body);
    expect(missing.status).toBe(400);
    expect((missing.body.error as { code: string }).code).toBe("idempotency_key_required");
  });

  it("needs the ledger:write scope", async () => {
    const res = await post(
      readKey,
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 100 },
      "k1",
    );
    expect(res.status).toBe(403);
  });

  it("moves money, settles, and returns string amounts", async () => {
    const res = await post(
      writeKey,
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 400 },
      "k1",
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("settled");
    expect(res.body.amountMinor).toBe("400");
    const rows = await api.query<{ id: string; balance_minor: string }>(
      "SELECT id, balance_minor::text FROM accounts WHERE id IN ($1, $2)",
      [walletA, walletB],
    );
    const bal = Object.fromEntries(rows.map((r) => [r.id, r.balance_minor]));
    expect(bal[walletA]).toBe("600");
    expect(bal[walletB]).toBe("400");
  });

  it("returns the same response for a retry and moves money once", async () => {
    const body = { fromAccountId: walletA, toAccountId: walletB, amountMinor: 400 };
    const first = await post(writeKey, body, "retry-1");
    const second = await post(writeKey, body, "retry-1");
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    const count = await api.query<{ count: string }>(
      "SELECT count(*) FROM transactions WHERE kind = 'transfer' AND reference IS NULL AND status = 'settled'",
    );
    expect(Number(count[0]?.count)).toBe(2); // the funding row plus this one
  });

  it("returns 422 when the key is reused with a different body", async () => {
    await post(writeKey, { fromAccountId: walletA, toAccountId: walletB, amountMinor: 100 }, "dup");
    const res = await post(
      writeKey,
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 200 },
      "dup",
    );
    expect(res.status).toBe(422);
    expect((res.body.error as { code: string }).code).toBe("idempotency_key_reuse");
  });

  it("refuses an overdraft with 409 and leaves balances alone", async () => {
    const res = await post(
      writeKey,
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 1001 },
      "big",
    );
    expect(res.status).toBe(409);
    expect((res.body.error as { code: string }).code).toBe("insufficient_funds");
    const rows = await api.query<{ balance_minor: string }>(
      "SELECT balance_minor::text FROM accounts WHERE id = $1",
      [walletA],
    );
    expect(rows[0]?.balance_minor).toBe("1000");
  });

  it("rejects floats and non-positive amounts with 422", async () => {
    for (const amountMinor of [1.5, 0, -1]) {
      const res = await post(
        writeKey,
        { fromAccountId: walletA, toAccountId: walletB, amountMinor },
        `bad-${amountMinor}`,
      );
      expect(res.status).toBe(422);
    }
  });

  it("cannot move money in another organization's accounts", async () => {
    const other = await api.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', 'other') RETURNING id",
    );
    const foreign = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, 'foreign_w', 'F', 'wallet') RETURNING id",
      [other[0]?.id],
    );
    const res = await post(
      writeKey,
      { fromAccountId: walletA, toAccountId: foreign[0]?.id, amountMinor: 10 },
      "x",
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/transfers/:id", () => {
  it("returns a transfer to a read key", async () => {
    const made = await post(
      writeKey,
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 50 },
      "g1",
    );
    const id = made.body.id as string;
    const ok = await api.call("GET", `/v1/transfers/${id}`, { token: readKey });
    expect(ok.status).toBe(200);
    expect(ok.body.amountMinor).toBe("50");
  });

  it("returns 404 for an unknown id", async () => {
    const res = await api.call("GET", "/v1/transfers/33333333-3333-4333-8333-333333333333", {
      token: readKey,
    });
    expect(res.status).toBe(404);
  });
});
