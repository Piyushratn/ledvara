import { z } from "zod";

export const createAccountSchema = z.object({
  code: z
    .string()
    .regex(/^[a-z0-9_]{2,64}$/u, "Use 2-64 lowercase letters, numbers or underscores")
    .optional(),
  name: z.string().trim().min(1).max(100),
  type: z.enum(["asset", "liability", "revenue", "expense", "wallet"]),
  allowNegative: z.boolean().default(false),
});

export const balanceQuerySchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
