import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  OUTBOX_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
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
