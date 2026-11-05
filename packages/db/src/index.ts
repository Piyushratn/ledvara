import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as core from "./schema.js";
import * as orgs from "./schema-orgs.js";
import * as ledger from "./schema-ledger.js";
import * as webhooks from "./schema-webhooks.js";
import * as risk from "./schema-risk.js";

export * from "./schema.js";
export * from "./schema-orgs.js";
export * from "./schema-ledger.js";
export * from "./schema-webhooks.js";
export * from "./schema-risk.js";

export const schema = { ...core, ...orgs, ...ledger, ...webhooks, ...risk };

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
