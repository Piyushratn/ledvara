import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  WEBHOOK_SECRET_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/iu, "must be 64 hex characters")
    .optional(),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  // Only for local tests: lets the worker call localhost receivers. Never enable in production.
  WEBHOOK_ALLOW_PRIVATE_TARGETS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid worker configuration:\n${problems.join("\n")}`);
  }
  return result.data;
}
