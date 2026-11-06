import { z } from "zod";

export const listReviewsSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const approveSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const rejectSchema = z.object({
  note: z.string().trim().min(1, "A note is required when rejecting").max(500),
});

export type ListReviewsInput = z.infer<typeof listReviewsSchema>;
