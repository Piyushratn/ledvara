import { z } from "zod";

const EVENT_TYPE = /^(\*|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*)$/u;

export const createEndpointSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  description: z.string().trim().max(200).optional(),
  eventTypes: z.array(z.string().regex(EVENT_TYPE)).min(1).max(20).default(["*"]),
});

export const updateEndpointSchema = z
  .object({
    url: z.string().trim().min(1).max(2048).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    eventTypes: z.array(z.string().regex(EVENT_TYPE)).min(1).max(20).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Provide at least one field to change.",
  });

export const listDeliveriesSchema = z.object({
  status: z.enum(["pending", "succeeded", "failed"]).optional(),
  endpointId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const replayFailedSchema = z.object({
  endpointId: z.string().uuid().optional(),
});

export const endpointIdSchema = z.string().uuid();

export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;
export type UpdateEndpointInput = z.infer<typeof updateEndpointSchema>;
export type ListDeliveriesInput = z.infer<typeof listDeliveriesSchema>;
