import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard.js";
import { parseOrThrow } from "../validation/parse.js";
import { acceptInviteSchema, createInviteSchema } from "./invites.schemas.js";
import { InvitesService } from "./invites.service.js";
import { OrgPermissionGuard, type OrgRequest } from "./org-permission.guard.js";
import { RequirePermission } from "./require-permission.js";

@Controller("v1")
export class InvitesController {
  constructor(
    @Inject(InvitesService) private readonly invites: InvitesService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post("orgs/:orgId/invites")
  @UseGuards(AccessTokenGuard, OrgPermissionGuard)
  @RequirePermission("members:invite")
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() request: OrgRequest,
  ): Promise<{ id: string; email: string; role: string; expiresAt: Date }> {
    const input = parseOrThrow(createInviteSchema, body);
    const invite = await this.invites.create(
      request.membership.orgId,
      request.auth.userId,
      request.membership.role,
      input,
    );
    await this.audit.record({
      orgId: request.membership.orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: "invite.created",
      targetType: "invite",
      targetId: invite.id,
      metadata: { email: invite.email, role: invite.role },
      ip: request.ip ?? null,
    });
    return invite;
  }

  @Post("invites/accept")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async accept(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ orgId: string; role: string }> {
    const input = parseOrThrow(acceptInviteSchema, body);
    const result = await this.invites.accept(request.auth.userId, input.token);
    await this.audit.record({
      orgId: result.orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: "invite.accepted",
      targetType: "user",
      targetId: request.auth.userId,
      metadata: { role: result.role },
      ip: request.ip ?? null,
    });
    return result;
  }
}
