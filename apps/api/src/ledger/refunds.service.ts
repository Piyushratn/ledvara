import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { hashRequest, IdempotencyService, type StoredResponse } from "./idempotency.service.js";
import { LedgerService } from "./ledger.service.js";
import type { CreateRefundInput } from "./refunds.schemas.js";

@Injectable()
export class RefundsService {
  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  async refund(
    orgId: string,
    transferId: string,
    idempotencyKey: string,
    input: CreateRefundInput,
  ): Promise<StoredResponse & { replayed: boolean }> {
    const hash = hashRequest("POST", `/v1/transfers/${transferId}/refunds`, input);
    return this.idempotency.run(orgId, idempotencyKey, hash, async (tx) => {
      // Lock the original: concurrent refunds of the same transfer queue here.
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
      if (original.status !== "settled") {
        throw new AppError(
          409,
          "invalid_transition",
          `Cannot refund a ${original.status} transfer.`,
        );
      }

      const entries = await tx
        .select()
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.transactionId, original.id));
      const debit = entries.find((e) => e.direction === "debit");
      const credit = entries.find((e) => e.direction === "credit");
      if (!debit || !credit) {
        throw new AppError(500, ErrorCodes.InternalError, "Transfer is malformed.");
      }

      const refunded = await tx.execute(sql`
        SELECT COALESCE(SUM(e.amount_minor), 0)::text AS total
          FROM transactions t
          JOIN ledger_entries e ON e.transaction_id = t.id AND e.direction = 'debit'
         WHERE t.reverses_id = ${original.id} AND t.kind = 'refund'
      `);
      const alreadyRefunded = BigInt(
        (refunded.rows[0] as { total?: string } | undefined)?.total ?? "0",
      );
      const remaining = debit.amountMinor - alreadyRefunded;
      if (remaining <= 0n) {
        throw new AppError(409, "fully_refunded", "This transfer is already fully refunded.");
      }

      const amount = input.amountMinor === undefined ? remaining : BigInt(input.amountMinor);
      if (amount > remaining) {
        throw new AppError(
          422,
          "refund_exceeds_original",
          `Only ${remaining.toString()} paise remain refundable.`,
        );
      }

      // Money flows back: the original receiver is debited, the original sender credited.
      const posted = await this.ledger.post(
        {
          orgId,
          kind: "refund",
          reversesId: original.id,
          reference: input.reference ?? `refund of ${original.id}`,
          entries: [
            { accountId: credit.accountId, direction: "debit", amountMinor: amount },
            { accountId: debit.accountId, direction: "credit", amountMinor: amount },
          ],
        },
        tx,
      );
      await tx
        .update(schema.transactions)
        .set({ status: "settled" })
        .where(eq(schema.transactions.id, posted.id));

      return {
        status: 201,
        body: {
          id: posted.id,
          kind: "refund",
          status: "settled",
          transferId: original.id,
          amountMinor: amount.toString(),
          remainingMinor: (remaining - amount).toString(),
          createdAt: posted.createdAt.toISOString(),
        },
      };
    });
  }
}
