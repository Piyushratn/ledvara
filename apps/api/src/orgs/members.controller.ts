import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { parseOrThrow } from "../validation/parse.js";
import { updateMemberRoleSchema } from "./members.schemas.js";
import { MembersService, type MemberView } from "./members.service.js";
import { OrgPermissionGuard, type OrgRequest } from "./org-permission.guard.js";
import { RequirePermission } from "./require-permission.js";

@Controller("v1/orgs/:orgId/members")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class MembersController {
  constructor(
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission("members:read")
  async list(@Req() request: OrgRequest): Promise<{ data: MemberView[] }> {
    return { data: await this.members.list(request.membership.orgId) };
  }

  @Patch(":userId")
  @RequirePermission("members:update_role")
  async updateRole(
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body() body: unknown,
    @Req() request: OrgRequest,
  ): Promise<MemberView> {
    const input = parseOrThrow(updateMemberRoleSchema, body);
    const member = await this.members.updateRole(request.membership.orgId, userId, input.role);
    await this.audit.record({
      orgId: request.membership.orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: "member.role_changed",
      targetType: "user",
      targetId: userId,
      metadata: { newRole: input.role },
      ip: request.ip ?? null,
    });
    return member;
  }

  @Delete(":userId")
  @RequirePermission("org:read")
  @HttpCode(204)
  async remove(
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Req() request: OrgRequest,
  ): Promise<void> {
    await this.members.remove(
      request.membership.orgId,
      request.auth.userId,
      request.membership.role,
      userId,
    );
    await this.audit.record({
      orgId: request.membership.orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: userId === request.auth.userId ? "member.left" : "member.removed",
      targetType: "user",
      targetId: userId,
      ip: request.ip ?? null,
    });
  }
}
