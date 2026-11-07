import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import {
  ProviderReconciliationService,
  type ProviderRunView,
} from "./provider-reconciliation.service.js";

@Controller("v1/orgs/:orgId/provider-reconciliation")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class ProviderReconciliationController {
  constructor(
    @Inject(ProviderReconciliationService)
    private readonly service: ProviderReconciliationService,
  ) {}

  @Get()
  @RequirePermission("reports:read")
  async list(@Req() request: OrgRequest): Promise<{ data: ProviderRunView[] }> {
    return { data: await this.service.listForOrg(request.membership.orgId) };
  }
}
