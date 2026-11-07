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
  // 0 disables the reconciliation loop.
  RECONCILE_INTERVAL_MS: z.coerce
    .number()
    .int()
    .refine((value) => value === 0 || (value >= 10_000 && value <= 86_400_000), {
      message: "must be 0 or between 10000 and 86400000",
    })
    .default(3_600_000),
  PROVIDER_URL: z.string().url().default("http://localhost:4000"),
  PROVIDER_API_KEY: z.string().min(1).default("sim-dev-key"),
  // 0 disables the provider reconciliation loop.
  PROVIDER_RECON_INTERVAL_MS: z.coerce
    .number()
    .int()
    .refine((value) => value === 0 || (value >= 10_000 && value <= 86_400_000), {
      message: "must be 0 or between 10000 and 86400000",
    })
    .default(3_600_000),
  PROVIDER_RECON_GRACE_MS: z.coerce.number().int().min(0).max(3_600_000).default(120_000),
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
