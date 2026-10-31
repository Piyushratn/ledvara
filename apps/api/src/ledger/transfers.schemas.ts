import { z } from "zod";

export const createTransferSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    reference: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: "Source and destination must differ",
    path: ["toAccountId"],
  });

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
