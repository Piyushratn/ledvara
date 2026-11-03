import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { PERMISSION_KEY } from "../orgs/require-permission.js";
import { parseOrThrow } from "../validation/parse.js";
import { createEndpointSchema, endpointIdSchema } from "./webhooks.schemas.js";
import { WebhooksService, type DeliveryView, type EndpointView } from "./webhooks.service.js";

@Controller("v1/orgs/:orgId")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class WebhooksController {
  constructor(
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post("webhook-endpoints")
  @HttpCode(201)
  @SetMetadata(PERMISSION_KEY, "api_keys:manage")
  async create(
    @Param("orgId") orgId: string,
    @Body() body: unknown,
    @Req() request: OrgRequest,
  ): Promise<EndpointView & { secret: string; note: string }> {
    const input = parseOrThrow(createEndpointSchema, body);
    const created = await this.webhooks.create(orgId, input);
    await this.record(request, orgId, "webhook_endpoint.created", created.id, { url: created.url });
    return { ...created, note: "Save the signing secret now. It is shown only once." };
  }

  @Get("webhook-endpoints")
  @SetMetadata(PERMISSION_KEY, "api_keys:read")
  async list(@Param("orgId") orgId: string): Promise<{ data: EndpointView[] }> {
    return { data: await this.webhooks.list(orgId) };
  }

  @Delete("webhook-endpoints/:id")
  @HttpCode(200)
  @SetMetadata(PERMISSION_KEY, "api_keys:manage")
  async remove(
    @Param("orgId") orgId: string,
    @Param("id") id: string,
    @Req() request: OrgRequest,
  ): Promise<{ message: string }> {
    const endpointId = parseOrThrow(endpointIdSchema, id);
    await this.webhooks.remove(orgId, endpointId);
    await this.record(request, orgId, "webhook_endpoint.deleted", endpointId, {});
    return { message: "Webhook endpoint deleted." };
  }

  @Post("webhook-endpoints/:id/rotate-secret")
  @HttpCode(200)
  @SetMetadata(PERMISSION_KEY, "api_keys:manage")
  async rotate(
    @Param("orgId") orgId: string,
    @Param("id") id: string,
    @Req() request: OrgRequest,
  ): Promise<{ id: string; secret: string; note: string }> {
    const endpointId = parseOrThrow(endpointIdSchema, id);
    const rotated = await this.webhooks.rotateSecret(orgId, endpointId);
    await this.record(request, orgId, "webhook_endpoint.secret_rotated", endpointId, {});
    return { ...rotated, note: "The old secret no longer works. Save the new one now." };
  }

  @Get("webhook-deliveries")
  @SetMetadata(PERMISSION_KEY, "api_keys:read")
  async deliveries(@Param("orgId") orgId: string): Promise<{ data: DeliveryView[] }> {
    return { data: await this.webhooks.listDeliveries(orgId) };
  }

  private async record(
    request: OrgRequest,
    orgId: string,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action,
      targetType: "webhook_endpoint",
      targetId,
      metadata,
      ip: request.ip ?? null,
    });
  }
}
