import { Inject, Injectable } from "@nestjs/common";
import { Dependencies } from "../health/dependencies.js";

export interface ProviderDiscrepancyView {
  kind: string;
  payoutId: string;
  providerRef: string | null;
  ledgerAmountMinor: string | null;
  providerAmountMinor: string | null;
  ledgerStatus: string | null;
  providerStatus: string | null;
}

export interface ProviderRunView {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  ok: boolean;
  discrepancies: ProviderDiscrepancyView[];
}

interface StoredItem extends Omit<ProviderDiscrepancyView, "payoutId"> {
  payoutId: string | null;
  orgId: string | null;
}

@Injectable()
export class ProviderReconciliationService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async listForOrg(orgId: string, limit = 20): Promise<ProviderRunView[]> {
    const { rows } = await this.deps.pool.query<{
      id: string;
      started_at: Date;
      finished_at: Date | null;
      status: string;
      items: StoredItem[];
    }>(
      `SELECT id, started_at, finished_at, status, items
         FROM provider_reconciliation_runs ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );

    return rows.map((row) => {
      // Only this organization's findings leave the service. Items with no organization
      // (the provider reports a payout we never made) are never shown to a tenant.
      const discrepancies = row.items
        .filter(
          (item): item is StoredItem & { payoutId: string } =>
            item.orgId === orgId && item.payoutId !== null,
        )
        .map((item) => ({
          kind: item.kind,
          payoutId: item.payoutId,
          providerRef: item.providerRef,
          ledgerAmountMinor: item.ledgerAmountMinor,
          providerAmountMinor: item.providerAmountMinor,
          ledgerStatus: item.ledgerStatus,
          providerStatus: item.providerStatus,
        }));
      return {
        id: row.id,
        startedAt: row.started_at.toISOString(),
        finishedAt: row.finished_at?.toISOString() ?? null,
        status: row.status,
        ok: row.status === "ok" && discrepancies.length === 0,
        discrepancies,
      };
    });
  }
}
