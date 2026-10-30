import { z } from "zod";
import { API_KEY_SCOPES } from "./scopes.js";

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
