import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import type { CreateAccountInput } from "./accounts.schemas.js";

export interface AccountView {
  id: string;
  code: string | null;
  name: string;
  type: string;
  currency: string;
  allowNegative: boolean;
  balanceMinor: string;
  createdAt: Date;
}

function toView(row: typeof schema.accounts.$inferSelect): AccountView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    currency: row.currency,
    allowNegative: row.allowNegative,
    balanceMinor: row.balanceMinor.toString(),
    createdAt: row.createdAt,
  };
}

@Injectable()
export class AccountsService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async create(orgId: string, input: CreateAccountInput): Promise<AccountView> {
    const [row] = await this.deps.db
      .insert(schema.accounts)
      .values({
        orgId,
        code: input.code ?? null,
        name: input.name,
        type: input.type,
        allowNegative: input.allowNegative,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw new AppError(409, ErrorCodes.Conflict, "An account with that code already exists.");
    }
    return toView(row);
  }

  async list(orgId: string): Promise<AccountView[]> {
    const rows = await this.deps.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.orgId, orgId))
      .orderBy(schema.accounts.createdAt);
    return rows.map(toView);
  }

  async balance(
    orgId: string,
    accountId: string,
    at: string | undefined,
  ): Promise<{ accountId: string; balanceMinor: string; currency: string; asOf: string | null }> {
    const [account] = await this.deps.db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.orgId, orgId)))
      .limit(1);
    if (!account) {
      throw new AppError(404, ErrorCodes.NotFound, "Account not found.");
    }
    if (!at) {
      return {
        accountId,
        balanceMinor: account.balanceMinor.toString(),
        currency: account.currency,
        asOf: null,
      };
    }

    // Time travel: derive the balance from entries up to `at`, with the same sign rules.
    const debitNormal = account.type === "asset" || account.type === "expense";
    const result = await this.deps.pool.query<{ balance: string }>(
      `SELECT COALESCE(SUM(
         CASE WHEN direction = $3 THEN amount_minor ELSE -amount_minor END
       ), 0)::text AS balance
       FROM ledger_entries
       WHERE account_id = $1 AND org_id = $2 AND created_at <= $4::timestamptz`,
      [accountId, orgId, debitNormal ? "debit" : "credit", at],
    );
    return {
      accountId,
      balanceMinor: result.rows[0]?.balance ?? "0",
      currency: account.currency,
      asOf: at,
    };
  }
}
