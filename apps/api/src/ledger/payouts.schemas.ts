import { z } from "zod";

export const createPayoutSchema = z.object({
  sourceAccountId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  destinationLabel: z.string().trim().min(1).max(100),
});

export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;
