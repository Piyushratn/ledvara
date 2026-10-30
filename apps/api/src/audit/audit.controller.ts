import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import { parseOrThrow } from "../validation/parse.js";
import { AuditService, type AuditEventView } from "./audit.service.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

@Controller("v1/orgs/:orgId/audit-events")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @RequirePermission("audit:read")
  async list(
    @Query() query: unknown,
    @Req() request: OrgRequest,
  ): Promise<{ data: AuditEventView[]; nextCursor: string | null }> {
    const input = parseOrThrow(querySchema, query);
    return this.audit.list(request.membership.orgId, input.limit, input.cursor ?? null);
  }
}
