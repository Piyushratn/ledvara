import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { UnsafeUrlError, validateWebhookUrl } from "./safe-url.js";
import type {
  CreateEndpointInput,
  ListDeliveriesInput,
  UpdateEndpointInput,
} from "./webhooks.schemas.js";
import { encryptSecret, parseKey } from "./webhook-crypto.js";

const MAX_ENDPOINTS_PER_ORG = 20;

export interface EndpointView {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  enabled: boolean;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: string | null;
  createdAt: string;
}

export interface DeliveryView {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

type EndpointRow = typeof schema.webhookEndpoints.$inferSelect;
type DeliveryRow = typeof schema.webhookDeliveries.$inferSelect;

function toView(row: EndpointRow): EndpointView {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    eventTypes: row.eventTypes,
    enabled: row.enabled,
    consecutiveFailures: row.consecutiveFailures,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    disabledReason: row.disabledReason,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDeliveryView(row: DeliveryRow): DeliveryView {
  return {
    id: row.id,
    endpointId: row.endpointId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempts: row.attempts,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function newSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

function checkUrl(raw: string): string {
  try {
    return validateWebhookUrl(raw).toString();
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      throw new AppError(422, ErrorCodes.ValidationFailed, error.message, [
        { path: "url", message: error.message },
      ]);
    }
    throw error;
  }
}

@Injectable()
export class WebhooksService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async create(
    orgId: string,
    input: CreateEndpointInput,
  ): Promise<EndpointView & { secret: string }> {
    const url = checkUrl(input.url);

    const [existing] = await this.deps.db
      .select({ n: count() })
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.orgId, orgId));
    if ((existing?.n ?? 0) >= MAX_ENDPOINTS_PER_ORG) {
      throw new AppError(409, "webhook_limit_reached", "This organization has too many endpoints.");
    }

    const id = randomUUID();
    const secret = newSecret();
    const [row] = await this.deps.db
      .insert(schema.webhookEndpoints)
      .values({
        id,
        orgId,
        url,
        description: input.description ?? null,
        secretEnc: encryptSecret(secret, this.key(), id),
        eventTypes: input.eventTypes,
      })
      .returning();
    if (!row) {
      throw new AppError(500, ErrorCodes.InternalError, "Could not create the endpoint.");
    }
    return { ...toView(row), secret };
  }

  async list(orgId: string): Promise<EndpointView[]> {
    const rows = await this.deps.db
      .select()
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.orgId, orgId))
      .orderBy(desc(schema.webhookEndpoints.createdAt));
    return rows.map(toView);
  }

  async update(orgId: string, id: string, input: UpdateEndpointInput): Promise<EndpointView> {
    const changes: Partial<typeof schema.webhookEndpoints.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.url !== undefined) changes.url = checkUrl(input.url);
    if (input.description !== undefined) changes.description = input.description;
    if (input.eventTypes !== undefined) changes.eventTypes = input.eventTypes;
    if (input.enabled === true) {
      // Re-enabling starts the failure streak from zero.
      changes.enabled = true;
      changes.consecutiveFailures = 0;
      changes.disabledAt = null;
      changes.disabledReason = null;
    } else if (input.enabled === false) {
      changes.enabled = false;
      changes.disabledAt = new Date();
      changes.disabledReason = "Disabled manually.";
    }

    const [row] = await this.deps.db
      .update(schema.webhookEndpoints)
      .set(changes)
      .where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.orgId, orgId)))
      .returning();
    if (!row) {
      throw new AppError(404, ErrorCodes.NotFound, "Webhook endpoint not found.");
    }
    return toView(row);
  }

  async remove(orgId: string, id: string): Promise<void> {
    const rows = await this.deps.db
      .delete(schema.webhookEndpoints)
      .where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.orgId, orgId)))
      .returning({ id: schema.webhookEndpoints.id });
    if (rows.length === 0) {
      throw new AppError(404, ErrorCodes.NotFound, "Webhook endpoint not found.");
    }
  }

  async rotateSecret(orgId: string, id: string): Promise<{ id: string; secret: string }> {
    const secret = newSecret();
    const rows = await this.deps.db
      .update(schema.webhookEndpoints)
      .set({ secretEnc: encryptSecret(secret, this.key(), id), updatedAt: new Date() })
      .where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.orgId, orgId)))
      .returning({ id: schema.webhookEndpoints.id });
    if (rows.length === 0) {
      throw new AppError(404, ErrorCodes.NotFound, "Webhook endpoint not found.");
    }
    return { id, secret };
  }

  async listDeliveries(orgId: string, input: ListDeliveriesInput): Promise<DeliveryView[]> {
    const conditions: SQL[] = [eq(schema.webhookDeliveries.orgId, orgId)];
    if (input.status) conditions.push(eq(schema.webhookDeliveries.status, input.status));
    if (input.endpointId) {
      conditions.push(eq(schema.webhookDeliveries.endpointId, input.endpointId));
    }
    const rows = await this.deps.db
      .select()
      .from(schema.webhookDeliveries)
      .where(and(...conditions))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(input.limit);
    return rows.map(toDeliveryView);
  }

  private key(): Buffer {
    return parseKey(process.env.WEBHOOK_SECRET_KEY);
  }
}
