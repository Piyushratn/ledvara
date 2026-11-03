import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema-orgs.js";

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  description: text("description"),
  secretEnc: text("secret_enc").notNull(),
  eventTypes: text("event_types").array().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledReason: text("disabled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  endpointId: uuid("endpoint_id")
    .notNull()
    .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
