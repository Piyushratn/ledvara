import { z } from "zod";

export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Password must be at least 10 characters").max(128),
  fullName: z.string().trim().min(1).max(100).optional(),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
