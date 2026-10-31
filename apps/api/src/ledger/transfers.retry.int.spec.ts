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

async function post(body: unknown, idem: string) {
  const res = await ctx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: "POST",
      url: "/v1/transfers",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": idem },
      payload: body as object,
    });
  return {
    status: res.statusCode,
    replayed: res.headers["idempotent-replayed"],
    body: JSON.parse(res.body) as Record<string, unknown>,
  };
}

async function balance(id: string): Promise<string> {
  const rows = await api.query<{ b: string }>(
    "SELECT balance_minor::text AS b FROM accounts WHERE id = $1",
    [id],
  );
  return rows[0]?.b ?? "";
}

async function transferCount(): Promise<number> {
  const rows = await api.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM transactions WHERE kind = 'transfer' AND id NOT IN (SELECT transaction_id FROM ledger_entries WHERE account_id = $1)",
    [funding],
  );
  return Number(rows[0]?.n);
}

async function account(code: string, type: string, allowNegative = false): Promise<string> {
  const rows = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
    [orgId, code, type, allowNegative],
  );
  return rows[0]?.id ?? "";
}

async function fund(to: string, amount: bigint) {
  const { LedgerService } = await import("./ledger.service.js");
  await ctx.app.get(LedgerService).post({
    orgId,
    kind: "transfer",
    entries: [
      { accountId: funding, direction: "debit", amountMinor: amount },
      { accountId: to, direction: "credit", amountMinor: amount },
    ],
  });
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
  await fund(walletA, 10_000n);
});

describe("retries with one Idempotency-Key", () => {
  it("100 simultaneous duplicates move money exactly once", async () => {
    const body = { fromAccountId: walletA, toAccountId: walletB, amountMinor: 1_000 };
    const results = await Promise.all(Array.from({ length: 100 }, () => post(body, "burst-1")));

    expect(results.every((r) => r.status === 201)).toBe(true);
    for (const r of results) expect(r.body).toEqual(results[0]?.body);
    expect(results.filter((r) => r.replayed === "false")).toHaveLength(1);
    expect(results.filter((r) => r.replayed === "true")).toHaveLength(99);

    expect(await transferCount()).toBe(1);
    expect(await balance(walletA)).toBe("9000");
    expect(await balance(walletB)).toBe("1000");
  });

  it("100 sequential retries after success are all replays", async () => {
    const body = { fromAccountId: walletA, toAccountId: walletB, amountMinor: 250 };
    const first = await post(body, "seq-1");
    expect(first.replayed).toBe("false");
    for (let i = 0; i < 100; i += 1) {
      const again = await post(body, "seq-1");
      expect(again.status).toBe(201);
      expect(again.replayed).toBe("true");
      expect(again.body).toEqual(first.body);
    }
    expect(await transferCount()).toBe(1);
    expect(await balance(walletB)).toBe("250");
  });

  it("the same key with different bodies lets only one request win", async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        post(
          { fromAccountId: walletA, toAccountId: walletB, amountMinor: 100 + (i % 5) },
          "mixed-1",
        ),
      ),
    );
    const created = results.filter((r) => r.status === 201 && r.replayed === "false");
    expect(created).toHaveLength(1);
    for (const r of results) {
      if (r.status === 201) continue;
      expect(r.status).toBe(422);
      expect((r.body.error as { code: string }).code).toBe("idempotency_key_reuse");
    }
    expect(await transferCount()).toBe(1);
  });

  it("a failed attempt does not burn the key", async () => {
    const body = { fromAccountId: walletB, toAccountId: walletA, amountMinor: 500 };
    const failed = await post(body, "retry-after-fail");
    expect(failed.status).toBe(409);
    expect((failed.body.error as { code: string }).code).toBe("insufficient_funds");

    await fund(walletB, 500n);
    const retried = await post(body, "retry-after-fail");
    expect(retried.status).toBe(201);
    expect(retried.replayed).toBe("false");
    expect(await balance(walletB)).toBe("0");
  });
});
