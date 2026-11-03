import { Controller, Get, Inject, Param, SetMetadata, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard } from "../orgs/org-permission.guard.js";
import { PERMISSION_KEY } from "../orgs/require-permission.js";
import { ReconciliationService, type ReconciliationRunView } from "./reconciliation.service.js";

@Controller("v1/orgs/:orgId")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class ReconciliationController {
  constructor(@Inject(ReconciliationService) private readonly service: ReconciliationService) {}

  @Get("reconciliation")
  @SetMetadata(PERMISSION_KEY, "reports:read")
  async list(@Param("orgId") orgId: string): Promise<{ data: ReconciliationRunView[] }> {
    return { data: await this.service.listForOrg(orgId) };
  }
}
