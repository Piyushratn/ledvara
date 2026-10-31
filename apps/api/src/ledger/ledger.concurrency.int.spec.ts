import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let ledger: import("./ledger.service.js").LedgerService;
let orgId: string;
let funding: string;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
  const { LedgerService } = await import("./ledger.service.js");
  ledger = ctx.app.get(LedgerService);
});

afterAll(async () => {
  await ctx.stop();
});

async function wallet(code: string, startingPaise: bigint): Promise<string> {
  const rows = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, $2, $2, 'wallet') RETURNING id",
    [orgId, code],
  );
  const id = rows[0]?.id ?? "";
  if (startingPaise > 0n) {
    await ledger.post({
      orgId,
      kind: "transfer",
      entries: [
        { accountId: funding, direction: "debit", amountMinor: startingPaise },
        { accountId: id, direction: "credit", amountMinor: startingPaise },
      ],
    });
  }
  return id;
}

async function balance(id: string): Promise<bigint> {
  const rows = await api.query<{ b: string }>(
    "SELECT balance_minor::text AS b FROM accounts WHERE id = $1",
    [id],
  );
  return BigInt(rows[0]?.b ?? "0");
}

function move(from: string, to: string, amount: bigint) {
  return ledger.post({
    orgId,
    kind: "transfer",
    entries: [
      { accountId: from, direction: "debit", amountMinor: amount },
      { accountId: to, direction: "credit", amountMinor: amount },
    ],
  });
}

beforeEach(async () => {
  await ctx.reset();
  const org = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id",
  );
  orgId = org[0]?.id ?? "";
  const f = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, 'funding', 'Funding', 'asset', true) RETURNING id",
    [orgId],
  );
  funding = f[0]?.id ?? "";
});

describe("concurrent postings", () => {
  it("100 parallel transfers from one wallet never overdraw it", async () => {
    const source = await wallet("source", 4_000n); // enough for exactly 40 x 100
    const sink = await wallet("sink", 0n);

    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () => move(source, sink, 100n)),
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(40);
    expect(failed).toHaveLength(60);
    for (const f of failed) {
      expect((f.reason as { code?: string }).code).toBe("insufficient_funds");
    }

    expect(await balance(source)).toBe(0n);
    expect(await balance(sink)).toBe(4_000n);

    const entries = await api.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM ledger_entries e JOIN accounts a ON a.id = e.account_id WHERE a.code = 'source' AND e.direction = 'debit'",
    );
    expect(entries[0]?.n).toBe("40");
  });

  it("opposing transfers between two wallets do not deadlock and conserve money", async () => {
    const a = await wallet("wallet_a", 5_000n);
    const b = await wallet("wallet_b", 5_000n);

    const results = await Promise.allSettled(
      Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? move(a, b, 7n) : move(b, a, 3n))),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    // 30 x 7 out of A, 30 x 3 into A.
    expect(await balance(a)).toBe(5_000n - 210n + 90n);
    expect(await balance(b)).toBe(5_000n + 210n - 90n);
    expect((await balance(a)) + (await balance(b))).toBe(10_000n);
  });

  it("many wallets paying one wallet at once credits every payment exactly once", async () => {
    const sink = await wallet("sink", 0n);
    const payers: string[] = [];
    for (let i = 0; i < 20; i += 1) payers.push(await wallet(`payer_${i}`, 500n));

    const results = await Promise.allSettled(payers.map((p) => move(p, sink, 500n)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await balance(sink)).toBe(10_000n);
    for (const p of payers) expect(await balance(p)).toBe(0n);
  });

  it("ledger totals still balance after the concurrent runs", async () => {
    const source = await wallet("source", 1_000n);
    const sink = await wallet("sink", 0n);
    await Promise.allSettled(Array.from({ length: 50 }, () => move(source, sink, 60n)));

    const totals = await api.query<{ d: string; c: string }>(
      `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE direction='debit'),0)::text AS d,
              COALESCE(SUM(amount_minor) FILTER (WHERE direction='credit'),0)::text AS c
         FROM ledger_entries`,
    );
    expect(totals[0]?.d).toBe(totals[0]?.c);
    expect(await balance(source)).toBeGreaterThanOrEqual(0n);
    expect((await balance(source)) + (await balance(sink))).toBe(1_000n);
  });
});
