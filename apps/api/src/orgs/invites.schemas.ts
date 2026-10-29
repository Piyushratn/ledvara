import { z } from "zod";

export const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["admin", "developer", "finance", "viewer"]),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;
