import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { WebhookQueueService, type DeliveryJobData } from "./webhook-queue.service.js";

@Injectable()
export class WebhookDispatchService {
  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(WebhookQueueService) private readonly queue: WebhookQueueService,
  ) {}

  /** Queues a webhook.test event for exactly one endpoint. */
  async sendTest(orgId: string, endpointId: string): Promise<{ eventId: string }> {
    await this.requireEnabledEndpoint(orgId, endpointId);
    const eventId = randomUUID();
    const data: DeliveryJobData = {
      endpointId,
      orgId,
      eventId,
      eventType: "webhook.test",
      payload: { message: "This is a test event from Ledvara." },
      createdAt: new Date().toISOString(),
    };
    await this.queue.enqueue(data, `${eventId}_${endpointId}`);
    return { eventId };
  }

  /** Queues the original event of an earlier delivery again, for the same endpoint. */
  async resend(orgId: string, deliveryId: string): Promise<{ eventId: string }> {
    const [delivery] = await this.deps.db
      .select()
      .from(schema.webhookDeliveries)
      .where(
        and(eq(schema.webhookDeliveries.id, deliveryId), eq(schema.webhookDeliveries.orgId, orgId)),
      )
      .limit(1);
    if (!delivery) {
      throw new AppError(404, ErrorCodes.NotFound, "Webhook delivery not found.");
    }
    await this.requireEnabledEndpoint(orgId, delivery.endpointId);

    const [event] = await this.deps.db
      .select()
      .from(schema.outboxEvents)
      .where(
        and(eq(schema.outboxEvents.id, delivery.eventId), eq(schema.outboxEvents.orgId, orgId)),
      )
      .limit(1);
    if (!event) {
      throw new AppError(
        409,
        "event_not_resendable",
        "This event cannot be resent. Send a new test event instead.",
      );
    }

    const data: DeliveryJobData = {
      endpointId: delivery.endpointId,
      orgId,
      eventId: event.id,
      eventType: event.type,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    };
    // A fresh job id: BullMQ ignores a repeat of an id it still remembers.
    await this.queue.enqueue(data, `${event.id}_${delivery.endpointId}_r${Date.now()}`);
    await this.deps.db
      .update(schema.webhookDeliveries)
      .set({ status: "pending" })
      .where(eq(schema.webhookDeliveries.id, delivery.id));
    return { eventId: event.id };
  }

  private async requireEnabledEndpoint(orgId: string, endpointId: string): Promise<void> {
    const [endpoint] = await this.deps.db
      .select({ enabled: schema.webhookEndpoints.enabled })
      .from(schema.webhookEndpoints)
      .where(
        and(eq(schema.webhookEndpoints.id, endpointId), eq(schema.webhookEndpoints.orgId, orgId)),
      )
      .limit(1);
    if (!endpoint) {
      throw new AppError(404, ErrorCodes.NotFound, "Webhook endpoint not found.");
    }
    if (!endpoint.enabled) {
      throw new AppError(409, "endpoint_disabled", "This webhook endpoint is disabled.");
    }
  }
}
