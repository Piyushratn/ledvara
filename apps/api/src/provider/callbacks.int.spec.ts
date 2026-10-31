import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";
import { signPayload } from "./signature.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let key: string;
let wallet: string;
let payoutId: string;
const SECRET = "sim-dev-callback-secret";

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

async function callback(event: object, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(event);
  const res = await ctx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: "POST",
      url: "/v1/provider/callbacks",
      headers: {
        "content-type": "application/json",
        "x-provider-signature": signPayload(secret, raw, timestamp),
      },
      payload: raw,
    });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

function evt(type: string, sequence: 1 | 2, eventId: string, amount = "400") {
  return {
    eventId,
    payoutRef: "prov_abc",
    reference: payoutId,
    type,
    sequence,
    amountMinor: amount,
    occurredAt: new Date().toISOString(),
  };
}

async function balance(code: string): Promise<string> {
  const rows = await api.query<{ b: string }>(
    "SELECT balance_minor::text AS b FROM accounts WHERE code = $1",
    [code],
  );
  return rows[0]?.b ?? "";
}

async function status(): Promise<string> {
  const rows = await api.query<{ s: string }>(
    "SELECT t.status AS s FROM payouts p JOIN transactions t ON t.id = p.transaction_id WHERE p.id = $1",
    [payoutId],
  );
  return rows[0]?.s ?? "";
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
  const fundingRows = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, 'funding', 'F', 'asset', true) RETURNING id",
    [orgId],
  );
  const walletRows = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, 'wallet_a', 'W', 'wallet') RETURNING id",
    [orgId],
  );
  wallet = walletRows[0]?.id ?? "";
  await send(
    "POST",
    "/v1/transfers",
    { fromAccountId: fundingRows[0]?.id, toAccountId: wallet, amountMinor: 1000 },
    "fund",
  );
  const p = await send(
    "POST",
    "/v1/payouts",
    { sourceAccountId: wallet, amountMinor: 400, destinationLabel: "HDFC ****1234" },
    "p1",
  );
  payoutId = p.body.id as string;
});

describe("provider callbacks", () => {
  it("rejects bad signatures and stale timestamps", async () => {
    const e = evt("payout.settled", 2, "e1");
    expect((await callback(e, "wrong-secret-value")).status).toBe(401);
    expect((await callback(e, SECRET, Math.floor(Date.now() / 1000) - 1000)).status).toBe(401);
    expect(await status()).toBe("pending");
  });

  it("settles a payout: clearing is emptied into provider settlement", async () => {
    const res = await callback(evt("payout.settled", 2, "e1"));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("applied");
    expect(await status()).toBe("settled");
    expect(await balance("payout_clearing")).toBe("0");
    expect(await balance("provider_settlement")).toBe("400");
    expect(await balance("wallet_a")).toBe("600");
  });

  it("returns the money to the wallet when the payout fails", async () => {
    await callback(evt("payout.failed", 2, "e1"));
    expect(await status()).toBe("failed");
    expect(await balance("wallet_a")).toBe("1000");
    expect(await balance("payout_clearing")).toBe("0");
  });

  it("applies a duplicated final event exactly once", async () => {
    const e = evt("payout.settled", 2, "dup-1");
    const results = await Promise.all(Array.from({ length: 10 }, () => callback(e)));
    expect(results.filter((r) => r.body.outcome === "applied")).toHaveLength(1);
    expect(results.filter((r) => r.body.outcome === "duplicate")).toHaveLength(9);
    expect(await balance("provider_settlement")).toBe("400");
  });

  it("handles the final event arriving before the processing event", async () => {
    await callback(evt("payout.settled", 2, "e2"));
    const late = await callback(evt("payout.processing", 1, "e1"));
    expect(late.body.outcome).toBe("ignored");
    expect(await status()).toBe("settled");
    expect(await balance("provider_settlement")).toBe("400");
  });

  it("never lets a contradicting final event change a settled payout", async () => {
    await callback(evt("payout.settled", 2, "e1"));
    const res = await callback(evt("payout.failed", 2, "e2"));
    expect(res.body.outcome).toBe("conflict");
    expect(await status()).toBe("settled");
    expect(await balance("wallet_a")).toBe("600");
  });

  it("flags an amount mismatch and changes nothing", async () => {
    const res = await callback(evt("payout.settled", 2, "e1", "999"));
    expect(res.body.outcome).toBe("conflict");
    expect(await status()).toBe("pending");
  });

  it("records events for unknown payouts without failing", async () => {
    const e = {
      ...evt("payout.settled", 2, "e9"),
      reference: "11111111-1111-4111-8111-111111111111",
    };
    expect((await callback(e)).body.outcome).toBe("unknown_payout");
  });
});
