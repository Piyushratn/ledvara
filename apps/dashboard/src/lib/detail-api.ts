import { z } from "zod";
import { client as defaultClient } from "./client";
import type { ApiClient } from "./http";

const account = z.object({ id: z.string(), code: z.string().nullable(), name: z.string() });

const detailSchema = z.object({
  transfer: z.object({
    id: z.string(),
    status: z.string(),
    reference: z.string().nullable(),
    createdAt: z.string(),
    amountMinor: z.string().nullable(),
    currency: z.string().nullable(),
    from: account.nullable(),
    to: account.nullable(),
  }),
  timeline: z.array(z.object({ status: z.string(), at: z.string(), approximate: z.boolean() })),
  entries: z.array(
    z.object({
      id: z.string(),
      accountId: z.string(),
      accountName: z.string(),
      direction: z.string(),
      amountMinor: z.string(),
    }),
  ),
  related: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      status: z.string(),
      createdAt: z.string(),
      relation: z.string(),
    }),
  ),
  risk: z
    .object({
      score: z.number(),
      level: z.string(),
      flagged: z.boolean(),
      rulesVersion: z.string(),
      reasons: z.array(z.object({ rule: z.string(), points: z.number(), reason: z.string() })),
      review: z
        .object({
          id: z.string(),
          status: z.string(),
          note: z.string().nullable(),
          decidedAt: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  deliveries: z.array(
    z.object({
      id: z.string(),
      endpointId: z.string(),
      eventType: z.string(),
      status: z.string(),
      attempts: z.number(),
      lastStatusCode: z.number().nullable(),
      lastError: z.string().nullable(),
      lastAttemptAt: z.string().nullable(),
    }),
  ),
  audit: z
    .array(
      z.object({
        action: z.string(),
        actorType: z.string(),
        actorId: z.string().nullable(),
        at: z.string(),
      }),
    )
    .nullable(),
});

export type TransferDetail = z.infer<typeof detailSchema>;

export interface DetailApi {
  get(orgId: string, transferId: string): Promise<TransferDetail>;
  resend(orgId: string, deliveryId: string): Promise<void>;
}

export function createDetailApi(client: ApiClient): DetailApi {
  return {
    async get(orgId, transferId) {
      return detailSchema.parse(
        await client.request(`/v1/orgs/${orgId}/transfers/${transferId}/detail`),
      );
    },
    async resend(orgId, deliveryId) {
      await client.request(`/v1/orgs/${orgId}/webhook-deliveries/${deliveryId}/resend`, {
        method: "POST",
        body: {},
      });
    },
  };
}

export const detailApi: DetailApi = createDetailApi(defaultClient);
