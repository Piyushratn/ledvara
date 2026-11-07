import { describe, expect, it } from "vitest";
import { classify, type LedgerPayout, type ProviderEntry } from "./classify.js";

const payout = (id: string, amount: bigint, status: string, orgId = "org-1"): LedgerPayout => ({
  id,
  orgId,
  amountMinor: amount,
  status,
});

const entry = (
  reference: string,
  amountMinor: string,
  status: "settled" | "failed" = "settled",
): ProviderEntry => ({ providerRef: `prov_${reference}`, reference, amountMinor, status });

describe("classify", () => {
  it("matches payouts with the same amount and final status", () => {
    const result = classify(
      [payout("a", 1000n, "settled"), payout("b", 500n, "failed")],
      [entry("a", "1000"), entry("b", "500", "failed")],
    );
    expect(result.counts).toMatchObject({
      matched: 2,
      missing_in_ledger: 0,
      missing_at_provider: 0,
    });
  });

  it("reports a provider payout we have no record of, with no organization", () => {
    const result = classify([], [entry("ghost", "700")]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: "missing_in_ledger",
      payoutId: null,
      orgId: null,
      providerAmountMinor: "700",
    });
  });

  it("reports a settled or failed payout the provider did not report", () => {
    const result = classify(
      [payout("a", 1000n, "settled", "org-9"), payout("b", 1n, "failed")],
      [],
    );
    expect(result.counts.missing_at_provider).toBe(2);
    expect(result.items[0]).toMatchObject({ kind: "missing_at_provider", orgId: "org-9" });
  });

  it("ignores a pending payout the provider has not reported yet", () => {
    const result = classify([payout("a", 1000n, "pending")], []);
    expect(result.items).toEqual([]);
  });

  it("flags a pending payout the provider has already finalized", () => {
    const result = classify([payout("a", 1000n, "pending")], [entry("a", "1000")]);
    expect(result.items[0]).toMatchObject({
      kind: "status_mismatch",
      ledgerStatus: "pending",
      providerStatus: "settled",
    });
  });

  it("flags a different amount", () => {
    const result = classify([payout("a", 1000n, "settled")], [entry("a", "999")]);
    expect(result.items[0]).toMatchObject({
      kind: "amount_mismatch",
      ledgerAmountMinor: "1000",
      providerAmountMinor: "999",
    });
  });

  it("flags the same amount with a contradicting final status", () => {
    const result = classify([payout("a", 1000n, "failed")], [entry("a", "1000", "settled")]);
    expect(result.items[0]?.kind).toBe("status_mismatch");
  });

  it("treats an unparseable provider amount as a mismatch instead of throwing", () => {
    const result = classify([payout("a", 1000n, "settled")], [entry("a", "12.5")]);
    expect(result.items[0]?.kind).toBe("amount_mismatch");
  });

  it("gives the same result whatever order the inputs come in", () => {
    const ledger = [
      payout("a", 1n, "settled"),
      payout("b", 2n, "settled"),
      payout("c", 3n, "settled"),
    ];
    const report = [entry("a", "1"), entry("b", "9"), entry("zzz", "4")];
    const forward = classify(ledger, report);
    const reversed = classify([...ledger].reverse(), [...report].reverse());
    expect(reversed).toEqual(forward);
  });

  it("detects every injected mismatch among 20 payouts, and nothing else", () => {
    const ledger = Array.from({ length: 20 }, (_, i) =>
      payout(`p${i}`, BigInt(1000 + i), "settled"),
    );
    const report = ledger.map((p) => entry(p.id, p.amountMinor.toString()));

    const injected = report
      .filter((r) => !["p0", "p1"].includes(r.reference)) // 2 missing at provider
      .map((r) => {
        if (r.reference === "p2" || r.reference === "p3") return { ...r, amountMinor: "1" }; // 2 amounts
        if (r.reference === "p4") return { ...r, status: "failed" as const }; // 1 status
        return r;
      })
      .concat([entry("ghost-1", "5"), entry("ghost-2", "6")]); // 2 missing in ledger

    const result = classify(ledger, injected);
    expect(result.counts).toEqual({
      matched: 15,
      missing_in_ledger: 2,
      missing_at_provider: 2,
      amount_mismatch: 2,
      status_mismatch: 1,
    });
    const flagged = (kind: string): string[] =>
      result.items.filter((i) => i.kind === kind).map((i) => i.payoutId ?? i.providerRef ?? "");
    expect(flagged("missing_at_provider")).toEqual(["p0", "p1"]);
    expect(flagged("amount_mismatch")).toEqual(["p2", "p3"]);
    expect(flagged("status_mismatch")).toEqual(["p4"]);
    expect(flagged("missing_in_ledger")).toEqual(["prov_ghost-1", "prov_ghost-2"]);
  });
});
