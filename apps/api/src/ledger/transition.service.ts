import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { canTransition, type TxnStatus } from "./transitions.js";

@Injectable()
export class TransitionService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async transition(orgId: string, transactionId: string, to: TxnStatus): Promise<TxnStatus> {
    const [current] = await this.deps.db
      .select({ status: schema.transactions.status })
      .from(schema.transactions)
      .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.orgId, orgId)))
      .limit(1);
    if (!current) {
      throw new AppError(404, ErrorCodes.NotFound, "Transaction not found.");
    }
    const from = current.status as TxnStatus;
    if (!canTransition(from, to)) {
      throw new AppError(409, "invalid_transition", `Cannot move a ${from} transfer to ${to}.`);
    }

    const [updated] = await this.deps.db
      .update(schema.transactions)
      .set({ status: to })
      .where(
        and(
          eq(schema.transactions.id, transactionId),
          eq(schema.transactions.orgId, orgId),
          eq(schema.transactions.status, from),
        ),
      )
      .returning({ status: schema.transactions.status });
    if (!updated) {
      throw new AppError(409, "invalid_transition", "The transfer changed state. Try again.");
    }
    return updated.status as TxnStatus;
  }
}
