import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { Dependencies } from "../health/dependencies.js";
import { LedgerService, type DbTx } from "../ledger/ledger.service.js";

export const providerEventSchema = z.object({
  eventId: z.string().min(1).max(100),
  payoutRef: z.string().min(1).max(100),
  reference: z.string().min(1).max(200),
  type: z.enum(["payout.processing", "payout.settled", "payout.failed"]),
  sequence: z.union([z.literal(1), z.literal(2)]),
  amountMinor: z.string().regex(/^\d+$/u),
  occurredAt: z.string(),
});

export type ProviderEventInput = z.infer<typeof providerEventSchema>;
export type Outcome = "applied" | "duplicate" | "ignored" | "conflict" | "unknown_payout";

@Injectable()
export class ProviderEventsService {
  private readonly logger = new Logger(ProviderEventsService.name);

  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async handle(event: ProviderEventInput): Promise<Outcome> {
    return this.deps.db.transaction(async (tx) => {
      const [claimed] = await tx
        .insert(schema.providerEvents)
        .values({
          eventId: event.eventId,
          payoutRef: event.payoutRef,
          type: event.type,
          sequence: event.sequence,
          payload: event,
          outcome: "pending",
        })
        .onConflictDoNothing({ target: schema.providerEvents.eventId })
        .returning({ id: schema.providerEvents.id });
      if (!claimed) return "duplicate";

      const outcome = await this.apply(tx, event);
      await tx
        .update(schema.providerEvents)
        .set({ outcome })
        .where(eq(schema.providerEvents.id, claimed.id));
      return outcome;
    });
  }

  private async apply(tx: DbTx, event: ProviderEventInput): Promise<Outcome> {
    // Our payout id is the reference we gave the provider.
    const [payout] = await tx
      .select({
        id: schema.payouts.id,
        orgId: schema.payouts.orgId,
        transactionId: schema.payouts.transactionId,
        sourceAccountId: schema.payouts.sourceAccountId,
        amountMinor: schema.payouts.amountMinor,
      })
      .from(schema.payouts)
      .where(eq(schema.payouts.id, event.reference))
      .for("update")
      .limit(1);
    if (!payout) return "unknown_payout";

    await tx
      .update(schema.payouts)
      .set({ providerRef: event.payoutRef })
      .where(eq(schema.payouts.id, payout.id));

    if (event.sequence === 1) return "ignored"; // "processing" changes nothing here

    if (BigInt(event.amountMinor) !== payout.amountMinor) {
      this.logger.error({ payoutId: payout.id, event }, "Provider amount differs from payout");
      return "conflict";
    }

    const [txn] = await tx
      .select({ status: schema.transactions.status })
      .from(schema.transactions)
      .where(eq(schema.transactions.id, payout.transactionId))
      .for("update")
      .limit(1);
    if (!txn) return "unknown_payout";

    const target = event.type === "payout.settled" ? "settled" : "failed";
    if (txn.status === target) return "ignored";
    if (txn.status !== "pending") {
      this.logger.error({ payoutId: payout.id, status: txn.status, event }, "Contradicting event");
      return "conflict";
    }

    const clearing = await this.account(tx, payout.orgId, "payout_clearing");
    if (target === "settled") {
      // provider_settlement is credit-normal: it holds the running total paid out to the provider.
      const settlement = await this.account(tx, payout.orgId, "provider_settlement");
      const posted = await this.ledger.post(
        {
          orgId: payout.orgId,
          kind: "payout",
          reference: `settlement of payout ${payout.id}`,
          entries: [
            { accountId: clearing, direction: "debit", amountMinor: payout.amountMinor },
            { accountId: settlement, direction: "credit", amountMinor: payout.amountMinor },
          ],
        },
        tx,
      );
      await tx
        .update(schema.transactions)
        .set({ status: "settled" })
        .where(eq(schema.transactions.id, posted.id));
    } else {
      // Failed: return the held funds to the wallet.
      const posted = await this.ledger.post(
        {
          orgId: payout.orgId,
          kind: "payout",
          reference: `return of failed payout ${payout.id}`,
          entries: [
            { accountId: clearing, direction: "debit", amountMinor: payout.amountMinor },
            {
              accountId: payout.sourceAccountId,
              direction: "credit",
              amountMinor: payout.amountMinor,
            },
          ],
        },
        tx,
      );
      await tx
        .update(schema.transactions)
        .set({ status: "settled" })
        .where(eq(schema.transactions.id, posted.id));
    }

    await tx
      .update(schema.transactions)
      .set({ status: target })
      .where(eq(schema.transactions.id, payout.transactionId));
    return "applied";
  }

  private async account(tx: DbTx, orgId: string, code: string): Promise<string> {
    await tx
      .insert(schema.accounts)
      .values({ orgId, code, name: code, type: "liability", allowNegative: true })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.orgId, orgId), eq(schema.accounts.code, code)))
      .limit(1);
    if (!row) throw new Error(`System account ${code} missing`);
    return row.id;
  }
}
