export type Direction = "debit" | "credit";

export interface EntryInput {
  accountId: string;
  direction: Direction;
  /** Positive integer in minor units (paise). Never a float. */
  amountMinor: bigint;
}

export interface PostInput {
  orgId: string;
  kind: "transfer" | "refund" | "reversal" | "payout";
  reference?: string | null;
  reversesId?: string | null;
  entries: EntryInput[];
}

export interface PostedTransaction {
  id: string;
  orgId: string;
  kind: string;
  status: string;
  reference: string | null;
  createdAt: Date;
}
