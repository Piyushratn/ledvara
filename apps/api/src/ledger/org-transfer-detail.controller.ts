import { Controller, Get, Inject, Param, ParseUUIDPipe, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import { TransferDetailService, type TransferDetail } from "./transfer-detail.service.js";

@Controller("v1/orgs/:orgId")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class OrgTransferDetailController {
  constructor(@Inject(TransferDetailService) private readonly detail: TransferDetailService) {}

  @Get("transfers/:id/detail")
  @RequirePermission("ledger:read")
  async get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: OrgRequest,
  ): Promise<TransferDetail> {
    return this.detail.get(request.membership.orgId, id, request.membership.role);
  }
}
