import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as core from "./schema.js";
import * as orgs from "./schema-orgs.js";
import * as ledger from "./schema-ledger.js";

export * from "./schema.js";
export * from "./schema-orgs.js";
export * from "./schema-ledger.js";

export const schema = { ...core, ...orgs, ...ledger };

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
