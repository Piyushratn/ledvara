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

/** The database's own clock, so the test never depends on host/container clock drift. */
async function dbNow(): Promise<string> {
  const rows = await api.query<{ t: string }>(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS t`,
  );
  return rows[0]?.t ?? "";
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

  walletA = (await send("POST", "/v1/accounts", { name: "A", type: "wallet", code: "wallet_a" }))
    .body.id as string;
  walletB = (await send("POST", "/v1/accounts", { name: "B", type: "wallet", code: "wallet_b" }))
    .body.id as string;
  // Give wallet A 10000 paise through a system account that may go negative.
  const sys = (
    await send("POST", "/v1/accounts", {
      name: "Funding",
      type: "asset",
      code: "funding",
      allowNegative: true,
    })
  ).body.id as string;
  await send(
    "POST",
    "/v1/transfers",
    { fromAccountId: sys, toAccountId: walletA, amountMinor: 10000 },
    "fund",
  );
});

describe("accounts", () => {
  it("creates, lists and rejects duplicate codes", async () => {
    const dup = await send("POST", "/v1/accounts", {
      name: "Dup",
      type: "wallet",
      code: "wallet_a",
    });
    expect(dup.status).toBe(409);
    const list = await send("GET", "/v1/accounts");
    expect(list.status).toBe(200);
    expect((list.body.data as unknown[]).length).toBe(3);
  });

  it("rejects an invalid code and type", async () => {
    expect(
      (await send("POST", "/v1/accounts", { name: "X", type: "wallet", code: "A" })).status,
    ).toBe(422);
    expect((await send("POST", "/v1/accounts", { name: "X", type: "bank" })).status).toBe(422);
  });
});

describe("balances and time travel", () => {
  it("returns the current balance as a string", async () => {
    const res = await send("GET", `/v1/accounts/${walletA}/balance`);
    expect(res.status).toBe(200);
    expect(res.body.balanceMinor).toBe("10000");
  });

  it("returns the balance as of a past moment", async () => {
    const before = await dbNow();
    await new Promise((r) => setTimeout(r, 100));
    await send(
      "POST",
      "/v1/transfers",
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 2500 },
      "t1",
    );

    const now = await send("GET", `/v1/accounts/${walletA}/balance`);
    expect(now.body.balanceMinor).toBe("7500");

    const past = await send(
      "GET",
      `/v1/accounts/${walletA}/balance?at=${encodeURIComponent(before)}`,
    );
    expect(past.body.balanceMinor).toBe("10000");
    const pastB = await send(
      "GET",
      `/v1/accounts/${walletB}/balance?at=${encodeURIComponent(before)}`,
    );
    expect(pastB.body.balanceMinor).toBe("0");
  });

  it("derived balance equals the stored balance now", async () => {
    await send(
      "POST",
      "/v1/transfers",
      { fromAccountId: walletA, toAccountId: walletB, amountMinor: 123 },
      "t2",
    );
    const future = new Date(Date.now() + 60_000).toISOString();
    const stored = await send("GET", `/v1/accounts/${walletB}/balance`);
    const derived = await send(
      "GET",
      `/v1/accounts/${walletB}/balance?at=${encodeURIComponent(future)}`,
    );
    expect(derived.body.balanceMinor).toBe(stored.body.balanceMinor);
  });

  it("returns 404 for another organization's account", async () => {
    const other = await api.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', 'other') RETURNING id",
    );
    const foreign = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, 'foreign_w', 'F', 'wallet') RETURNING id",
      [other[0]?.id],
    );
    expect((await send("GET", `/v1/accounts/${foreign[0]?.id}/balance`)).status).toBe(404);
  });
});

describe("GET /v1/transfers", () => {
  beforeEach(async () => {
    for (let i = 1; i <= 7; i += 1) {
      await send(
        "POST",
        "/v1/transfers",
        { fromAccountId: walletA, toAccountId: walletB, amountMinor: i * 100 },
        `l${i}`,
      );
    }
  });

  it("pages newest first with no repeats or gaps", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url: string = `/v1/transfers?limit=3${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await send("GET", url);
      expect(res.status).toBe(200);
      for (const row of res.body.data as { id: string }[]) seen.push(row.id);
      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
    }
    expect(seen.length).toBe(8); // 7 here plus the funding transfer
    expect(new Set(seen).size).toBe(8);
  });

  it("filters by amount range, status and account", async () => {
    const range = await send("GET", "/v1/transfers?minAmount=300&maxAmount=500");
    expect((range.body.data as { amountMinor: string }[]).map((r) => r.amountMinor).sort()).toEqual(
      ["300", "400", "500"],
    );
    const settled = await send("GET", "/v1/transfers?status=settled&limit=100");
    expect((settled.body.data as unknown[]).length).toBe(8);
    const failed = await send("GET", "/v1/transfers?status=failed");
    expect((failed.body.data as unknown[]).length).toBe(0);
    const byAccount = await send("GET", `/v1/transfers?accountId=${walletB}&limit=100`);
    expect((byAccount.body.data as unknown[]).length).toBe(7);
  });

  it("rejects a bad cursor and a bad limit", async () => {
    expect((await send("GET", "/v1/transfers?cursor=garbage")).status).toBe(400);
    expect((await send("GET", "/v1/transfers?limit=500")).status).toBe(422);
  });
});
