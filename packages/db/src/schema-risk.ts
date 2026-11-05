import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { transactions } from "./schema-ledger.js";
import { organizations } from "./schema-orgs.js";
import { users } from "./schema.js";

export const riskAssessments = pgTable(
  "risk_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id, { onDelete: "restrict" }),
    rulesVersion: text("rules_version").notNull(),
    score: integer("score").notNull(),
    level: text("level").notNull(),
    flagged: boolean("flagged").notNull(),
    reasons: jsonb("reasons").notNull().default([]),
    inputs: jsonb("inputs").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("risk_assessments_org_created_idx").on(table.orgId, table.createdAt)],
);

export const reviewItems = pgTable(
  "review_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => riskAssessments.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    reviewerNote: text("reviewer_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("review_items_org_status_idx").on(table.orgId, table.status, table.createdAt)],
);
