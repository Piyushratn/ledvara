import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let ledger: import("./ledger.service.js").LedgerService;

const WALLETS = 5;
const RUNS = 100;
const COMMANDS = 60;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
  const { LedgerService } = await import("./ledger.service.js");
  ledger = ctx.app.get(LedgerService);
});

afterAll(async () => {
  await ctx.stop();
});

interface Cmd {
  from: number;
  to: number;
  amount: number;
}

const cmdArb = fc.record({
  from: fc.integer({ min: 0, max: WALLETS - 1 }),
  to: fc.integer({ min: 0, max: WALLETS - 1 }),
  // A mix of tiny, typical and large amounts so overdrafts happen regularly.
  amount: fc.oneof(
    fc.integer({ min: 1, max: 50 }),
    fc.integer({ min: 1, max: 5_000 }),
    fc.integer({ min: 1, max: 1_000_000_000 }),
  ),
});

async function setup(): Promise<{ orgId: string; wallets: string[]; funding: string }> {
  await ctx.reset();
  const org = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id",
  );
  const orgId = org[0]?.id ?? "";
  const fundingRow = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, 'funding', 'Funding', 'asset', true) RETURNING id",
    [orgId],
  );
  const funding = fundingRow[0]?.id ?? "";
  const wallets: string[] = [];
  for (let i = 0; i < WALLETS; i += 1) {
    const row = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, $2, $2, 'wallet') RETURNING id",
      [orgId, `wallet_${i}`],
    );
    wallets.push(row[0]?.id ?? "");
  }
  // Seed every wallet with 10,000 paise from the funding account.
  for (const wallet of wallets) {
    await ledger.post({
      orgId,
      kind: "transfer",
      entries: [
        { accountId: funding, direction: "debit", amountMinor: 10_000n },
        { accountId: wallet, direction: "credit", amountMinor: 10_000n },
      ],
    });
  }
  return { orgId, wallets, funding };
}

async function assertInvariants(): Promise<void> {
  const totals = await api.query<{ debits: string; credits: string }>(
    `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE direction='debit'),0)::text AS debits,
            COALESCE(SUM(amount_minor) FILTER (WHERE direction='credit'),0)::text AS credits
       FROM ledger_entries`,
  );
  expect(totals[0]?.debits).toBe(totals[0]?.credits);

  const perTxn = await api.query<{ id: string }>(
    `SELECT transaction_id AS id FROM ledger_entries GROUP BY transaction_id
      HAVING SUM(CASE WHEN direction='debit' THEN amount_minor ELSE -amount_minor END) <> 0`,
  );
  expect(perTxn).toHaveLength(0);

  const negative = await api.query<{ id: string }>(
    "SELECT id FROM accounts WHERE type = 'wallet' AND balance_minor < 0",
  );
  expect(negative).toHaveLength(0);

  const mismatched = await api.query<{ id: string }>(
    `SELECT a.id
       FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
      GROUP BY a.id, a.balance_minor, a.type
     HAVING a.balance_minor <> COALESCE(SUM(CASE
              WHEN a.type IN ('asset','expense') THEN
                CASE e.direction WHEN 'debit' THEN e.amount_minor ELSE -e.amount_minor END
              ELSE
                CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END
            END), 0)`,
  );
  expect(mismatched).toHaveLength(0);
}

describe("ledger invariants hold for random transfers", () => {
  it(`after ${RUNS} random runs of up to ${COMMANDS} transfers each`, async () => {
    let attempted = 0;
    let succeeded = 0;
    let rejected = 0;

    await fc.assert(
      fc.asyncProperty(
        fc.array(cmdArb, { minLength: 20, maxLength: COMMANDS }),
        async (cmds: Cmd[]) => {
          const { orgId, wallets } = await setup();
          const model = wallets.map(() => 10_000n);

          for (const cmd of cmds) {
            attempted += 1;
            const amount = BigInt(cmd.amount);
            const same = cmd.from === cmd.to;
            const fromId = wallets[cmd.from] ?? "";
            const toId = wallets[cmd.to] ?? "";

            // Model: a self-transfer is rejected by validation, an overdraft by the balance check.
            const modelOk = !same && (model[cmd.from] ?? 0n) >= amount;
            const expectedCode = same ? "validation_failed" : "insufficient_funds";

            const before = await api.query<{ id: string; b: string }>(
              "SELECT id, balance_minor::text AS b FROM accounts ORDER BY id",
            );
            let ok = true;
            try {
              await ledger.post({
                orgId,
                kind: "transfer",
                entries: [
                  { accountId: fromId, direction: "debit", amountMinor: amount },
                  { accountId: toId, direction: "credit", amountMinor: amount },
                ],
              });
            } catch (error) {
              ok = false;
              expect((error as { code?: string }).code).toBe(expectedCode);
            }

            expect(ok).toBe(modelOk);
            if (ok) {
              succeeded += 1;
              model[cmd.from] = (model[cmd.from] ?? 0n) - amount;
              model[cmd.to] = (model[cmd.to] ?? 0n) + amount;
            } else {
              rejected += 1;
              const after = await api.query<{ id: string; b: string }>(
                "SELECT id, balance_minor::text AS b FROM accounts ORDER BY id",
              );
              expect(after).toEqual(before); // a rejected transfer changed nothing
            }
          }

          // The database must agree with the model for every wallet.
          const rows = await api.query<{ id: string; b: string }>(
            "SELECT id, balance_minor::text AS b FROM accounts WHERE type = 'wallet'",
          );
          for (const [i, wallet] of wallets.entries()) {
            expect(rows.find((r) => r.id === wallet)?.b).toBe((model[i] ?? 0n).toString());
          }
          await assertInvariants();
        },
      ),
      { numRuns: RUNS },
    );

    // Prove the generator exercised both outcomes, so the test is not vacuous.
    console.log(`property run: ${attempted} transfers (${succeeded} ok, ${rejected} rejected)`);
    // Prove the generator exercised both outcomes, so the test is not vacuous.
    expect(succeeded).toBeGreaterThan(200);
    expect(rejected).toBeGreaterThan(20);
  }, 600_000);
});
