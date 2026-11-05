import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { OutboxService } from "../outbox/outbox.service.js";
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

/** Refusals that say something about the caller's behavior. Validation errors and 404s do not. */
const LOGGED_FAILURE_CODES = new Set(["insufficient_funds", "account_closed"]);

@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async create(
    orgId: string,
    idempotencyKey: string,
    input: CreateTransferInput,
    apiKeyId: string | null = null,
  ): Promise<StoredResponse & { replayed: boolean }> {
    try {
      return await this.createInTransaction(orgId, idempotencyKey, input, apiKeyId);
    } catch (error) {
      // The refusal rolled everything back, so it is recorded here, outside that transaction.
      if (error instanceof AppError && LOGGED_FAILURE_CODES.has(error.code)) {
        await this.recordFailure(orgId, input, apiKeyId, error.code);
      }
      throw error;
    }
  }

  private async createInTransaction(
    orgId: string,
    idempotencyKey: string,
    input: CreateTransferInput,
    apiKeyId: string | null,
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

      await this.outbox.enqueue(tx, {
        orgId,
        type: "transfer.settled",
        aggregateType: "transfer",
        aggregateId: posted.id,
        payload: {
          id: posted.id,
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amountMinor: amount.toString(),
          currency: view.currency,
          reference: posted.reference,
          apiKeyId,
        },
      });

      return { status: 201, body: JSON.parse(JSON.stringify(view)) as unknown };
    });
  }

  private async recordFailure(
    orgId: string,
    input: CreateTransferInput,
    apiKeyId: string | null,
    code: string,
  ): Promise<void> {
    try {
      await this.deps.db.insert(schema.transferFailures).values({
        orgId,
        fromAccountId: input.fromAccountId,
        apiKeyId,
        amountMinor: BigInt(input.amountMinor),
        code,
      });
    } catch (loggingError) {
      // Logging a failure must never hide the real error from the client.
      this.logger.error({ err: loggingError }, "Failed to record transfer failure");
    }
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
