import { Inject, Injectable } from "@nestjs/common";
import { schema, type Db } from "@ledvara/db";
import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { balanceDelta } from "./balance-rules.js";
import type { PostedTransaction, PostInput } from "./ledger.types.js";

export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

@Injectable()
export class LedgerService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  /** Posts in its own database transaction, or inside the caller's when `tx` is given. */
  async post(input: PostInput, tx?: DbTx): Promise<PostedTransaction> {
    this.validateShape(input);
    if (tx) return this.postWithin(tx, input);
    return this.deps.db.transaction((own) => this.postWithin(own, input));
  }

  private async postWithin(tx: DbTx, input: PostInput): Promise<PostedTransaction> {
    const accountIds = [...new Set(input.entries.map((e) => e.accountId))].sort();

    // Lock in sorted order so two opposing transfers cannot deadlock.
    const accounts = await tx
      .select()
      .from(schema.accounts)
      .where(and(inArray(schema.accounts.id, accountIds), eq(schema.accounts.orgId, input.orgId)))
      .orderBy(schema.accounts.id)
      .for("update");

    if (accounts.length !== accountIds.length) {
      throw new AppError(404, ErrorCodes.NotFound, "One or more accounts were not found.");
    }
    if (new Set(accounts.map((a) => a.currency)).size !== 1) {
      throw new AppError(422, ErrorCodes.ValidationFailed, "All accounts must share one currency.");
    }
    if (accounts.some((a) => a.closedAt !== null)) {
      throw new AppError(409, "account_closed", "One of the accounts is closed.");
    }

    const byId = new Map(accounts.map((a) => [a.id, a]));
    const newBalances = new Map(accounts.map((a) => [a.id, a.balanceMinor]));
    for (const entry of input.entries) {
      const account = byId.get(entry.accountId);
      if (!account) continue;
      const current = newBalances.get(account.id) ?? 0n;
      newBalances.set(
        account.id,
        current + balanceDelta(account.type, entry.direction, entry.amountMinor),
      );
    }
    for (const account of accounts) {
      const next = newBalances.get(account.id) ?? 0n;
      if (!account.allowNegative && next < 0n) {
        throw new AppError(409, "insufficient_funds", "Insufficient funds.");
      }
    }

    const [txn] = await tx
      .insert(schema.transactions)
      .values({
        orgId: input.orgId,
        kind: input.kind,
        reference: input.reference ?? null,
        reversesId: input.reversesId ?? null,
      })
      .returning();
    if (!txn) {
      throw new AppError(500, ErrorCodes.InternalError, "Could not create the transaction.");
    }

    await tx.insert(schema.ledgerEntries).values(
      input.entries.map((entry) => ({
        transactionId: txn.id,
        orgId: input.orgId,
        accountId: entry.accountId,
        direction: entry.direction,
        amountMinor: entry.amountMinor,
      })),
    );

    for (const account of accounts) {
      const next = newBalances.get(account.id);
      if (next !== undefined && next !== account.balanceMinor) {
        await tx
          .update(schema.accounts)
          .set({ balanceMinor: next })
          .where(eq(schema.accounts.id, account.id));
      }
    }

    return {
      id: txn.id,
      orgId: txn.orgId,
      kind: txn.kind,
      status: txn.status,
      reference: txn.reference,
      createdAt: txn.createdAt,
    };
  }

  private validateShape(input: PostInput): void {
    if (input.entries.length < 2) {
      throw new AppError(
        422,
        ErrorCodes.ValidationFailed,
        "A transaction needs at least 2 entries.",
      );
    }
    let debits = 0n;
    let credits = 0n;
    for (const entry of input.entries) {
      if (typeof entry.amountMinor !== "bigint" || entry.amountMinor <= 0n) {
        throw new AppError(422, ErrorCodes.ValidationFailed, "Amounts must be positive integers.");
      }
      if (entry.direction === "debit") debits += entry.amountMinor;
      else credits += entry.amountMinor;
    }
    if (debits !== credits) {
      throw new AppError(422, ErrorCodes.ValidationFailed, "Debits must equal credits.");
    }
  }
}
