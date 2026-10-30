import { z } from "zod";
import { ROLES } from "./roles.js";

export const updateMemberRoleSchema = z.object({
  role: z.enum(ROLES),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
