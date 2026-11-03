import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, count, desc, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { UnsafeUrlError, validateWebhookUrl } from "./safe-url.js";
import type { CreateEndpointInput } from "./webhooks.schemas.js";
import { encryptSecret, parseKey } from "./webhook-crypto.js";

const MAX_ENDPOINTS_PER_ORG = 20;
const DELIVERY_LIST_LIMIT = 50;

export interface EndpointView {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  enabled: boolean;
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

@Injectable()
export class WebhooksService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async create(
    orgId: string,
    input: CreateEndpointInput,
  ): Promise<EndpointView & { secret: string }> {
    let url: URL;
    try {
      url = validateWebhookUrl(input.url);
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        throw new AppError(422, ErrorCodes.ValidationFailed, error.message, [
          { path: "url", message: error.message },
        ]);
      }
      throw error;
    }

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
        url: url.toString(),
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

  async listDeliveries(orgId: string): Promise<DeliveryView[]> {
    const rows = await this.deps.db
      .select()
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.orgId, orgId))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(DELIVERY_LIST_LIMIT);
    return rows.map(toDeliveryView);
  }

  private key(): Buffer {
    return parseKey(process.env.WEBHOOK_SECRET_KEY);
  }
}
