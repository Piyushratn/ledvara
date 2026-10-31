import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let key: string;
let walletA: string;
let walletB: string;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
});

afterAll(async () => {
  await ctx.stop();
});

async function send(url: string, body: unknown, idem: string) {
  const res = await ctx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${key}`, "idempotency-key": idem },
      payload: body as object,
    });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

async function balance(id: string): Promise<string> {
  const rows = await api.query<{ b: string }>(
    "SELECT balance_minor::text AS b FROM accounts WHERE id = $1",
    [id],
  );
  return rows[0]?.b ?? "";
}

async function account(code: string, type: string, allowNegative = false): Promise<string> {
  const rows = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
    [orgId, code, type, allowNegative],
  );
  return rows[0]?.id ?? "";
}

async function transfer(from: string, to: string, amount: number, idem: string): Promise<string> {
  const res = await send(
    "/v1/transfers",
    { fromAccountId: from, toAccountId: to, amountMinor: amount },
    idem,
  );
  expect(res.status).toBe(201);
  return res.body.id as string;
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
  const k = await api.call("POST", `/v1/orgs/${orgId}/api-keys`, {
    token: alice.accessToken,
    body: { name: "k", scopes: ["ledger:write", "ledger:read"] },
  });
  key = k.body.key as string;
  const funding = await account("funding", "asset", true);
  walletA = await account("wallet_a", "wallet");
  walletB = await account("wallet_b", "wallet");
  await transfer(funding, walletA, 1000, "fund");
});

describe("reversals", () => {
  it("restores balances, links the reversal and marks the original reversed", async () => {
    const id = await transfer(walletA, walletB, 400, "t1");
    const res = await send(`/v1/transfers/${id}/reverse`, {}, "r1");
    expect(res.status).toBe(201);
    expect(res.body.reversesId).toBe(id);
    expect(await balance(walletA)).toBe("1000");
    expect(await balance(walletB)).toBe("0");
    const rows = await api.query<{ status: string }>(
      "SELECT status FROM transactions WHERE id = $1",
      [id],
    );
    expect(rows[0]?.status).toBe("reversed");
  });

  it("cannot reverse twice", async () => {
    const id = await transfer(walletA, walletB, 400, "t1");
    await send(`/v1/transfers/${id}/reverse`, {}, "r1");
    const again = await send(`/v1/transfers/${id}/reverse`, {}, "r2");
    expect(again.status).toBe(409);
    expect((again.body.error as { code: string }).code).toBe("already_reversed");
  });

  it("two simultaneous reversals produce exactly one reversal", async () => {
    const id = await transfer(walletA, walletB, 400, "t1");
    const results = await Promise.all([
      send(`/v1/transfers/${id}/reverse`, {}, "ra"),
      send(`/v1/transfers/${id}/reverse`, {}, "rb"),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const rows = await api.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM transactions WHERE kind = 'reversal'",
    );
    expect(rows[0]?.n).toBe("1");
    expect(await balance(walletA)).toBe("1000");
  });

  it("replays the same response for the same idempotency key", async () => {
    const id = await transfer(walletA, walletB, 400, "t1");
    const first = await send(`/v1/transfers/${id}/reverse`, {}, "same");
    const second = await send(`/v1/transfers/${id}/reverse`, {}, "same");
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
  });

  it("fails when the receiver already spent the money, changing nothing", async () => {
    const id = await transfer(walletA, walletB, 400, "t1");
    const funding = await account("other", "wallet");
    await transfer(walletB, funding, 300, "spend");
    const res = await send(`/v1/transfers/${id}/reverse`, {}, "r1");
    expect(res.status).toBe(409);
    expect((res.body.error as { code: string }).code).toBe("insufficient_funds");
    const rows = await api.query<{ status: string }>(
      "SELECT status FROM transactions WHERE id = $1",
      [id],
    );
    expect(rows[0]?.status).toBe("settled");
  });

  it("returns 404 for an unknown transfer", async () => {
    const res = await send("/v1/transfers/33333333-3333-4333-8333-333333333333/reverse", {}, "r1");
    expect(res.status).toBe(404);
  });
});
