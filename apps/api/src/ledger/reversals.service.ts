import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { hashRequest, IdempotencyService, type StoredResponse } from "./idempotency.service.js";
import { LedgerService } from "./ledger.service.js";
import type { EntryInput } from "./ledger.types.js";

@Injectable()
export class ReversalsService {
  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  async reverse(
    orgId: string,
    transferId: string,
    idempotencyKey: string,
  ): Promise<StoredResponse & { replayed: boolean }> {
    const hash = hashRequest("POST", `/v1/transfers/${transferId}/reverse`, {});
    return this.idempotency.run(orgId, idempotencyKey, hash, async (tx) => {
      // Lock the original so concurrent reversals queue here.
      const [original] = await tx
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.id, transferId),
            eq(schema.transactions.orgId, orgId),
            eq(schema.transactions.kind, "transfer"),
          ),
        )
        .for("update")
        .limit(1);
      if (!original) {
        throw new AppError(404, ErrorCodes.NotFound, "Transfer not found.");
      }
      if (original.status === "reversed") {
        throw new AppError(409, "already_reversed", "This transfer was already reversed.");
      }
      if (original.status !== "settled") {
        throw new AppError(
          409,
          "invalid_transition",
          `Cannot reverse a ${original.status} transfer.`,
        );
      }

      const refundCount = await tx.execute(sql`
        SELECT count(*)::int AS n FROM transactions
         WHERE reverses_id = ${original.id} AND kind = 'refund'
      `);
      if (((refundCount.rows[0] as { n?: number } | undefined)?.n ?? 0) > 0) {
        throw new AppError(409, "has_refunds", "A transfer with refunds cannot be reversed.");
      }

      const entries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.transactionId, original.id));
      const flipped: EntryInput[] = entries.map((e) => ({
        accountId: e.accountId,
        direction: e.direction === "debit" ? "credit" : "debit",
        amountMinor: e.amountMinor,
      }));

      const posted = await this.ledger.post(
        {
          orgId,
          kind: "reversal",
          reversesId: original.id,
          reference: `reversal of ${original.id}`,
          entries: flipped,
        },
        tx,
      );
      await tx
        .update(schema.transactions)
        .set({ status: "settled" })
        .where(eq(schema.transactions.id, posted.id));
      await tx
        .update(schema.transactions)
        .set({ status: "reversed" })
        .where(eq(schema.transactions.id, original.id));

      return {
        status: 201,
        body: {
          id: posted.id,
          kind: "reversal",
          status: "settled",
          reversesId: original.id,
          createdAt: posted.createdAt.toISOString(),
        },
      };
    });
  }
}
