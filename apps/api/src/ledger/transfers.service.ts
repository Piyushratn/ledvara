import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { hashRequest, IdempotencyService, type StoredResponse } from "./idempotency.service.js";
import { LedgerService } from "./ledger.service.js";
import type { CreateTransferInput } from "./transfers.schemas.js";

export interface TransferView {
  id: string;
  status: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: string;
  currency: string;
  reference: string | null;
  createdAt: Date;
}

@Injectable()
export class TransfersService {
  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  async create(
    orgId: string,
    idempotencyKey: string,
    input: CreateTransferInput,
  ): Promise<StoredResponse & { replayed: boolean }> {
    const hash = hashRequest("POST", "/v1/transfers", input);
    return this.idempotency.run(orgId, idempotencyKey, hash, async (tx) => {
      const amount = BigInt(input.amountMinor);
      const posted = await this.ledger.post(
        {
          orgId,
          kind: "transfer",
          reference: input.reference ?? null,
          entries: [
            { accountId: input.fromAccountId, direction: "debit", amountMinor: amount },
            { accountId: input.toAccountId, direction: "credit", amountMinor: amount },
          ],
        },
        tx,
      );
      // Money has moved inside this database transaction, so the transfer is settled.
      await tx
        .update(schema.transactions)
        .set({ status: "settled" })
        .where(eq(schema.transactions.id, posted.id));

      const [account] = await tx
        .select({ currency: schema.accounts.currency })
        .from(schema.accounts)
        .where(eq(schema.accounts.id, input.fromAccountId))
        .limit(1);

      const view: TransferView = {
        id: posted.id,
        status: "settled",
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amountMinor: amount.toString(),
        currency: account?.currency ?? "INR",
        reference: posted.reference,
        createdAt: posted.createdAt,
      };
      return { status: 201, body: JSON.parse(JSON.stringify(view)) as unknown };
    });
  }

  async get(orgId: string, id: string): Promise<TransferView> {
    const [txn] = await this.deps.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.id, id),
          eq(schema.transactions.orgId, orgId),
          eq(schema.transactions.kind, "transfer"),
        ),
      )
      .limit(1);
    if (!txn) {
      throw new AppError(404, ErrorCodes.NotFound, "Transfer not found.");
    }

    const entries = await this.deps.db
      .select({
        accountId: schema.ledgerEntries.accountId,
        direction: schema.ledgerEntries.direction,
        amountMinor: schema.ledgerEntries.amountMinor,
        currency: schema.accounts.currency,
      })
      .from(schema.ledgerEntries)
      .innerJoin(schema.accounts, eq(schema.ledgerEntries.accountId, schema.accounts.id))
      .where(eq(schema.ledgerEntries.transactionId, txn.id));

    const debit = entries.find((e) => e.direction === "debit");
    const credit = entries.find((e) => e.direction === "credit");
    if (!debit || !credit) {
      throw new AppError(500, ErrorCodes.InternalError, "Transfer is malformed.");
    }
    return {
      id: txn.id,
      status: txn.status,
      fromAccountId: debit.accountId,
      toAccountId: credit.accountId,
      amountMinor: debit.amountMinor.toString(),
      currency: debit.currency,
      reference: txn.reference,
      createdAt: txn.createdAt,
    };
  }
}
