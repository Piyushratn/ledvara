import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as core from "./schema.js";
import * as orgs from "./schema-orgs.js";

export * from "./schema.js";
export * from "./schema-orgs.js";

export const schema = { ...core, ...orgs };

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
