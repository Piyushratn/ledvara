import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let key: string;
let walletA: string;
let walletB: string;
let funding: string;

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

async function events(): Promise<{ type: string; published_at: string | null }[]> {
  return api.query("SELECT type, published_at FROM outbox_events ORDER BY created_at, id");
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
  walletA = await account("wallet_a", "wallet");
  walletB = await account("wallet_b", "wallet");
  await send(
    "/v1/transfers",
    { fromAccountId: funding, toAccountId: walletA, amountMinor: 1000 },
    "fund",
  );
  await api.query("DELETE FROM outbox_events").catch(() => undefined);
});

describe("transactional outbox", () => {
  it("writes one unpublished event with each transfer", async () => {
    const t = await send(
      "/v1/transfers",
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 100 },
      "t1",
    );
    const rows = await events();
    expect(rows.at(-1)?.type).toBe("transfer.settled");
    expect(rows.at(-1)?.published_at).toBeNull();
    const payload = await api.query<{ payload: { id: string; amountMinor: string } }>(
      "SELECT payload FROM outbox_events ORDER BY created_at DESC LIMIT 1",
    );
    expect(payload[0]?.payload.id).toBe(t.body.id);
    expect(payload[0]?.payload.amountMinor).toBe("100");
  });

  it("writes no event for a rejected transfer", async () => {
    const before = (await events()).length;
    const res = await send(
      "/v1/transfers",
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 999999 },
      "big",
    );
    expect(res.status).toBe(409);
    expect((await events()).length).toBe(before);
  });

  it("writes exactly one event for 20 duplicate requests", async () => {
    const before = (await events()).length;
    const body = { fromAccountId: walletA, toAccountId: walletB, amountMinor: 50 };
    await Promise.all(Array.from({ length: 20 }, () => send("/v1/transfers", body, "dup")));
    expect((await events()).length).toBe(before + 1);
  });

  it("emits events for reversals, refunds and payouts", async () => {
    const t1 = await send(
      "/v1/transfers",
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 200 },
      "a",
    );
    await send(`/v1/transfers/${t1.body.id as string}/reverse`, {}, "rev");
    const t2 = await send(
      "/v1/transfers",
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 100 },
      "b",
    );
    await send(`/v1/transfers/${t2.body.id as string}/refunds`, { amountMinor: 40 }, "ref");
    await send(
      "/v1/payouts",
      { sourceAccountId: walletA, amountMinor: 100, destinationLabel: "HDFC ****1234" },
      "po",
    );
    const types = (await events()).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "transfer.settled",
        "transfer.reversed",
        "refund.created",
        "payout.created",
      ]),
    );
  });

  it("rolls the event back together with the ledger change", async () => {
    const before = (await events()).length;
    // A payout from a non-wallet fails after validation; nothing may be left behind.
    const res = await send(
      "/v1/payouts",
      { sourceAccountId: funding, amountMinor: 10, destinationLabel: "X" },
      "bad",
    );
    expect(res.status).toBe(422);
    expect((await events()).length).toBe(before);
  });
});
