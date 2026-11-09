import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { AccountsService, type AccountView } from "../ledger/accounts.service.js";
import { createAccountSchema } from "../ledger/accounts.schemas.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import { parseOrThrow } from "../validation/parse.js";

/** The same accounts the API-key endpoints serve, for signed-in dashboard users. */
@Controller("v1/orgs/:orgId/accounts")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class OrgAccountsController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission("ledger:read")
  async list(@Req() request: OrgRequest): Promise<{ data: AccountView[] }> {
    return { data: await this.accounts.list(request.membership.orgId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("ledger:write")
  async create(@Body() body: unknown, @Req() request: OrgRequest): Promise<AccountView> {
    const input = parseOrThrow(createAccountSchema, body);
    const created = await this.accounts.create(request.membership.orgId, input);
    await this.audit.record({
      orgId: request.membership.orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: "account.created",
      targetType: "account",
      targetId: created.id,
      metadata: { type: created.type, code: created.code },
      ip: request.ip ?? null,
    });
    return created;
  }
}
