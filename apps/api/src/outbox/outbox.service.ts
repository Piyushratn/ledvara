import { Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import type { DbTx } from "../ledger/ledger.service.js";

export type OutboxType =
  | "transfer.settled"
  | "transfer.reversed"
  | "refund.created"
  | "payout.created"
  | "payout.settled"
  | "payout.failed";

@Injectable()
export class OutboxService {
  /**
   * Must be called with the same transaction that changed the ledger, so the event commits
   * or rolls back together with the money movement.
   */
  async enqueue(
    tx: DbTx,
    event: {
      orgId: string;
      type: OutboxType;
      aggregateType: "transfer" | "refund" | "payout";
      aggregateId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.insert(schema.outboxEvents).values({
      orgId: event.orgId,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
    });
  }
}
