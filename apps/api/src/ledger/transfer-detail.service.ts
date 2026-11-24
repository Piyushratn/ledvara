import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { can } from "../orgs/permissions.js";
import type { Role } from "../orgs/roles.js";

export interface TransferDetail {
  transfer: {
    id: string;
    status: string;
    reference: string | null;
    createdAt: string;
    amountMinor: string | null;
    currency: string | null;
    from: { id: string; code: string | null; name: string } | null;
    to: { id: string; code: string | null; name: string } | null;
  };
  timeline: { status: string; at: string; approximate: boolean }[];
  entries: {
    id: string;
    accountId: string;
    accountName: string;
    direction: string;
    amountMinor: string;
  }[];
  related: { id: string; kind: string; status: string; createdAt: string; relation: string }[];
  risk: {
    score: number;
    level: string;
    flagged: boolean;
    rulesVersion: string;
    reasons: unknown;
    review: { id: string; status: string; note: string | null; decidedAt: string | null } | null;
  } | null;
  deliveries: {
    id: string;
    endpointId: string;
    eventType: string;
    status: string;
    attempts: number;
    lastStatusCode: number | null;
    lastError: string | null;
    lastAttemptAt: string | null;
  }[];
  /** null when the caller's role cannot read the audit log. */
  audit:
    | { action: string; actorType: string; actorId: string | null; at: string; metadata: unknown }[]
    | null;
}

@Injectable()
export class TransferDetailService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async get(orgId: string, id: string, role: Role): Promise<TransferDetail> {
    const pool = this.deps.pool;

    const txn = await pool.query<{
      id: string;
      status: string;
      reference: string | null;
      created_at: Date;
      reverses_id: string | null;
    }>(
      `SELECT id, status, reference, created_at, reverses_id FROM transactions
        WHERE id = $1 AND org_id = $2 AND kind = 'transfer'`,
      [id, orgId],
    );
    const t = txn.rows[0];
    if (!t) throw new AppError(404, ErrorCodes.NotFound, "Transfer not found.");

    const [entries, history, related, risk, deliveries] = await Promise.all([
      pool.query<{
        id: string;
        account_id: string;
        code: string | null;
        name: string;
        currency: string;
        direction: string;
        amount: string;
      }>(
        `SELECT e.id, e.account_id, a.code, a.name, a.currency, e.direction,
                e.amount_minor::text AS amount
           FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
          WHERE e.transaction_id = $1 AND e.org_id = $2 ORDER BY e.seq`,
        [id, orgId],
      ),
      pool.query<{ status: string; changed_at: Date; backfilled: boolean }>(
        `SELECT status, changed_at, backfilled FROM transaction_status_history
          WHERE transaction_id = $1 AND org_id = $2 ORDER BY id`,
        [id, orgId],
      ),
      pool.query<{ id: string; kind: string; status: string; created_at: Date }>(
        `SELECT id, kind, status, created_at FROM transactions
          WHERE org_id = $2 AND (reverses_id = $1 OR id = $3::uuid) ORDER BY created_at`,
        [id, orgId, t.reverses_id],
      ),
      pool.query<{
        score: number;
        level: string;
        flagged: boolean;
        rules_version: string;
        reasons: unknown;
        review_id: string | null;
        review_status: string | null;
        reviewer_note: string | null;
        decided_at: Date | null;
      }>(
        `SELECT a.score, a.level, a.flagged, a.rules_version, a.reasons,
                r.id AS review_id, r.status AS review_status, r.reviewer_note, r.decided_at
           FROM risk_assessments a LEFT JOIN review_items r ON r.assessment_id = a.id
          WHERE a.transaction_id = $1 AND a.org_id = $2`,
        [id, orgId],
      ),
      pool.query<{
        id: string;
        endpoint_id: string;
        event_type: string;
        status: string;
        attempts: number;
        last_status_code: number | null;
        last_error: string | null;
        last_attempt_at: Date | null;
      }>(
        `SELECT d.id, d.endpoint_id, d.event_type, d.status, d.attempts,
                d.last_status_code, d.last_error, d.last_attempt_at
           FROM outbox_events o
           JOIN webhook_deliveries d ON d.event_id = o.id AND d.org_id = o.org_id
          WHERE o.org_id = $2 AND o.aggregate_id = $1
          ORDER BY d.created_at DESC LIMIT 50`,
        [id, orgId],
      ),
    ]);

    const debit = entries.rows.find((e) => e.direction === "debit");
    const credit = entries.rows.find((e) => e.direction === "credit");
    const account = (e: typeof debit) =>
      e ? { id: e.account_id, code: e.code, name: e.name } : null;

    const riskRow = risk.rows[0];

    let audit: TransferDetail["audit"] = null;
    if (can(role, "audit:read")) {
      const events = await pool.query<{
        action: string;
        actor_type: string;
        actor_id: string | null;
        created_at: Date;
        metadata: unknown;
      }>(
        `SELECT action, actor_type, actor_id, created_at, metadata FROM audit_events
          WHERE org_id = $2 AND (target_id::text = $1 OR target_id::text = $3::text)
          ORDER BY created_at, id LIMIT 100`,
        [id, orgId, riskRow?.review_id ?? null],
      );
      audit = events.rows.map((row) => ({
        action: row.action,
        actorType: row.actor_type,
        actorId: row.actor_id,
        at: row.created_at.toISOString(),
        metadata: row.metadata,
      }));
    }

    return {
      transfer: {
        id: t.id,
        status: t.status,
        reference: t.reference,
        createdAt: t.created_at.toISOString(),
        amountMinor: debit?.amount ?? null,
        currency: debit?.currency ?? null,
        from: account(debit),
        to: account(credit),
      },
      timeline: history.rows.map((row) => ({
        status: row.status,
        at: row.changed_at.toISOString(),
        approximate: row.backfilled,
      })),
      entries: entries.rows.map((e) => ({
        id: e.id,
        accountId: e.account_id,
        accountName: e.name,
        direction: e.direction,
        amountMinor: e.amount,
      })),
      related: related.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        relation: r.id === t.reverses_id ? "reverses" : "reversed_by",
      })),
      risk: riskRow
        ? {
            score: riskRow.score,
            level: riskRow.level,
            flagged: riskRow.flagged,
            rulesVersion: riskRow.rules_version,
            reasons: riskRow.reasons,
            review: riskRow.review_id
              ? {
                  id: riskRow.review_id,
                  status: riskRow.review_status ?? "pending",
                  note: riskRow.reviewer_note,
                  decidedAt: riskRow.decided_at?.toISOString() ?? null,
                }
              : null,
          }
        : null,
      deliveries: deliveries.rows.map((d) => ({
        id: d.id,
        endpointId: d.endpoint_id,
        eventType: d.event_type,
        status: d.status,
        attempts: d.attempts,
        lastStatusCode: d.last_status_code,
        lastError: d.last_error,
        lastAttemptAt: d.last_attempt_at?.toISOString() ?? null,
      })),
      audit,
    };
  }
}
