import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { Dependencies } from "../health/dependencies.js";

export const listTransfersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(300).optional(),
  status: z.enum(["created", "pending", "settled", "failed", "reversed"]).optional(),
  accountId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  minAmount: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  maxAmount: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
});

export type ListTransfersInput = z.infer<typeof listTransfersSchema>;

interface Row {
  id: string;
  status: string;
  reference: string | null;
  created_at: string;
  created_at_text: string;
  from_account: string;
  to_account: string;
  amount: string;
  currency: string;
}

@Injectable()
export class TransfersListService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async list(orgId: string, input: ListTransfersInput) {
    const params: unknown[] = [orgId];
    const where: string[] = ["t.org_id = $1", "t.kind = 'transfer'"];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };

    if (input.status) add("t.status = ?", input.status);
    if (input.from) add("t.created_at >= ?::timestamptz", input.from);
    if (input.to) add("t.created_at <= ?::timestamptz", input.to);
    if (input.minAmount) add("d.amount_minor >= ?::bigint", String(input.minAmount));
    if (input.maxAmount) add("d.amount_minor <= ?::bigint", String(input.maxAmount));
    if (input.accountId) {
      params.push(input.accountId);
      where.push(
        `(d.account_id = $${params.length}::uuid OR c.account_id = $${params.length}::uuid)`,
      );
    }
    if (input.cursor) {
      const [ts, id] = Buffer.from(input.cursor, "base64url").toString("utf8").split("|");
      if (!ts || !id) {
        throw new AppError(400, "invalid_cursor", "The cursor is not valid.");
      }
      params.push(ts, id);
      where.push(
        `(t.created_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    params.push(input.limit + 1);

    const result = await this.deps.pool.query<Row>(
      `SELECT t.id, t.status, t.reference, t.created_at::text AS created_at_text,
              t.created_at, d.account_id AS from_account, c.account_id AS to_account,
              d.amount_minor::text AS amount, a.currency
         FROM transactions t
         JOIN ledger_entries d ON d.transaction_id = t.id AND d.direction = 'debit'
         JOIN ledger_entries c ON c.transaction_id = t.id AND c.direction = 'credit'
         JOIN accounts a ON a.id = d.account_id
        WHERE ${where.join(" AND ")}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${params.length}`,
      params,
    );

    const page = result.rows.slice(0, input.limit);
    const last = page[page.length - 1];
    const nextCursor =
      result.rows.length > input.limit && last
        ? Buffer.from(`${last.created_at_text}|${last.id}`).toString("base64url")
        : null;

    return {
      data: page.map((r) => ({
        id: r.id,
        status: r.status,
        fromAccountId: r.from_account,
        toAccountId: r.to_account,
        amountMinor: r.amount,
        currency: r.currency,
        reference: r.reference,
        createdAt: r.created_at,
      })),
      nextCursor,
    };
  }
}
