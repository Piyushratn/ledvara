import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let key: string;
let wallet: string;
let funding: string;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
});

afterAll(async () => {
  await ctx.stop();
});

async function send(method: "GET" | "POST", url: string, body?: unknown, idem?: string) {
  const res = await ctx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: { authorization: `Bearer ${key}`, ...(idem ? { "idempotency-key": idem } : {}) },
      ...(body === undefined ? {} : { payload: body as object }),
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
  funding = await account("funding", "asset", true);
  wallet = await account("wallet_a", "wallet");
  await send(
    "POST",
    "/v1/transfers",
    { fromAccountId: funding, toAccountId: wallet, amountMinor: 1000 },
    "fund",
  );
});

describe("payouts", () => {
  it("holds the money in clearing and leaves the payout pending", async () => {
    const res = await send(
      "POST",
      "/v1/payouts",
      { sourceAccountId: wallet, amountMinor: 400, destinationLabel: "HDFC ****1234" },
      "p1",
    );
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.amountMinor).toBe("400");
    expect(await balance(wallet)).toBe("600");
    const clearing = await api.query<{ b: string }>(
      "SELECT balance_minor::text AS b FROM accounts WHERE code = 'payout_clearing'",
    );
    expect(clearing[0]?.b).toBe("400");

    const got = await send("GET", `/v1/payouts/${res.body.id as string}`);
    expect(got.status).toBe(200);
    expect(got.body.status).toBe("pending");
  });

  it("refuses a payout larger than the wallet balance and holds nothing", async () => {
    const res = await send(
      "POST",
      "/v1/payouts",
      { sourceAccountId: wallet, amountMinor: 1001, destinationLabel: "HDFC ****1234" },
      "p1",
    );
    expect(res.status).toBe(409);
    expect((res.body.error as { code: string }).code).toBe("insufficient_funds");
    expect(await balance(wallet)).toBe("1000");
  });

  it("replays the same payout for the same key and creates one", async () => {
    const body = { sourceAccountId: wallet, amountMinor: 300, destinationLabel: "ICICI ****9876" };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => send("POST", "/v1/payouts", body, "dup")),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await balance(wallet)).toBe("700");
    const rows = await api.query<{ n: string }>("SELECT count(*)::text AS n FROM payouts");
    expect(rows[0]?.n).toBe("1");
  });

  it("only allows payouts from a wallet", async () => {
    const res = await send(
      "POST",
      "/v1/payouts",
      { sourceAccountId: funding, amountMinor: 10, destinationLabel: "X" },
      "p1",
    );
    expect(res.status).toBe(422);
  });

  it("concurrent payouts can never overdraw the wallet", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        send(
          "POST",
          "/v1/payouts",
          { sourceAccountId: wallet, amountMinor: 100, destinationLabel: "HDFC ****1234" },
          `c${i}`,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(await balance(wallet)).toBe("0");
  });

  it("returns 404 for another organization's account", async () => {
    const other = await api.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', 'other') RETURNING id",
    );
    const foreign = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, 'foreign_w', 'F', 'wallet') RETURNING id",
      [other[0]?.id],
    );
    const res = await send(
      "POST",
      "/v1/payouts",
      { sourceAccountId: foreign[0]?.id, amountMinor: 10, destinationLabel: "X" },
      "p1",
    );
    expect(res.status).toBe(404);
  });
});
