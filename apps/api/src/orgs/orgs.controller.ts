import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard.js";
import { parseOrThrow } from "../validation/parse.js";
import { createOrgSchema } from "./orgs.schemas.js";
import { OrgsService, type OrgSummary } from "./orgs.service.js";

@Controller("v1/orgs")
@UseGuards(AccessTokenGuard)
export class OrgsController {
  constructor(@Inject(OrgsService) private readonly orgs: OrgsService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<OrgSummary> {
    const input = parseOrThrow(createOrgSchema, body);
    return this.orgs.create(request.auth.userId, input);
  }

  @Get()
  async list(@Req() request: AuthenticatedRequest): Promise<{ data: OrgSummary[] }> {
    return { data: await this.orgs.listForUser(request.auth.userId) };
  }
}
