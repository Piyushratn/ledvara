import { Inject, Injectable } from "@nestjs/common";
import { Dependencies } from "../health/dependencies.js";

export interface ReconciliationRunView {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  accountsChecked: number;
  ok: boolean;
  drifts: { accountId: string; stored: string; derived: string }[];
  unbalanced: { transactionId: string; debits: string; credits: string }[];
}

interface Details {
  drifts?: { accountId: string; orgId: string; stored: string; derived: string }[];
  unbalanced?: { transactionId: string; orgId: string; debits: string; credits: string }[];
}

@Injectable()
export class ReconciliationService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async listForOrg(orgId: string, limit = 20): Promise<ReconciliationRunView[]> {
    const { rows } = await this.deps.pool.query<{
      id: string;
      started_at: Date;
      finished_at: Date | null;
      accounts_checked: number;
      details: Details;
    }>(
      `SELECT id, started_at, finished_at, accounts_checked, details
         FROM reconciliation_runs ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );

    return rows.map((row) => {
      // Only this organization's findings leave the service.
      const drifts = (row.details.drifts ?? [])
        .filter((d) => d.orgId === orgId)
        .map(({ accountId, stored, derived }) => ({ accountId, stored, derived }));
      const unbalanced = (row.details.unbalanced ?? [])
        .filter((t) => t.orgId === orgId)
        .map(({ transactionId, debits, credits }) => ({ transactionId, debits, credits }));
      return {
        id: row.id,
        startedAt: row.started_at.toISOString(),
        finishedAt: row.finished_at?.toISOString() ?? null,
        accountsChecked: row.accounts_checked,
        ok: drifts.length === 0 && unbalanced.length === 0,
        drifts,
        unbalanced,
      };
    });
  }
}
