import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/,
      "Slug must be 3-50 characters: lowercase letters, numbers and hyphens, not starting or ending with a hyphen",
    ),
});

export type CreateOrgInput = z.infer<typeof createOrgSchema>;
