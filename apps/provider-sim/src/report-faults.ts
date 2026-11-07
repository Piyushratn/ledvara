import type { PayoutStatus } from "./simulator.js";

export interface ReportEntry {
  providerRef: string;
  reference: string;
  amountMinor: string;
  status: PayoutStatus;
}

/** Faults change only what the settlement report says. The simulator's payouts stay correct. */
export interface ReportFaults {
  /** References to leave out of the report. */
  drop: string[];
  /** Reference -> amount (minor units, as a string) to report instead. */
  amountOverrides: Record<string, string>;
  /** Reference -> final status to report instead. */
  statusOverrides: Record<string, "settled" | "failed">;
  /** Invented entries the provider "knows" but we never created. */
  extra: ReportEntry[];
}

export const NO_FAULTS: ReportFaults = {
  drop: [],
  amountOverrides: {},
  statusOverrides: {},
  extra: [],
};

export function applyReportFaults(
  report: readonly ReportEntry[],
  faults: ReportFaults,
): ReportEntry[] {
  const dropped = new Set(faults.drop);
  // Maps, so a reference like "constructor" cannot hit an inherited property.
  const amounts = new Map(Object.entries(faults.amountOverrides));
  const statuses = new Map(Object.entries(faults.statusOverrides));

  const kept = report
    .filter((entry) => !dropped.has(entry.reference))
    .map((entry) => ({
      ...entry,
      amountMinor: amounts.get(entry.reference) ?? entry.amountMinor,
      status: statuses.get(entry.reference) ?? entry.status,
    }));
  return [...kept, ...faults.extra];
}
