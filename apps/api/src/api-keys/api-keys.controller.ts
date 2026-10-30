import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import { parseOrThrow } from "../validation/parse.js";
import { createApiKeySchema } from "./api-keys.schemas.js";
import { ApiKeysService, type ApiKeyView } from "./api-keys.service.js";

@Controller("v1/orgs/:orgId/api-keys")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class ApiKeysController {
  constructor(
    @Inject(ApiKeysService) private readonly keys: ApiKeysService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermission("api_keys:manage")
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() request: OrgRequest,
  ): Promise<ApiKeyView & { key: string }> {
    const input = parseOrThrow(createApiKeySchema, body);
    const created = await this.keys.create(request.membership.orgId, request.auth.userId, input);
    await this.audit.record({
      orgId: request.membership.orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: "api_key.created",
      targetType: "api_key",
      targetId: created.id,
      metadata: { prefix: created.prefix, scopes: created.scopes, name: created.name },
      ip: request.ip ?? null,
    });
    return created;
  }

  @Get()
  @RequirePermission("api_keys:read")
  async list(@Req() request: OrgRequest): Promise<{ data: ApiKeyView[] }> {
    return { data: await this.keys.list(request.membership.orgId) };
  }

  @Delete(":keyId")
  @RequirePermission("api_keys:manage")
  @HttpCode(204)
  async revoke(
    @Param("keyId", new ParseUUIDPipe()) keyId: string,
    @Req() request: OrgRequest,
  ): Promise<void> {
    await this.keys.revoke(request.membership.orgId, keyId);
    await this.audit.record({
      orgId: request.membership.orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: "api_key.revoked",
      targetType: "api_key",
      targetId: keyId,
      ip: request.ip ?? null,
    });
  }

  @Post(":keyId/rotate")
  @RequirePermission("api_keys:manage")
  @HttpCode(201)
  async rotate(
    @Param("keyId", new ParseUUIDPipe()) keyId: string,
    @Req() request: OrgRequest,
  ): Promise<ApiKeyView & { key: string }> {
    const rotated = await this.keys.rotate(request.membership.orgId, keyId, request.auth.userId);
    await this.audit.record({
      orgId: request.membership.orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: "api_key.rotated",
      targetType: "api_key",
      targetId: rotated.id,
      metadata: { replacedKeyId: keyId, prefix: rotated.prefix },
      ip: request.ip ?? null,
    });
    return rotated;
  }
}
