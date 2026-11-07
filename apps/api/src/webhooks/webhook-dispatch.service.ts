import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { WebhookQueueService, type DeliveryJobData } from "./webhook-queue.service.js";

const REPLAY_BATCH = 100;

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

  /**
   * Re-queues up to 100 dead-lettered (failed) deliveries. Only deliveries that can really be
   * rebuilt are picked: the event must still be in the outbox and the endpoint must be enabled.
   * Test pings never go through the outbox, so they are never selected.
   */
  async replayFailed(
    orgId: string,
    endpointId?: string,
  ): Promise<{ queued: number; skipped: number }> {
    const conditions: SQL[] = [
      eq(schema.webhookDeliveries.orgId, orgId),
      eq(schema.webhookDeliveries.status, "failed"),
      sql`exists (select 1 from outbox_events o
                   where o.id = ${schema.webhookDeliveries.eventId}
                     and o.org_id = ${schema.webhookDeliveries.orgId})`,
      sql`exists (select 1 from webhook_endpoints e
                   where e.id = ${schema.webhookDeliveries.endpointId} and e.enabled)`,
    ];
    if (endpointId) conditions.push(eq(schema.webhookDeliveries.endpointId, endpointId));

    const failed = await this.deps.db
      .select({ id: schema.webhookDeliveries.id })
      .from(schema.webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(REPLAY_BATCH);

    let queued = 0;
    let skipped = 0;
    for (const row of failed) {
      try {
        await this.resend(orgId, row.id);
        queued += 1;
      } catch (error) {
        // Something changed between the query and the resend (for example, the endpoint was
        // disabled). Skip that one and keep going.
        if (error instanceof AppError) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
    return { queued, skipped };
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
