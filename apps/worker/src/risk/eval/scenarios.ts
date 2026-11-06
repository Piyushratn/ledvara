import type { RiskHistory, RiskTransfer } from "../rules.js";

export interface Scenario {
  name: string;
  /** Human judgment, written from the description, not derived from the rule output. */
  label: "suspicious" | "legitimate";
  transfer: RiskTransfer;
  history: RiskHistory;
}

const T0 = new Date("2026-11-04T10:00:00Z");

const transfer = (amountMinor: bigint, apiKeyId: string | null = "key-1"): RiskTransfer => ({
  id: "t",
  orgId: "org",
  amountMinor,
  fromAccountId: "acc",
  apiKeyId,
  createdAt: T0,
});

const history = (overrides: Partial<RiskHistory> = {}): RiskHistory => ({
  countLast10Min: 0,
  amountLastHourMinor: 0n,
  priorCount: 0,
  priorTotalMinor: 0n,
  seenApiKeyIds: ["key-1"],
  failuresLast24h: 0,
  roundCountLast24h: 0,
  ...overrides,
});

const inr = (rupees: number): bigint => BigInt(rupees) * 100n;

export const SCENARIOS: readonly Scenario[] = [
  // ---- Legitimate behavior ----
  {
    name: "first small transfer on a new account",
    label: "legitimate",
    transfer: transfer(inr(500)),
    history: history({ seenApiKeyIds: [] }),
  },
  {
    name: "routine payroll-sized transfer, steady history",
    label: "legitimate",
    transfer: transfer(inr(4_200)),
    history: history({ priorCount: 20, priorTotalMinor: inr(80_000), amountLastHourMinor: 0n }),
  },
  {
    name: "three transfers in ten minutes during a normal batch",
    label: "legitimate",
    transfer: transfer(inr(900)),
    history: history({ countLast10Min: 2, priorCount: 30, priorTotalMinor: inr(27_000) }),
  },
  {
    name: "single large rent payment with no other activity",
    label: "legitimate",
    transfer: transfer(inr(85_000)),
    history: history({ priorCount: 6, priorTotalMinor: inr(400_000) }),
  },
  {
    name: "one failed attempt followed by a corrected retry",
    label: "legitimate",
    transfer: transfer(inr(1_500)),
    history: history({ failuresLast24h: 1, priorCount: 12, priorTotalMinor: inr(18_000) }),
  },
  {
    name: "round amount, but a one-off supplier invoice",
    label: "legitimate",
    transfer: transfer(inr(20_000)),
    history: history({ roundCountLast24h: 0, priorCount: 8, priorTotalMinor: inr(160_000) }),
  },
  {
    name: "same customer rotates to a new API key after a planned key rotation",
    label: "legitimate",
    transfer: transfer(inr(2_000), "key-2"),
    history: history({
      seenApiKeyIds: ["key-1"],
      priorCount: 15,
      priorTotalMinor: inr(30_000),
    }),
  },
  {
    name: "month-end settlement burst of six transfers, all normal sizes",
    label: "legitimate",
    transfer: transfer(inr(3_100)),
    history: history({
      countLast10Min: 5,
      amountLastHourMinor: inr(15_000),
      priorCount: 40,
      priorTotalMinor: inr(124_000),
    }),
  },
  {
    name: "large payout from a high-volume merchant account",
    label: "legitimate",
    transfer: transfer(inr(60_000)),
    history: history({
      amountLastHourMinor: inr(45_000),
      priorCount: 200,
      priorTotalMinor: inr(10_000_000),
    }),
  },
  {
    name: "two round transfers in a day for a fixed monthly subscription pair",
    label: "legitimate",
    transfer: transfer(inr(10_000)),
    history: history({ roundCountLast24h: 1, priorCount: 25, priorTotalMinor: inr(250_000) }),
  },

  // ---- Suspicious behavior ----
  {
    name: "rapid-fire: ten transfers in ten minutes plus a large hourly total",
    label: "suspicious",
    transfer: transfer(inr(9_500)),
    history: history({
      countLast10Min: 9,
      amountLastHourMinor: inr(95_000),
      priorCount: 20,
      priorTotalMinor: inr(60_000),
    }),
  },
  {
    name: "account drained in one hour across many transfers",
    label: "suspicious",
    transfer: transfer(inr(30_000)),
    history: history({
      countLast10Min: 6,
      amountLastHourMinor: inr(150_000),
      priorCount: 10,
      priorTotalMinor: inr(40_000),
    }),
  },
  {
    name: "sudden jump to 20x the usual amount on an established account",
    label: "suspicious",
    transfer: transfer(inr(50_000)),
    history: history({
      priorCount: 30,
      priorTotalMinor: inr(75_000),
      amountLastHourMinor: inr(60_000),
    }),
  },
  {
    name: "structuring: repeated round amounts just under a review threshold",
    label: "suspicious",
    transfer: transfer(inr(20_000)),
    history: history({
      roundCountLast24h: 5,
      countLast10Min: 5,
      priorCount: 12,
      priorTotalMinor: inr(100_000),
    }),
  },
  {
    name: "probing: several refused attempts then a transfer from a stranger key",
    label: "suspicious",
    transfer: transfer(inr(8_000), "key-9"),
    history: history({
      failuresLast24h: 6,
      seenApiKeyIds: ["key-1"],
      priorCount: 14,
      priorTotalMinor: inr(28_000),
      countLast10Min: 4,
    }),
  },
  {
    name: "new key, large amount, high velocity, after failures",
    label: "suspicious",
    transfer: transfer(inr(40_000), "key-9"),
    history: history({
      countLast10Min: 7,
      failuresLast24h: 4,
      amountLastHourMinor: inr(70_000),
      seenApiKeyIds: ["key-1"],
      priorCount: 9,
      priorTotalMinor: inr(18_000),
    }),
  },
  {
    name: "slow drip: a single transfer 12x average from an unseen key",
    label: "suspicious",
    transfer: transfer(inr(24_000), "key-9"),
    history: history({ priorCount: 10, priorTotalMinor: inr(20_000), seenApiKeyIds: ["key-1"] }),
  },
  {
    name: "round-number layering, large amounts, steady pace",
    label: "suspicious",
    transfer: transfer(inr(50_000)),
    history: history({
      roundCountLast24h: 3,
      amountLastHourMinor: inr(100_000),
      priorCount: 15,
      priorTotalMinor: inr(150_000),
    }),
  },
  {
    name: "credential-stuffing aftermath: many failures, then success",
    label: "suspicious",
    transfer: transfer(inr(15_000), "key-9"),
    history: history({
      failuresLast24h: 9,
      seenApiKeyIds: ["key-1"],
      priorCount: 5,
      priorTotalMinor: inr(10_000),
    }),
  },
  {
    name: "small test transfers then a big one: ramp-up pattern",
    label: "suspicious",
    transfer: transfer(inr(45_000)),
    history: history({
      countLast10Min: 5,
      priorCount: 8,
      priorTotalMinor: inr(4_000),
      amountLastHourMinor: inr(2_000),
    }),
  },
];
