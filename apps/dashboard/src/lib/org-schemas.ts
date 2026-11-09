import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100, "Use at most 100 characters."),
});

export type CreateOrgValues = z.infer<typeof createOrgSchema>;
