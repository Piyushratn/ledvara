import { z } from "zod";
import { client as defaultClient } from "./client";
import type { ApiClient } from "./http";

const overviewSchema = z.object({
  windowDays: z.number(),
  accepted: z.number(),
  refused: z.number(),
  volumeMinor: z.string(),
  daily: z.array(z.object({ date: z.string(), accepted: z.number(), volumeMinor: z.string() })),
  pendingReviews: z.number(),
  reconciliation: z.object({
    status: z.enum(["ok", "drift", "none"]),
    checkedAt: z.string().nullable(),
  }),
});

export type Overview = z.infer<typeof overviewSchema>;

export interface OverviewApi {
  get(orgId: string): Promise<Overview>;
}

export function createOverviewApi(client: ApiClient): OverviewApi {
  return {
    async get(orgId) {
      return overviewSchema.parse(await client.request(`/v1/orgs/${orgId}/overview`));
    },
  };
}

export const overviewApi: OverviewApi = createOverviewApi(defaultClient);
