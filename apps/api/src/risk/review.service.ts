import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import type { ListReviewsInput } from "./review.schemas.js";

export interface ReviewItemView {
  id: string;
  transactionId: string;
  status: string;
  score: number;
  level: string;
  reasons: { rule: string; points: number; reason: string }[];
  amountMinor: string | null;
  fromAccountId: string | null;
  reviewerId: string | null;
  reviewerNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  transaction_id: string;
  status: string;
  reviewer_id: string | null;
  reviewer_note: string | null;
  decided_at: Date | null;
  created_at: Date;
  score: number;
  level: string;
  reasons: { rule: string; points: number; reason: string }[];
  inputs: { amountMinor?: string; fromAccountId?: string };
}

const SELECT = `
  SELECT r.id, r.transaction_id, r.status, r.reviewer_id, r.reviewer_note,
         r.decided_at, r.created_at, a.score, a.level, a.reasons, a.inputs
    FROM review_items r
    JOIN risk_assessments a ON a.id = r.assessment_id`;

function toView(row: Row): ReviewItemView {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    status: row.status,
    score: row.score,
    level: row.level,
    reasons: row.reasons,
    amountMinor: row.inputs.amountMinor ?? null,
    fromAccountId: row.inputs.fromAccountId ?? null,
    reviewerId: row.reviewer_id,
    reviewerNote: row.reviewer_note,
    decidedAt: row.decided_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class ReviewService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async list(orgId: string, input: ListReviewsInput): Promise<ReviewItemView[]> {
    const params: unknown[] = [orgId];
    let where = "WHERE r.org_id = $1";
    if (input.status) {
      params.push(input.status);
      where += ` AND r.status = $${params.length}`;
    }
    params.push(input.limit);
    // The pending queue is worked oldest first; history is shown newest first.
    const order = input.status === "pending" ? "ASC" : "DESC";
    const { rows } = await this.deps.pool.query<Row>(
      `${SELECT} ${where} ORDER BY r.created_at ${order}, r.id LIMIT $${params.length}`,
      params,
    );
    return rows.map(toView);
  }

  async get(orgId: string, id: string): Promise<ReviewItemView> {
    const { rows } = await this.deps.pool.query<Row>(
      `${SELECT} WHERE r.id = $1 AND r.org_id = $2`,
      [id, orgId],
    );
    const row = rows[0];
    if (!row) {
      throw new AppError(404, ErrorCodes.NotFound, "Review item not found.");
    }
    return toView(row);
  }

  /**
   * Records a decision. Only the review row changes: the ledger is never touched.
   * One conditional UPDATE means two simultaneous reviewers cannot both win.
   */
  async decide(
    orgId: string,
    id: string,
    reviewerId: string,
    decision: "approved" | "rejected",
    note: string | null,
  ): Promise<ReviewItemView> {
    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{ transaction_id: string }>(
        `UPDATE review_items
            SET status = $3, reviewer_id = $4, reviewer_note = $5, decided_at = now()
          WHERE id = $1 AND org_id = $2 AND status = 'pending'
          RETURNING transaction_id`,
        [id, orgId, decision, reviewerId, note],
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        const exists = await client.query(
          "SELECT 1 FROM review_items WHERE id = $1 AND org_id = $2",
          [id, orgId],
        );
        if (exists.rows.length === 0) {
          throw new AppError(404, ErrorCodes.NotFound, "Review item not found.");
        }
        throw new AppError(
          409,
          "review_already_decided",
          "This review item has already been decided.",
        );
      }
      await client.query(
        `INSERT INTO outbox_events (org_id, type, aggregate_type, aggregate_id, payload)
         VALUES ($1, 'risk.review_decided', 'review', $2, $3::jsonb)`,
        [orgId, id, JSON.stringify({ id, transactionId: row.transaction_id, decision, note })],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return this.get(orgId, id);
  }
}
