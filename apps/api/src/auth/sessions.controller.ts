import { Controller, Delete, Get, HttpCode, Inject, Param, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { AccessTokenGuard, type AuthenticatedRequest } from "./access-token.guard.js";
import { SessionsService, type ActiveSession } from "./sessions.service.js";

const sessionIdSchema = z.string().uuid();

@Controller("v1/auth/sessions")
@UseGuards(AccessTokenGuard)
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest): Promise<{ sessions: ActiveSession[] }> {
    const sessions = await this.sessions.listActive(request.auth.userId, request.auth.sessionId);
    return { sessions };
  }

  @Delete(":id")
  @HttpCode(200)
  async revokeOne(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    const familyId = parseOrThrow(sessionIdSchema, id);
    const revoked = await this.sessions.revokeOne(request.auth.userId, familyId);
    if (!revoked) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }
    return { message: "Session revoked." };
  }

  @Delete()
  @HttpCode(200)
  async revokeOthers(@Req() request: AuthenticatedRequest): Promise<{ message: string }> {
    await this.sessions.revokeOthers(request.auth.userId, request.auth.sessionId);
    return { message: "Logged out of all other devices." };
  }
}
