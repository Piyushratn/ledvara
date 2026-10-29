import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AccessTokenGuard, type AuthenticatedRequest } from "../auth/access-token.guard.js";
import { parseOrThrow } from "../validation/parse.js";
import { acceptInviteSchema, createInviteSchema } from "./invites.schemas.js";
import { InvitesService } from "./invites.service.js";

@Controller("v1")
@UseGuards(AccessTokenGuard)
export class InvitesController {
  constructor(@Inject(InvitesService) private readonly invites: InvitesService) {}

  @Post("orgs/:orgId/invites")
  @HttpCode(201)
  async create(
    @Param("orgId", new ParseUUIDPipe()) orgId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; email: string; role: string; expiresAt: Date }> {
    const input = parseOrThrow(createInviteSchema, body);
    return this.invites.create(orgId, request.auth.userId, input);
  }

  @Post("invites/accept")
  @HttpCode(200)
  async accept(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ orgId: string; role: string }> {
    const input = parseOrThrow(acceptInviteSchema, body);
    return this.invites.accept(request.auth.userId, input.token);
  }
}
