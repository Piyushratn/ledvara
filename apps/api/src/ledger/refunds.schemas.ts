import { z } from "zod";

export const createRefundSchema = z.object({
  /** Omit for a full refund of whatever remains. */
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  reference: z.string().trim().max(200).optional(),
});

export type CreateRefundInput = z.infer<typeof createRefundSchema>;
