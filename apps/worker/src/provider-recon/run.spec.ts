import { describe, expect, it } from "vitest";
import type { ProviderEntry } from "./classify.js";
import { excludeRecent, type PayoutRow } from "./run.js";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const minutesAgo = (m: number): Date => new Date(NOW - m * 60_000);

const payout = (id: string, createdAt: Date): PayoutRow => ({
  id,
  orgId: "org",
  amountMinor: 100n,
  status: "settled",
  createdAt,
});

const entry = (reference: string): ProviderEntry => ({
  providerRef: `prov_${reference}`,
  reference,
  amountMinor: "100",
  status: "settled",
});

describe("excludeRecent", () => {
  it("removes young payouts from both sides and keeps old ones", () => {
    const result = excludeRecent(
      [payout("old", minutesAgo(10)), payout("young", minutesAgo(1))],
      [entry("old"), entry("young"), entry("ghost")],
      2 * 60_000,
      NOW,
    );
    expect(result.ledger.map((p) => p.id)).toEqual(["old"]);
    expect(result.report.map((e) => e.reference)).toEqual(["old", "ghost"]);
  });

  it("keeps everything when the grace window is zero", () => {
    const result = excludeRecent([payout("now", minutesAgo(0))], [entry("now")], 0, NOW);
    expect(result.ledger).toHaveLength(1);
    expect(result.report).toHaveLength(1);
  });
});
