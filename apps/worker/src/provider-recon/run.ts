import type { Pool } from "pg";
import { z } from "zod";
import { classify, type LedgerPayout, type ProviderEntry, type ReconResult } from "./classify.js";

export interface PayoutRow extends LedgerPayout {
  createdAt: Date;
}

const reportSchema = z.object({
  data: z.array(
    z.object({
      providerRef: z.string(),
      reference: z.string(),
      amountMinor: z.string(),
      status: z.enum(["settled", "failed"]),
    }),
  ),
});

export type ReportFetcher = () => Promise<ProviderEntry[]>;

export function httpReportFetcher(
  baseUrl: string,
  apiKey: string,
  timeoutMs = 10_000,
): ReportFetcher {
  return async () => {
    const response = await fetch(new URL("/settlement-report", baseUrl), {
      headers: { "x-provider-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Provider report request failed: HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    return reportSchema.parse(body).data;
  };
}

/**
 * Leaves out payouts younger than the grace window, on both sides, so a payout that is
 * settling right now is never compared. Pure: the clock is passed in.
 */
export function excludeRecent(
  ledger: readonly PayoutRow[],
  report: readonly ProviderEntry[],
  graceMs: number,
  nowMs: number,
): { ledger: PayoutRow[]; report: ProviderEntry[] } {
  const recent = new Set(
    ledger.filter((p) => nowMs - p.createdAt.getTime() < graceMs).map((p) => p.id),
  );
  return {
    ledger: ledger.filter((p) => !recent.has(p.id)),
    report: report.filter((e) => !recent.has(e.reference)),
  };
}

async function loadPayouts(pool: Pool): Promise<PayoutRow[]> {
  const { rows } = await pool.query<{
    id: string;
    org_id: string;
    amount_minor: string;
    status: string;
    created_at: Date;
  }>(
    `SELECT p.id, p.org_id, p.amount_minor::text AS amount_minor, t.status, p.created_at
       FROM payouts p
       JOIN transactions t ON t.id = p.transaction_id`,
  );
  return rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    amountMinor: BigInt(row.amount_minor),
    status: row.status,
    createdAt: row.created_at,
  }));
}

export interface ProviderReconOptions {
  graceMs: number;
  now?: () => number;
}

export interface ProviderReconOutcome extends ReconResult {
  runId: string;
  payoutsChecked: number;
  reportEntries: number;
}

/** Fetches the report, classifies, and stores one run. A failed fetch is stored as an error run. */
export async function reconcileProvider(
  pool: Pool,
  fetchReport: ReportFetcher,
  options: ProviderReconOptions,
): Promise<ProviderReconOutcome> {
  const startedAt = new Date();

  let report: ProviderEntry[];
  try {
    report = await fetchReport();
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown error";
    await pool.query(
      `INSERT INTO provider_reconciliation_runs (started_at, finished_at, status, error)
       VALUES ($1, now(), 'error', $2)`,
      [startedAt, message],
    );
    throw error;
  }

  const payouts = await loadPayouts(pool);
  const compared = excludeRecent(payouts, report, options.graceMs, (options.now ?? Date.now)());
  const result = classify(compared.ledger, compared.report);
  const discrepancies = result.items.filter((item) => item.kind !== "matched");

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO provider_reconciliation_runs
       (started_at, finished_at, status, payouts_checked, report_entries, counts, items)
     VALUES ($1, now(), 'ok', $2, $3, $4::jsonb, $5::jsonb)
     RETURNING id`,
    [
      startedAt,
      compared.ledger.length,
      compared.report.length,
      JSON.stringify(result.counts),
      JSON.stringify(discrepancies),
    ],
  );

  return {
    ...result,
    runId: inserted.rows[0]?.id ?? "",
    payoutsChecked: compared.ledger.length,
    reportEntries: compared.report.length,
  };
}

export class ProviderReconLoop {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly pool: Pool,
    private readonly fetchReport: ReportFetcher,
    private readonly graceMs: number,
    private readonly intervalMs: number,
    private readonly log: (message: string, data?: unknown) => void,
  ) {}

  start(): void {
    const tick = (): void => {
      if (this.running) return;
      this.running = true;
      this.inFlight = (async () => {
        try {
          const outcome = await reconcileProvider(this.pool, this.fetchReport, {
            graceMs: this.graceMs,
          });
          const bad = outcome.items.filter((item) => item.kind !== "matched");
          if (bad.length > 0) {
            this.log("PROVIDER RECONCILIATION FOUND DISCREPANCIES", {
              counts: outcome.counts,
              runId: outcome.runId,
            });
          } else {
            this.log(`Provider reconciliation ok: ${outcome.payoutsChecked} payouts`);
          }
        } catch (error) {
          this.log("Provider reconciliation error", error instanceof Error ? error.message : error);
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
