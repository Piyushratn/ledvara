import type { Direction } from "./ledger.types.js";

const DEBIT_NORMAL = new Set(["asset", "expense"]);

/** Signed effect of one entry on an account's stored balance. */
export function balanceDelta(accountType: string, direction: Direction, amount: bigint): bigint {
  const debitNormal = DEBIT_NORMAL.has(accountType);
  const increases = debitNormal ? direction === "debit" : direction === "credit";
  return increases ? amount : -amount;
}
