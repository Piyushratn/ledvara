import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let ledger: import("./ledger.service.js").LedgerService;
let orgId: string;
let platform: string;
let wallet1: string;
let wallet2: string;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
  const { LedgerService } = await import("./ledger.service.js");
  ledger = ctx.app.get(LedgerService);
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

async function balance(id: string): Promise<bigint> {
  const rows = await api.query<{ balance_minor: string }>(
    "SELECT balance_minor FROM accounts WHERE id = $1",
    [id],
  );
  return BigInt(rows[0]?.balance_minor ?? "0");
}

beforeEach(async () => {
  await ctx.reset();
  const org = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id",
  );
  orgId = org[0]?.id ?? "";
  platform = await account("platform_funds", "asset", true);
  wallet1 = await account("wallet_one", "wallet");
  wallet2 = await account("wallet_two", "wallet");
  // Fund wallet1 with 1000 paise from the platform account.
  await ledger.post({
    orgId,
    kind: "transfer",
    entries: [
      { accountId: platform, direction: "debit", amountMinor: 1000n },
      { accountId: wallet1, direction: "credit", amountMinor: 1000n },
    ],
  });
});

describe("LedgerService.post", () => {
  it("moves money and updates both balances", async () => {
    await ledger.post({
      orgId,
      kind: "transfer",
      entries: [
        { accountId: wallet1, direction: "debit", amountMinor: 400n },
        { accountId: wallet2, direction: "credit", amountMinor: 400n },
      ],
    });
    expect(await balance(wallet1)).toBe(600n);
    expect(await balance(wallet2)).toBe(400n);
  });

  it("refuses to overdraw a wallet and changes nothing", async () => {
    await expect(
      ledger.post({
        orgId,
        kind: "transfer",
        entries: [
          { accountId: wallet1, direction: "debit", amountMinor: 1001n },
          { accountId: wallet2, direction: "credit", amountMinor: 1001n },
        ],
      }),
    ).rejects.toMatchObject({ code: "insufficient_funds" });
    expect(await balance(wallet1)).toBe(1000n);
    expect(await balance(wallet2)).toBe(0n);
  });

  it("rejects unbalanced input before touching the database", async () => {
    await expect(
      ledger.post({
        orgId,
        kind: "transfer",
        entries: [
          { accountId: wallet1, direction: "debit", amountMinor: 100n },
          { accountId: wallet2, direction: "credit", amountMinor: 90n },
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects zero amounts and single entries", async () => {
    await expect(
      ledger.post({
        orgId,
        kind: "transfer",
        entries: [
          { accountId: wallet1, direction: "debit", amountMinor: 0n },
          { accountId: wallet2, direction: "credit", amountMinor: 0n },
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    await expect(
      ledger.post({
        orgId,
        kind: "transfer",
        entries: [{ accountId: wallet1, direction: "debit", amountMinor: 1n }],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("cannot use another organization's account", async () => {
    const other = await api.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', 'other') RETURNING id",
    );
    const foreign = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type) VALUES ($1, 'foreign_one', 'F', 'wallet') RETURNING id",
      [other[0]?.id],
    );
    await expect(
      ledger.post({
        orgId,
        kind: "transfer",
        entries: [
          { accountId: wallet1, direction: "debit", amountMinor: 100n },
          { accountId: foreign[0]?.id ?? "", direction: "credit", amountMinor: 100n },
        ],
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await balance(wallet1)).toBe(1000n);
  });

  it("keeps stored balances equal to the sum of entries", async () => {
    await ledger.post({
      orgId,
      kind: "transfer",
      entries: [
        { accountId: wallet1, direction: "debit", amountMinor: 250n },
        { accountId: wallet2, direction: "credit", amountMinor: 250n },
      ],
    });
    const rows = await api.query<{ id: string; stored: string; derived: string }>(
      `SELECT a.id, a.balance_minor::text AS stored,
              COALESCE(SUM(CASE
                WHEN a.type IN ('asset','expense') THEN
                  CASE e.direction WHEN 'debit' THEN e.amount_minor ELSE -e.amount_minor END
                ELSE
                  CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END
              END), 0)::text AS derived
         FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
        GROUP BY a.id, a.balance_minor`,
    );
    for (const row of rows) expect(row.stored).toBe(row.derived);
  });
});
