import type { Pool } from "pg";

export interface BalanceDrift {
  accountId: string;
  orgId: string;
  stored: string;
  derived: string;
}

export interface UnbalancedTransaction {
  transactionId: string;
  orgId: string;
  debits: string;
  credits: string;
}

export interface ReconcileReport {
  accountsChecked: number;
  drifts: BalanceDrift[];
  unbalanced: UnbalancedTransaction[];
}

const DRIFT_SQL = `
  SELECT a.id AS account_id, a.org_id, a.balance_minor::text AS stored,
         COALESCE(SUM(CASE
           WHEN a.type IN ('asset', 'expense') THEN
             CASE e.direction WHEN 'debit' THEN e.amount_minor ELSE -e.amount_minor END
           ELSE
             CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END
         END), 0)::text AS derived
    FROM accounts a
    LEFT JOIN ledger_entries e ON e.account_id = a.id
   GROUP BY a.id, a.org_id, a.balance_minor
  HAVING a.balance_minor <> COALESCE(SUM(CASE
           WHEN a.type IN ('asset', 'expense') THEN
             CASE e.direction WHEN 'debit' THEN e.amount_minor ELSE -e.amount_minor END
           ELSE
             CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END
         END), 0)`;

const UNBALANCED_SQL = `
  SELECT transaction_id, org_id,
         SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END)::text AS debits,
         SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END)::text AS credits
    FROM ledger_entries
   GROUP BY transaction_id, org_id
  HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END)
      <> SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END)`;

/**
 * Read-only check of the whole ledger. REPEATABLE READ gives both queries one snapshot,
 * so a transfer committing mid-run can never look like drift.
 */
export async function reconcileOnce(pool: Pool): Promise<ReconcileReport> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const checked = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts");
    const drift = await client.query<{
      account_id: string;
      org_id: string;
      stored: string;
      derived: string;
    }>(DRIFT_SQL);
    const unbalanced = await client.query<{
      transaction_id: string;
      org_id: string;
      debits: string;
      credits: string;
    }>(UNBALANCED_SQL);
    await client.query("COMMIT");

    return {
      accountsChecked: checked.rows[0]?.n ?? 0,
      drifts: drift.rows.map((row) => ({
        accountId: row.account_id,
        orgId: row.org_id,
        stored: row.stored,
        derived: row.derived,
      })),
      unbalanced: unbalanced.rows.map((row) => ({
        transactionId: row.transaction_id,
        orgId: row.org_id,
        debits: row.debits,
        credits: row.credits,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runs a check, stores one history row, and raises alert events when something is wrong. */
export async function reconcileAndRecord(pool: Pool): Promise<ReconcileReport> {
  const started = new Date();
  const report = await reconcileOnce(pool);
  await pool.query(
    `INSERT INTO reconciliation_runs
       (started_at, finished_at, accounts_checked, balance_drifts, unbalanced_txns, details)
     VALUES ($1, now(), $2, $3, $4, $5::jsonb)`,
    [
      started,
      report.accountsChecked,
      report.drifts.length,
      report.unbalanced.length,
      JSON.stringify({ drifts: report.drifts, unbalanced: report.unbalanced }),
    ],
  );
  if (report.drifts.length > 0 || report.unbalanced.length > 0) {
    await emitFailureEvents(pool, report);
  }
  return report;
}

/** Writes one outbox event per affected organization, with only that organization's findings. */
export async function emitFailureEvents(pool: Pool, report: ReconcileReport): Promise<number> {
  const byOrg = new Map<string, { drifts: BalanceDrift[]; unbalanced: UnbalancedTransaction[] }>();
  for (const drift of report.drifts) {
    const entry = byOrg.get(drift.orgId) ?? { drifts: [], unbalanced: [] };
    entry.drifts.push(drift);
    byOrg.set(drift.orgId, entry);
  }
  for (const txn of report.unbalanced) {
    const entry = byOrg.get(txn.orgId) ?? { drifts: [], unbalanced: [] };
    entry.unbalanced.push(txn);
    byOrg.set(txn.orgId, entry);
  }

  for (const [orgId, findings] of byOrg) {
    await pool.query(
      `INSERT INTO outbox_events (org_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, 'ledger.reconciliation_failed', 'reconciliation', gen_random_uuid(), $2::jsonb)`,
      [orgId, JSON.stringify(findings)],
    );
  }
  return byOrg.size;
}

export class ReconcileLoop {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly pool: Pool,
    private readonly intervalMs: number,
    private readonly log: (message: string, data?: unknown) => void,
  ) {}

  start(): void {
    const tick = (): void => {
      if (this.running) return;
      this.running = true;
      this.inFlight = (async () => {
        try {
          const report = await reconcileAndRecord(this.pool);
          if (report.drifts.length > 0 || report.unbalanced.length > 0) {
            this.log("LEDGER RECONCILIATION FAILED", report);
          } else {
            this.log(`Reconciliation ok: ${report.accountsChecked} accounts`);
          }
        } catch (error) {
          this.log("Reconciliation error", error instanceof Error ? error.message : error);
        } finally {
          this.running = false;
        }
      })();
    };
    this.timer = setInterval(tick, this.intervalMs);
    tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }
}
