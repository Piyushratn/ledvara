/**
 * Deterministic risk scoring. Pure functions only: no database, clock or randomness.
 * The risk layer never moves money; it only scores and explains (ADR 0004).
 */

export const RULES_VERSION = "2026-11-v1";

export interface RiskTransfer {
  id: string;
  orgId: string;
  /** Minor units (paise). */
  amountMinor: bigint;
  fromAccountId: string;
  apiKeyId: string | null;
  createdAt: Date;
}

/** Facts about the source account's recent past. They never include the transfer being scored. */
export interface RiskHistory {
  countLast10Min: number;
  amountLastHourMinor: bigint;
  /** Transfers in the look-back period (30 days). */
  priorCount: number;
  priorTotalMinor: bigint;
  seenApiKeyIds: string[];
  failuresLast24h: number;
  /** Prior transfers in 24h whose amount was a round multiple of INR 1,000. */
  roundCountLast24h: number;
}

export interface RiskConfig {
  velocityCountMedium: number;
  velocityCountHigh: number;
  velocityAmountHourMinor: bigint;
  unusualMinHistory: number;
  unusualMultiplier: bigint;
  unusualMinAmountMinor: bigint;
  failureThreshold: number;
  roundUnitMinor: bigint;
  roundMinAmountMinor: bigint;
  roundPriorCount: number;
  reviewThreshold: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  velocityCountMedium: 5,
  velocityCountHigh: 10,
  velocityAmountHourMinor: 10_000_000n, // INR 100,000
  unusualMinHistory: 5,
  unusualMultiplier: 5n,
  unusualMinAmountMinor: 100_000n, // INR 1,000
  failureThreshold: 3,
  roundUnitMinor: 100_000n, // INR 1,000
  roundMinAmountMinor: 1_000_000n, // INR 10,000
  roundPriorCount: 2,
  reviewThreshold: 60,
};

export interface RuleHit {
  rule: string;
  points: number;
  reason: string;
}

export type RiskLevel = "low" | "medium" | "high";

export interface RiskAssessment {
  rulesVersion: string;
  score: number;
  level: RiskLevel;
  flagged: boolean;
  reasons: RuleHit[];
}

/** "INR 1500.00" from minor units. Plain ASCII so it is safe in logs, JSON and emails. */
export function formatInr(minor: bigint): string {
  const whole = minor / 100n;
  const paise = (minor % 100n).toString().padStart(2, "0");
  return `INR ${whole.toString()}.${paise}`;
}

type Rule = (t: RiskTransfer, h: RiskHistory, c: RiskConfig) => RuleHit | null;

const velocityCount: Rule = (_t, h, c) => {
  const count = h.countLast10Min + 1; // include this transfer
  if (count >= c.velocityCountHigh) {
    return {
      rule: "velocity_count",
      points: 40,
      reason: `${count} transfers from this account in 10 minutes (high-velocity limit is ${c.velocityCountHigh}).`,
    };
  }
  if (count >= c.velocityCountMedium) {
    return {
      rule: "velocity_count",
      points: 25,
      reason: `${count} transfers from this account in 10 minutes (limit is ${c.velocityCountMedium}).`,
    };
  }
  return null;
};

const velocityAmount: Rule = (t, h, c) => {
  const total = h.amountLastHourMinor + t.amountMinor;
  if (total < c.velocityAmountHourMinor) return null;
  return {
    rule: "velocity_amount",
    points: 30,
    reason: `${formatInr(total)} moved from this account in the last hour (limit is ${formatInr(c.velocityAmountHourMinor)}).`,
  };
};

const unusualAmount: Rule = (t, h, c) => {
  if (h.priorCount < c.unusualMinHistory || h.priorTotalMinor <= 0n) return null;
  if (t.amountMinor < c.unusualMinAmountMinor) return null;
  // amount > multiplier * (total / count), compared without division to avoid rounding.
  const count = BigInt(h.priorCount);
  if (t.amountMinor * count <= c.unusualMultiplier * h.priorTotalMinor) return null;
  const average = h.priorTotalMinor / count;
  return {
    rule: "unusual_amount",
    points: 25,
    reason: `${formatInr(t.amountMinor)} is more than ${c.unusualMultiplier}x this account's average of ${formatInr(average)}.`,
  };
};

const newApiKey: Rule = (t, h) => {
  if (t.apiKeyId === null || h.priorCount === 0) return null;
  if (h.seenApiKeyIds.includes(t.apiKeyId)) return null;
  return {
    rule: "new_api_key",
    points: 15,
    reason: "This API key has not been used with this account before.",
  };
};

const repeatedFailures: Rule = (_t, h, c) => {
  if (h.failuresLast24h < c.failureThreshold) return null;
  return {
    rule: "repeated_failures",
    points: 20,
    reason: `${h.failuresLast24h} failed transfers from this account in 24 hours.`,
  };
};

const roundNumber: Rule = (t, h, c) => {
  if (t.amountMinor < c.roundMinAmountMinor) return null;
  if (t.amountMinor % c.roundUnitMinor !== 0n) return null;
  if (h.roundCountLast24h < c.roundPriorCount) return null;
  return {
    rule: "round_number",
    points: 20,
    reason: `${formatInr(t.amountMinor)} is a round amount, and ${h.roundCountLast24h} other round-amount transfers happened in 24 hours.`,
  };
};

const RULES: readonly Rule[] = [
  velocityCount,
  velocityAmount,
  unusualAmount,
  newApiKey,
  repeatedFailures,
  roundNumber,
];

export function evaluateRisk(
  transfer: RiskTransfer,
  history: RiskHistory,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskAssessment {
  const reasons: RuleHit[] = [];
  for (const rule of RULES) {
    const hit = rule(transfer, history, config);
    if (hit) reasons.push(hit);
  }
  const raw = reasons.reduce((sum, hit) => sum + hit.points, 0);
  const score = Math.min(100, raw);
  const level: RiskLevel =
    score >= config.reviewThreshold ? "high" : score >= 30 ? "medium" : "low";
  return {
    rulesVersion: RULES_VERSION,
    score,
    level,
    flagged: score >= config.reviewThreshold,
    reasons,
  };
}
