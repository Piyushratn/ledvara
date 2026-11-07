export interface LedgerPayout {
  /** Our payout id. It is the reference we gave the provider. */
  id: string;
  orgId: string;
  amountMinor: bigint;
  /** Status of the payout's transaction: pending, settled or failed. */
  status: string;
}

export interface ProviderEntry {
  providerRef: string;
  reference: string;
  amountMinor: string;
  status: "settled" | "failed";
}

export type ReconKind =
  "matched" | "missing_in_ledger" | "missing_at_provider" | "amount_mismatch" | "status_mismatch";

export interface ReconItem {
  kind: ReconKind;
  payoutId: string | null;
  orgId: string | null;
  providerRef: string | null;
  ledgerAmountMinor: string | null;
  providerAmountMinor: string | null;
  ledgerStatus: string | null;
  providerStatus: string | null;
}

export interface ReconResult {
  items: ReconItem[];
  counts: Record<ReconKind, number>;
}

const KIND_ORDER: readonly ReconKind[] = [
  "missing_in_ledger",
  "missing_at_provider",
  "amount_mismatch",
  "status_mismatch",
  "matched",
];

/** Statuses the provider's report is expected to cover. A pending payout may still be in flight. */
const FINAL_STATUSES = new Set(["settled", "failed"]);

const sortKey = (item: ReconItem): string => item.payoutId ?? item.providerRef ?? "";

/**
 * Pure comparison of our payouts with the provider's settlement report.
 * No database, clock or network, so every class can be tested exhaustively.
 */
export function classify(
  ledger: readonly LedgerPayout[],
  report: readonly ProviderEntry[],
): ReconResult {
  const byId = new Map(ledger.map((payout) => [payout.id, payout]));
  const reported = new Set<string>();
  const items: ReconItem[] = [];

  for (const entry of report) {
    reported.add(entry.reference);
    const payout = byId.get(entry.reference);

    if (!payout) {
      items.push({
        kind: "missing_in_ledger",
        payoutId: null,
        orgId: null,
        providerRef: entry.providerRef,
        ledgerAmountMinor: null,
        providerAmountMinor: entry.amountMinor,
        ledgerStatus: null,
        providerStatus: entry.status,
      });
      continue;
    }

    // An unparseable provider amount can never equal ours.
    const amountOk =
      /^\d+$/u.test(entry.amountMinor) && BigInt(entry.amountMinor) === payout.amountMinor;
    let kind: ReconKind = "matched";
    if (!amountOk) kind = "amount_mismatch";
    else if (payout.status !== entry.status) kind = "status_mismatch";

    items.push({
      kind,
      payoutId: payout.id,
      orgId: payout.orgId,
      providerRef: entry.providerRef,
      ledgerAmountMinor: payout.amountMinor.toString(),
      providerAmountMinor: entry.amountMinor,
      ledgerStatus: payout.status,
      providerStatus: entry.status,
    });
  }

  for (const payout of ledger) {
    if (!FINAL_STATUSES.has(payout.status) || reported.has(payout.id)) continue;
    items.push({
      kind: "missing_at_provider",
      payoutId: payout.id,
      orgId: payout.orgId,
      providerRef: null,
      ledgerAmountMinor: payout.amountMinor.toString(),
      providerAmountMinor: null,
      ledgerStatus: payout.status,
      providerStatus: null,
    });
  }

  items.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      sortKey(a).localeCompare(sortKey(b)),
  );

  const counts: Record<ReconKind, number> = {
    matched: 0,
    missing_in_ledger: 0,
    missing_at_provider: 0,
    amount_mismatch: 0,
    status_mismatch: 0,
  };
  for (const item of items) counts[item.kind] += 1;
  return { items, counts };
}
