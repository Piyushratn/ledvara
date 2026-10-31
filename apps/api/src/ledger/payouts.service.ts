import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { hashRequest, IdempotencyService, type StoredResponse } from "./idempotency.service.js";
import { LedgerService, type DbTx } from "./ledger.service.js";
import type { CreatePayoutInput } from "./payouts.schemas.js";

export interface PayoutView {
  id: string;
  transactionId: string;
  status: string;
  sourceAccountId: string;
  amountMinor: string;
  destinationLabel: string;
  createdAt: Date;
}

@Injectable()
export class PayoutsService {
  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  async create(
    orgId: string,
    idempotencyKey: string,
    input: CreatePayoutInput,
  ): Promise<StoredResponse & { replayed: boolean }> {
    const hash = hashRequest("POST", "/v1/payouts", input);
    return this.idempotency.run(orgId, idempotencyKey, hash, async (tx) => {
      const clearing = await this.systemAccount(tx, orgId, "payout_clearing", "liability");
      const amount = BigInt(input.amountMinor);

      const [source] = await tx
        .select({ type: schema.accounts.type })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.id, input.sourceAccountId), eq(schema.accounts.orgId, orgId)))
        .limit(1);
      if (!source) {
        throw new AppError(404, ErrorCodes.NotFound, "Source account not found.");
      }
      if (source.type !== "wallet") {
        throw new AppError(
          422,
          ErrorCodes.ValidationFailed,
          "Payouts can only come from a wallet.",
        );
      }

      // Hold the money: wallet debited, clearing credited. Fails with insufficient_funds if short.
      const posted = await this.ledger.post(
        {
          orgId,
          kind: "payout",
          reference: `payout to ${input.destinationLabel}`,
          entries: [
            { accountId: input.sourceAccountId, direction: "debit", amountMinor: amount },
            { accountId: clearing, direction: "credit", amountMinor: amount },
          ],
        },
        tx,
      );
      await tx
        .update(schema.transactions)
        .set({ status: "pending" })
        .where(eq(schema.transactions.id, posted.id));

      const [payout] = await tx
        .insert(schema.payouts)
        .values({
          orgId,
          transactionId: posted.id,
          sourceAccountId: input.sourceAccountId,
          amountMinor: amount,
          destinationLabel: input.destinationLabel,
        })
        .returning();
      if (!payout) {
        throw new AppError(500, ErrorCodes.InternalError, "Could not create the payout.");
      }

      const view: PayoutView = {
        id: payout.id,
        transactionId: posted.id,
        status: "pending",
        sourceAccountId: input.sourceAccountId,
        amountMinor: amount.toString(),
        destinationLabel: payout.destinationLabel,
        createdAt: payout.createdAt,
      };
      return { status: 201, body: JSON.parse(JSON.stringify(view)) as unknown };
    });
  }

  async get(orgId: string, id: string): Promise<PayoutView> {
    const [row] = await this.deps.db
      .select({
        id: schema.payouts.id,
        transactionId: schema.payouts.transactionId,
        status: schema.transactions.status,
        sourceAccountId: schema.payouts.sourceAccountId,
        amountMinor: schema.payouts.amountMinor,
        destinationLabel: schema.payouts.destinationLabel,
        createdAt: schema.payouts.createdAt,
      })
      .from(schema.payouts)
      .innerJoin(schema.transactions, eq(schema.payouts.transactionId, schema.transactions.id))
      .where(and(eq(schema.payouts.id, id), eq(schema.payouts.orgId, orgId)))
      .limit(1);
    if (!row) {
      throw new AppError(404, ErrorCodes.NotFound, "Payout not found.");
    }
    return { ...row, amountMinor: row.amountMinor.toString() };
  }

  /** Finds or creates a per-organization system account. Safe under concurrency. */
  private async systemAccount(
    tx: DbTx,
    orgId: string,
    code: string,
    type: "liability" | "asset",
  ): Promise<string> {
    await tx
      .insert(schema.accounts)
      .values({ orgId, code, name: code, type, allowNegative: true })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.orgId, orgId), eq(schema.accounts.code, code)))
      .limit(1);
    if (!row) {
      throw new AppError(500, ErrorCodes.InternalError, "System account missing.");
    }
    return row.id;
  }
}
