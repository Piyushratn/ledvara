import { describe, expect, it } from "vitest";
import { buildTransferCommands, missingDemoAccounts } from "./onboarding";
import type { Account } from "./org-api";

const account = (code: string): Account => ({
  id: `id-${code}`,
  code,
  name: code,
  type: "wallet",
  balanceMinor: "0",
});

const input = {
  apiUrl: "http://localhost:3000",
  apiKey: "lv_test_secretvalue",
  fromAccountId: "11111111-1111-4111-8111-111111111111",
  toAccountId: "44444444-4444-4444-8444-444444444444",
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
};

describe("missingDemoAccounts", () => {
  it("returns only the accounts that do not exist yet", () => {
    expect(missingDemoAccounts([]).map((a) => a.code)).toEqual(["platform_funds", "wallet_demo"]);
    expect(missingDemoAccounts([account("platform_funds")]).map((a) => a.code)).toEqual([
      "wallet_demo",
    ]);
    expect(missingDemoAccounts([account("platform_funds"), account("wallet_demo")])).toEqual([]);
  });

  it("makes the platform account allow negative and the wallet not", () => {
    const [platform, wallet] = missingDemoAccounts([]);
    expect(platform).toMatchObject({ type: "asset", allowNegative: true });
    expect(wallet).toMatchObject({ type: "wallet", allowNegative: false });
  });
});

describe("buildTransferCommands", () => {
  it("builds both commands with the key, the idempotency key and a valid JSON body", () => {
    const { bash, powershell } = buildTransferCommands(input);
    for (const text of [bash, powershell]) {
      expect(text).toContain("http://localhost:3000/v1/transfers");
      expect(text).toContain("Bearer lv_test_secretvalue");
      expect(text).toContain(input.idempotencyKey);
    }
    const body = /-d '(.+)'/u.exec(bash)?.[1] ?? "";
    expect(JSON.parse(body)).toMatchObject({
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amountMinor: 10_000,
    });
  });

  it("refuses values that could break out of a quoted command", () => {
    expect(() => buildTransferCommands({ ...input, apiKey: "x'; rm -rf /" })).toThrow(/Unsafe/u);
    expect(() => buildTransferCommands({ ...input, apiUrl: "http://a b" })).toThrow(/Unsafe/u);
  });
});
