import type { OutboxRow } from "../relay.js";
import { DELIVERY_JOB_OPTIONS, type DeliveryJob } from "./deliver.js";

export interface FanOutStore {
  findEndpointIds(orgId: string, eventType: string): Promise<string[]>;
}

export interface DeliveryQueue {
  add(name: string, data: DeliveryJob, options: Record<string, unknown>): Promise<unknown>;
}

/** Creates one delivery job per matching endpoint. Repeating it for the same event is a no-op. */
export async function fanOut(
  event: OutboxRow,
  store: FanOutStore,
  queue: DeliveryQueue,
): Promise<number> {
  const endpointIds = await store.findEndpointIds(event.org_id, event.type);
  for (const endpointId of endpointIds) {
    const data: DeliveryJob = {
      endpointId,
      orgId: event.org_id,
      eventId: event.id,
      eventType: event.type,
      payload: event.payload,
      createdAt: event.created_at,
    };
    // BullMQ forbids ":" in custom job ids, hence the underscore.
    await queue.add(event.type, data, {
      ...DELIVERY_JOB_OPTIONS,
      jobId: `${event.id}_${endpointId}`,
    });
  }
  return endpointIds.length;
}
