import { z } from "zod";

export const simConfigSchema = z.object({
  /** Milliseconds between accepting a payout and finishing it. */
  latencyMs: z.number().int().min(0).max(60_000),
  /** Probability (0 to 1) that a payout ends as failed. */
  failureRate: z.number().min(0).max(1),
  /** Probability that the final event is delivered twice. */
  duplicateRate: z.number().min(0).max(1),
  /** Probability that the final event is delivered before the processing event. */
  outOfOrderRate: z.number().min(0).max(1),
});

export type SimConfig = z.infer<typeof simConfigSchema>;

export const configPatchSchema = simConfigSchema.partial().strict();

export const DEFAULT_CONFIG: SimConfig = {
  latencyMs: 200,
  failureRate: 0.1,
  duplicateRate: 0.1,
  outOfOrderRate: 0.1,
};
