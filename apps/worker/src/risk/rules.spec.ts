import { describe, expect, it } from "vitest";
import {
  DEFAULT_RISK_CONFIG,
  RULES_VERSION,
  evaluateRisk,
  formatInr,
  type RiskHistory,
  type RiskTransfer,
} from "./rules.js";

const transfer = (overrides: Partial<RiskTransfer> = {}): RiskTransfer => ({
  id: "t-1",
  orgId: "org-1",
  amountMinor: 50_000n, // INR 500
  fromAccountId: "acc-1",
  apiKeyId: "key-1",
  createdAt: new Date("2026-11-04T10:00:00Z"),
  ...overrides,
});

const quiet = (overrides: Partial<RiskHistory> = {}): RiskHistory => ({
  countLast10Min: 0,
  amountLastHourMinor: 0n,
  priorCount: 0,
  priorTotalMinor: 0n,
  seenApiKeyIds: [],
  failuresLast24h: 0,
  roundCountLast24h: 0,
  ...overrides,
});

const rulesFired = (t: RiskTransfer, h: RiskHistory): string[] =>
  evaluateRisk(t, h).reasons.map((r) => r.rule);

describe("formatInr", () => {
  it("formats minor units without floats", () => {
    expect(formatInr(150_000n)).toBe("INR 1500.00");
    expect(formatInr(5n)).toBe("INR 0.05");
    expect(formatInr(12_345_678_901_234_567n)).toBe("INR 123456789012345.67");
  });
});

describe("evaluateRisk", () => {
  it("scores a quiet, ordinary transfer as 0", () => {
    const result = evaluateRisk(transfer(), quiet());
    expect(result).toMatchObject({ score: 0, level: "low", flagged: false, reasons: [] });
    expect(result.rulesVersion).toBe(RULES_VERSION);
  });

  it("velocity_count: 25 at the medium limit, 40 at the high limit", () => {
    const medium = evaluateRisk(transfer(), quiet({ countLast10Min: 4 }));
    expect(medium.reasons).toMatchObject([{ rule: "velocity_count", points: 25 }]);
    const high = evaluateRisk(transfer(), quiet({ countLast10Min: 9 }));
    expect(high.reasons).toMatchObject([{ rule: "velocity_count", points: 40 }]);
    expect(rulesFired(transfer(), quiet({ countLast10Min: 3 }))).toEqual([]);
  });

  it("velocity_amount: fires when the hourly total reaches INR 100,000", () => {
    const at = quiet({ amountLastHourMinor: 10_000_000n - 50_000n });
    expect(rulesFired(transfer(), at)).toEqual(["velocity_amount"]);
    const below = quiet({ amountLastHourMinor: 10_000_000n - 50_001n });
    expect(rulesFired(transfer(), below)).toEqual([]);
  });

  it("unusual_amount: more than 5x the average and at least INR 1,000", () => {
    const history = quiet({
      priorCount: 10,
      priorTotalMinor: 1_000_000n, // average INR 1,000
      seenApiKeyIds: ["key-1"], // keep new_api_key out of this test
    });
    expect(rulesFired(transfer({ amountMinor: 500_001n }), history)).toEqual(["unusual_amount"]);
    expect(rulesFired(transfer({ amountMinor: 500_000n }), history)).toEqual([]);
  });

  it("unusual_amount: needs enough history and ignores small amounts", () => {
    const thin = quiet({ priorCount: 4, priorTotalMinor: 4_000n });
    expect(rulesFired(transfer({ amountMinor: 9_000_000n }), thin)).not.toContain("unusual_amount");
    const tiny = quiet({ priorCount: 10, priorTotalMinor: 100n });
    expect(rulesFired(transfer({ amountMinor: 99_999n }), tiny)).not.toContain("unusual_amount");
  });

  it("new_api_key: only for an account with history and an unseen key", () => {
    const seen = quiet({ priorCount: 3, seenApiKeyIds: ["key-1"] });
    expect(rulesFired(transfer(), seen)).toEqual([]);
    const unseen = quiet({ priorCount: 3, seenApiKeyIds: ["key-9"] });
    expect(rulesFired(transfer(), unseen)).toEqual(["new_api_key"]);
    expect(rulesFired(transfer(), quiet({ seenApiKeyIds: [] }))).toEqual([]);
    expect(rulesFired(transfer({ apiKeyId: null }), unseen)).toEqual([]);
  });

  it("repeated_failures: fires at 3", () => {
    expect(rulesFired(transfer(), quiet({ failuresLast24h: 2 }))).toEqual([]);
    expect(rulesFired(transfer(), quiet({ failuresLast24h: 3 }))).toEqual(["repeated_failures"]);
  });

  it("round_number: round and large, with other round transfers recently", () => {
    const history = quiet({ roundCountLast24h: 2 });
    expect(rulesFired(transfer({ amountMinor: 1_000_000n }), history)).toEqual(["round_number"]);
    expect(rulesFired(transfer({ amountMinor: 1_000_001n }), history)).toEqual([]);
    expect(rulesFired(transfer({ amountMinor: 900_000n }), history)).toEqual([]);
    expect(
      rulesFired(transfer({ amountMinor: 1_000_000n }), quiet({ roundCountLast24h: 1 })),
    ).toEqual([]);
  });

  it("flags at the review threshold and explains why in plain language", () => {
    const result = evaluateRisk(
      transfer(),
      quiet({ countLast10Min: 9, amountLastHourMinor: 10_000_000n }),
    );
    expect(result.score).toBe(70); // 40 + 30
    expect(result.level).toBe("high");
    expect(result.flagged).toBe(true);
    expect(result.reasons.map((r) => r.reason).join(" ")).toContain("transfers from this account");
    expect(result.reasons.every((r) => r.reason.length > 10)).toBe(true);
  });

  it("is medium between 30 and the threshold, and not flagged", () => {
    const result = evaluateRisk(transfer(), quiet({ failuresLast24h: 3, countLast10Min: 4 }));
    expect(result.score).toBe(45); // 20 + 25
    expect(result.level).toBe("medium");
    expect(result.flagged).toBe(false);
  });

  it("caps the score at 100 when every rule fires", () => {
    const history = quiet({
      countLast10Min: 12,
      amountLastHourMinor: 20_000_000n,
      priorCount: 10,
      priorTotalMinor: 1_000_000n,
      seenApiKeyIds: ["other"],
      failuresLast24h: 5,
      roundCountLast24h: 4,
    });
    const result = evaluateRisk(transfer({ amountMinor: 6_000_000n }), history);
    expect(result.reasons).toHaveLength(6);
    expect(result.score).toBe(100);
  });

  it("is deterministic and does not modify its inputs", () => {
    const t = transfer({ amountMinor: 1_000_000n });
    const h = quiet({ countLast10Min: 5, roundCountLast24h: 3, seenApiKeyIds: ["a"] });
    const before = JSON.stringify(h, (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    const first = evaluateRisk(t, h);
    const second = evaluateRisk(t, h);
    expect(second).toEqual(first);
    expect(JSON.stringify(h, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      before,
    );
  });

  it("changing the config changes the result without touching rule code", () => {
    const strict = { ...DEFAULT_RISK_CONFIG, failureThreshold: 1 };
    const result = evaluateRisk(transfer(), quiet({ failuresLast24h: 1 }), strict);
    expect(result.reasons.map((r) => r.rule)).toEqual(["repeated_failures"]);
  });
});
