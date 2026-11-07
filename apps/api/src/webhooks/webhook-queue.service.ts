import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "../config/env.js";

// Must match apps/worker/src/webhooks/deliver.ts.
export const DELIVERY_QUEUE_NAME = "webhook-deliveries";
export const DELIVERY_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: "exponential" as const, delay: 10_000, jitter: 0.5 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export interface DeliveryJobData {
  endpointId: string;
  orgId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

@Injectable()
export class WebhookQueueService implements OnApplicationShutdown {
  private queue: Queue | undefined;
  private connection: Redis | undefined;

  async enqueue(data: DeliveryJobData, jobId: string): Promise<void> {
    await this.getQueue().add(data.eventType, data, { ...DELIVERY_JOB_OPTIONS, jobId });
  }

  private getQueue(): Queue {
    if (!this.queue) {
      // BullMQ requires maxRetriesPerRequest: null, unlike the API's health-check connection.
      this.connection = new Redis(loadEnv().REDIS_URL, { maxRetriesPerRequest: null });
      this.queue = new Queue(DELIVERY_QUEUE_NAME, { connection: this.connection });
    }
    return this.queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}
