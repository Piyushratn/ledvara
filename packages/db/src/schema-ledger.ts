import { bigint, boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema-orgs.js";

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  environment: text("environment").notNull().default("sandbox"),
  code: text("code"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  currency: text("currency").notNull().default("INR"),
  allowNegative: boolean("allow_negative").notNull().default(false),
  // mode "bigint": amounts are never converted to JS number (ADR 0001).
  balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull().default(0n),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
