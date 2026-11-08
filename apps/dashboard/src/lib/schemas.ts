import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const signUpSchema = z.object({
  fullName: z.string().trim().max(100, "Use at most 100 characters."),
  email,
  password: z
    .string()
    .min(10, "Use at least 10 characters.")
    .max(128, "Use at most 128 characters."),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const twoFactorSchema = z.object({
  code: z.string().trim().min(6, "Enter the 6-digit code or a backup code.").max(32),
});

export type SignUpValues = z.infer<typeof signUpSchema>;
export type LoginValues = z.infer<typeof loginSchema>;
export type TwoFactorValues = z.infer<typeof twoFactorSchema>;
