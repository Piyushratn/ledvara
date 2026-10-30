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
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import { parseOrThrow } from "../validation/parse.js";
import { createApiKeySchema } from "./api-keys.schemas.js";
import { ApiKeysService, type ApiKeyView } from "./api-keys.service.js";

@Controller("v1/orgs/:orgId/api-keys")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly keys: ApiKeysService) {}

  @Post()
  @RequirePermission("api_keys:manage")
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() request: OrgRequest,
  ): Promise<ApiKeyView & { key: string }> {
    const input = parseOrThrow(createApiKeySchema, body);
    return this.keys.create(request.membership.orgId, request.auth.userId, input);
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
  }
}
