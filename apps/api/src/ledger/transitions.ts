export const STATUSES = ["created", "pending", "settled", "failed", "reversed"] as const;
export type TxnStatus = (typeof STATUSES)[number];

export const ALLOWED_TRANSITIONS: Record<TxnStatus, readonly TxnStatus[]> = {
  created: ["pending", "settled", "failed"],
  pending: ["settled", "failed"],
  settled: ["reversed"],
  failed: [],
  reversed: [],
};

export function canTransition(from: TxnStatus, to: TxnStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
