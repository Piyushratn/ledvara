import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import { OverviewService, type OverviewView } from "./overview.service.js";

@Controller("v1/orgs/:orgId/overview")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class OverviewController {
  constructor(@Inject(OverviewService) private readonly overview: OverviewService) {}

  @Get()
  @RequirePermission("reports:read")
  async get(@Req() request: OrgRequest): Promise<OverviewView> {
    return this.overview.get(request.membership.orgId);
  }
}
