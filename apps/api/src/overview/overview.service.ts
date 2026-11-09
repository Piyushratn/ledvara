import { Inject, Injectable } from "@nestjs/common";
import { Dependencies } from "../health/dependencies.js";

export interface OverviewView {
  windowDays: number;
  accepted: number;
  refused: number;
  volumeMinor: string;
  daily: { date: string; accepted: number; volumeMinor: string }[];
  pendingReviews: number;
  reconciliation: { status: "ok" | "drift" | "none"; checkedAt: string | null };
}

const WINDOW_DAYS = 7;

interface ReconDetails {
  drifts?: { orgId: string }[];
  unbalanced?: { orgId: string }[];
}

@Injectable()
export class OverviewService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async get(orgId: string): Promise<OverviewView> {
    const pool = this.deps.pool;

    const daily = await pool.query<{ day: string; accepted: number; volume: string }>(
      `WITH days AS (
         SELECT generate_series(
                  (now() AT TIME ZONE 'UTC')::date - ($2::int - 1),
                  (now() AT TIME ZONE 'UTC')::date,
                  interval '1 day')::date AS day
       ),
       moved AS (
         SELECT (t.created_at AT TIME ZONE 'UTC')::date AS day,
                t.status,
                d.amount_minor
           FROM transactions t
           JOIN ledger_entries d ON d.transaction_id = t.id AND d.direction = 'debit'
          WHERE t.org_id = $1
            AND t.kind = 'transfer'
            AND t.status IN ('settled', 'reversed')
            AND (t.created_at AT TIME ZONE 'UTC')::date >=
                (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)
       )
       SELECT days.day::text AS day,
              count(moved.day)::int AS accepted,
              COALESCE(sum(moved.amount_minor) FILTER (WHERE moved.status = 'settled'), 0)::text
                AS volume
         FROM days LEFT JOIN moved ON moved.day = days.day
        GROUP BY days.day
        ORDER BY days.day`,
      [orgId, WINDOW_DAYS],
    );

    const refused = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transfer_failures
        WHERE org_id = $1
          AND (created_at AT TIME ZONE 'UTC')::date >=
              (now() AT TIME ZONE 'UTC')::date - ($2::int - 1)`,
      [orgId, WINDOW_DAYS],
    );

    const pending = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM review_items WHERE org_id = $1 AND status = 'pending'",
      [orgId],
    );

    const recon = await pool.query<{ finished_at: Date | null; details: ReconDetails }>(
      `SELECT finished_at, details FROM reconciliation_runs
        ORDER BY started_at DESC LIMIT 1`,
    );

    const rows = daily.rows.map((row) => ({
      date: row.day,
      accepted: row.accepted,
      volumeMinor: row.volume,
    }));
    const volume = rows.reduce((sum, row) => sum + BigInt(row.volumeMinor), 0n);

    const latest = recon.rows[0];
    let reconciliation: OverviewView["reconciliation"] = { status: "none", checkedAt: null };
    if (latest) {
      const mine =
        (latest.details.drifts ?? []).some((d) => d.orgId === orgId) ||
        (latest.details.unbalanced ?? []).some((t) => t.orgId === orgId);
      reconciliation = {
        status: mine ? "drift" : "ok",
        checkedAt: latest.finished_at?.toISOString() ?? null,
      };
    }

    return {
      windowDays: WINDOW_DAYS,
      accepted: rows.reduce((sum, row) => sum + row.accepted, 0),
      refused: refused.rows[0]?.n ?? 0,
      volumeMinor: volume.toString(),
      daily: rows,
      pendingReviews: pending.rows[0]?.n ?? 0,
      reconciliation,
    };
  }
}
