import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let key: string;
let walletA: string;
let walletB: string;
let transferId: string;

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
  await send(
    "/v1/transfers",
    { fromAccountId: funding, toAccountId: walletA, amountMinor: 1000 },
    "fund",
  );
  const t = await send(
    "/v1/transfers",
    { fromAccountId: walletA, toAccountId: walletB, amountMinor: 600 },
    "t1",
  );
  transferId = t.body.id as string;
});

describe("refunds", () => {
  it("refunds part of a transfer and leaves the original settled", async () => {
    const res = await send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 200 }, "r1");
    expect(res.status).toBe(201);
    expect(res.body.remainingMinor).toBe("400");
    expect(await balance(walletA)).toBe("600");
    expect(await balance(walletB)).toBe("400");
    const rows = await api.query<{ status: string }>(
      "SELECT status FROM transactions WHERE id = $1",
      [transferId],
    );
    expect(rows[0]?.status).toBe("settled");
  });

  it("refunds the remainder when no amount is given", async () => {
    await send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 250 }, "r1");
    const res = await send(`/v1/transfers/${transferId}/refunds`, {}, "r2");
    expect(res.status).toBe(201);
    expect(res.body.amountMinor).toBe("350");
    expect(await balance(walletB)).toBe("0");
  });

  it("rejects a refund larger than what remains", async () => {
    await send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 500 }, "r1");
    const res = await send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 101 }, "r2");
    expect(res.status).toBe(422);
    expect((res.body.error as { code: string }).code).toBe("refund_exceeds_original");
  });

  it("rejects a refund once fully refunded", async () => {
    await send(`/v1/transfers/${transferId}/refunds`, {}, "r1");
    const res = await send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 1 }, "r2");
    expect(res.status).toBe(409);
    expect((res.body.error as { code: string }).code).toBe("fully_refunded");
  });

  it("concurrent refunds can never exceed the original amount", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 100 }, `c${i}`),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(6);
    expect(await balance(walletB)).toBe("0");
    expect(await balance(walletA)).toBe("1000");
  });

  it("replays the same refund for the same idempotency key", async () => {
    const first = await send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 100 }, "same");
    const second = await send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 100 }, "same");
    expect(second.body).toEqual(first.body);
    expect(await balance(walletB)).toBe("500");
  });

  it("blocks reversal after a refund and refunds after a reversal", async () => {
    await send(`/v1/transfers/${transferId}/refunds`, { amountMinor: 100 }, "r1");
    const rev = await send(`/v1/transfers/${transferId}/reverse`, {}, "rev1");
    expect(rev.status).toBe(409);
    expect((rev.body.error as { code: string }).code).toBe("has_refunds");

    const t2 = await send(
      "/v1/transfers",
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 50 },
      "t2",
    );
    await send(`/v1/transfers/${t2.body.id as string}/reverse`, {}, "rev2");
    const late = await send(`/v1/transfers/${t2.body.id as string}/refunds`, {}, "r3");
    expect(late.status).toBe(409);
  });

  it("returns 404 for an unknown transfer", async () => {
    const res = await send("/v1/transfers/33333333-3333-4333-8333-333333333333/refunds", {}, "r1");
    expect(res.status).toBe(404);
  });
});
