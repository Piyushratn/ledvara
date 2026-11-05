import type { Pool } from "pg";
import { z } from "zod";
import type { OutboxRow } from "../relay.js";
import {
  DEFAULT_RISK_CONFIG,
  evaluateRisk,
  type RiskConfig,
  type RiskHistory,
  type RiskTransfer,
} from "./rules.js";

const payloadSchema = z.object({
  id: z.string().uuid(),
  fromAccountId: z.string().uuid(),
  amountMinor: z.string().regex(/^\d+$/u),
  apiKeyId: z.string().uuid().nullish(),
});

export type ScoreResult =
  | { status: "scored"; score: number; flagged: boolean }
  | { status: "duplicate" }
  | { status: "skipped"; reason: string };

function stringifyWithBigint(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

async function loadHistory(
  pool: Pool,
  orgId: string,
  transactionId: string,
  accountId: string,
  createdAt: string,
  apiKeyId: string | null,
  config: RiskConfig,
): Promise<RiskHistory> {
  const { rows } = await pool.query<{
    count_10m: number;
    amount_hour: string;
    prior_count: number;
    prior_total: string;
    round_24h: number;
  }>(
    `SELECT
       (count(*) FILTER (WHERE t.created_at >= $3::timestamptz - interval '10 minutes'))::int AS count_10m,
       COALESCE(sum(e.amount_minor) FILTER (WHERE t.created_at >= $3::timestamptz - interval '1 hour'), 0)::text AS amount_hour,
       count(*)::int AS prior_count,
       COALESCE(sum(e.amount_minor), 0)::text AS prior_total,
       (count(*) FILTER (WHERE t.created_at >= $3::timestamptz - interval '24 hours'
                           AND e.amount_minor % $4::bigint = 0))::int AS round_24h
     FROM ledger_entries e
     JOIN transactions t ON t.id = e.transaction_id
     WHERE e.account_id = $1
       AND e.org_id = $5
       AND e.direction = 'debit'
       AND t.kind = 'transfer'
       AND t.status IN ('settled', 'reversed')
       AND t.id <> $2
       AND t.created_at < $3::timestamptz
       AND t.created_at >= $3::timestamptz - interval '30 days'`,
    [accountId, transactionId, createdAt, config.roundUnitMinor.toString(), orgId],
  );
  const row = rows[0];

  // Keys that created earlier transfers from this account.
  let seenApiKeyIds: string[] = [];
  if (apiKeyId !== null) {
    const seen = await pool.query<{ key: string }>(
      `SELECT DISTINCT payload->>'apiKeyId' AS key
         FROM outbox_events
        WHERE org_id = $1
          AND type = 'transfer.settled'
          AND payload->>'fromAccountId' = $2
          AND payload->>'apiKeyId' IS NOT NULL
          AND created_at < $3::timestamptz`,
      [orgId, accountId, createdAt],
    );
    seenApiKeyIds = seen.rows.map((r) => r.key);
  }

  // Refused attempts (overdrafts, closed accounts) in the 24 hours before this transfer.
  const failures = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM transfer_failures
      WHERE org_id = $1
        AND from_account_id = $2
        AND created_at < $3::timestamptz
        AND created_at >= $3::timestamptz - interval '24 hours'`,
    [orgId, accountId, createdAt],
  );

  return {
    countLast10Min: row?.count_10m ?? 0,
    amountLastHourMinor: BigInt(row?.amount_hour ?? "0"),
    priorCount: row?.prior_count ?? 0,
    priorTotalMinor: BigInt(row?.prior_total ?? "0"),
    seenApiKeyIds,
    failuresLast24h: failures.rows[0]?.n ?? 0,
    roundCountLast24h: row?.round_24h ?? 0,
  };
}

/**
 * Scores one settled transfer and stores the assessment (and a review item when flagged).
 * Read-only against the ledger. Safe to call twice for the same event.
 */
export async function scoreOutboxEvent(
  pool: Pool,
  event: OutboxRow,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): Promise<ScoreResult> {
  if (event.type !== "transfer.settled") return { status: "skipped", reason: "not a transfer" };
  const parsed = payloadSchema.safeParse(event.payload);
  if (!parsed.success) return { status: "skipped", reason: "bad payload" };
  const payload = parsed.data;
  const apiKeyId = payload.apiKeyId ?? null;

  const found = await pool.query<{ created_at: string }>(
    "SELECT created_at::text AS created_at FROM transactions WHERE id = $1 AND org_id = $2 AND kind = 'transfer'",
    [payload.id, event.org_id],
  );
  const createdAt = found.rows[0]?.created_at;
  if (!createdAt) return { status: "skipped", reason: "transaction not found" };

  const history = await loadHistory(
    pool,
    event.org_id,
    payload.id,
    payload.fromAccountId,
    createdAt,
    apiKeyId,
    config,
  );
  const transfer: RiskTransfer = {
    id: payload.id,
    orgId: event.org_id,
    amountMinor: BigInt(payload.amountMinor),
    fromAccountId: payload.fromAccountId,
    apiKeyId,
    createdAt: new Date(createdAt),
  };
  const assessment = evaluateRisk(transfer, history, config);

  const inputs = {
    fromAccountId: payload.fromAccountId,
    amountMinor: payload.amountMinor,
    apiKeyId,
    createdAt,
    history,
    notes: { failuresTracked: true, apiKeyTracked: apiKeyId !== null },
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO risk_assessments
         (org_id, transaction_id, rules_version, score, level, flagged, reasons, inputs)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING id`,
      [
        event.org_id,
        payload.id,
        assessment.rulesVersion,
        assessment.score,
        assessment.level,
        assessment.flagged,
        stringifyWithBigint(assessment.reasons),
        stringifyWithBigint(inputs),
      ],
    );
    const assessmentId = inserted.rows[0]?.id;
    if (!assessmentId) {
      await client.query("COMMIT");
      return { status: "duplicate" };
    }
    if (assessment.flagged) {
      await client.query(
        `INSERT INTO review_items (org_id, transaction_id, assessment_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [event.org_id, payload.id, assessmentId],
      );
    }
    await client.query("COMMIT");
    return { status: "scored", score: assessment.score, flagged: assessment.flagged };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
