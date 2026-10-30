import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard.js";
import { AuditService } from "../audit/audit.service.js";
import { parseOrThrow } from "../validation/parse.js";
import { createOrgSchema } from "./orgs.schemas.js";
import { OrgsService, type OrgSummary } from "./orgs.service.js";

@Controller("v1/orgs")
@UseGuards(AccessTokenGuard)
export class OrgsController {
  constructor(
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OrgSummary> {
    const input = parseOrThrow(createOrgSchema, body);
    const org = await this.orgs.create(request.auth.userId, input);
    await this.audit.record({
      orgId: org.id,
      actorType: "user",
      actorId: request.auth.userId,
      action: "org.created",
      targetType: "organization",
      targetId: org.id,
      metadata: { name: org.name, slug: org.slug },
      ip: request.ip ?? null,
    });
    return org;
  }

  @Get()
  async list(@Req() request: AuthenticatedRequest): Promise<{ data: OrgSummary[] }> {
    return { data: await this.orgs.listForUser(request.auth.userId) };
  }
}
