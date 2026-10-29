import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard.js";
import { parseOrThrow } from "../validation/parse.js";
import { acceptInviteSchema, createInviteSchema } from "./invites.schemas.js";
import { InvitesService } from "./invites.service.js";
import { OrgPermissionGuard, type OrgRequest } from "./org-permission.guard.js";
import { RequirePermission } from "./require-permission.js";

@Controller("v1")
export class InvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}

  @Post("orgs/:orgId/invites")
  @UseGuards(AccessTokenGuard, OrgPermissionGuard)
  @RequirePermission("members:invite")
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() request: OrgRequest,
  ): Promise<{ id: string; email: string; role: string; expiresAt: Date }> {
    const input = parseOrThrow(createInviteSchema, body);
    return this.invites.create(
      request.membership.orgId,
      request.auth.userId,
      request.membership.role,
      input,
    );
  }

  @Post("invites/accept")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async accept(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ orgId: string; role: string }> {
    const input = parseOrThrow(acceptInviteSchema, body);
    return this.invites.accept(request.auth.userId, input.token);
  }
}
