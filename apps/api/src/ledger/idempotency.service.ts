import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { Dependencies } from "../health/dependencies.js";
import type { DbTx } from "./ledger.service.js";

export interface StoredResponse {
  status: number;
  body: unknown;
}

/** Stable JSON: object keys sorted, so {a,b} and {b,a} hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashRequest(method: string, path: string, body: unknown): string {
  return createHash("sha256")
    .update(`${method}\n${path}\n${canonicalJson(body)}`)
    .digest("hex");
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  /**
   * Runs `work` at most once per (org, key). The key is claimed inside the same database
   * transaction as the work, so a concurrent duplicate blocks on the unique index until this
   * transaction commits, then replays the stored response. A crash rolls everything back.
   */
  async run(
    orgId: string,
    key: string,
    requestHash: string,
    work: (tx: DbTx) => Promise<StoredResponse>,
  ): Promise<StoredResponse & { replayed: boolean }> {
    return this.deps.db.transaction(async (tx) => {
      const [claimed] = await tx
        .insert(schema.idempotencyKeys)
        .values({ orgId, key, requestHash, responseStatus: 0, responseBody: {} })
        .onConflictDoNothing({ target: [schema.idempotencyKeys.orgId, schema.idempotencyKeys.key] })
        .returning({ id: schema.idempotencyKeys.id });

      if (!claimed) {
        const [existing] = await tx
          .select()
          .from(schema.idempotencyKeys)
          .where(and(eq(schema.idempotencyKeys.orgId, orgId), eq(schema.idempotencyKeys.key, key)))
          .limit(1);
        if (!existing) {
          throw new AppError(409, "idempotency_conflict", "Please retry the request.");
        }
        if (existing.requestHash !== requestHash) {
          throw new AppError(
            422,
            "idempotency_key_reuse",
            "This Idempotency-Key was already used with a different request.",
          );
        }
        return {
          status: existing.responseStatus,
          body: existing.responseBody,
          replayed: true,
        };
      }

      const response = await work(tx);
      await tx
        .update(schema.idempotencyKeys)
        .set({ responseStatus: response.status, responseBody: response.body })
        .where(eq(schema.idempotencyKeys.id, claimed.id));
      return { ...response, replayed: false };
    });
  }
}
