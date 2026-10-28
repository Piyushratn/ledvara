import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { AccessTokenGuard, type AuthenticatedRequest } from "./access-token.guard.js";
import { loginSchema, refreshSchema, signUpSchema, verifyEmailSchema } from "./auth.schemas.js";
import { AuthService, type LoginResult, type RequestMeta, type TokenPair } from "./auth.service.js";
import { SessionsService } from "./sessions.service.js";

function metaFrom(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers["user-agent"];
  return {
    userAgent: typeof userAgent === "string" ? userAgent : null,
    ip: request.ip ?? null,
  };
}

@Controller("v1/auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  @Post("signup")
  @HttpCode(202)
  async signUp(@Body() body: unknown): Promise<{ message: string }> {
    const input = parseOrThrow(signUpSchema, body);
    await this.auth.signUp(input);
    return { message: "If this email can be registered, check your inbox to continue." };
  }

  @Post("verify-email")
  @HttpCode(200)
  async verifyEmail(@Body() body: unknown): Promise<{ message: string }> {
    const input = parseOrThrow(verifyEmailSchema, body);
    await this.auth.verifyEmail(input.token);
    return { message: "Email verified." };
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: FastifyRequest): Promise<LoginResult> {
    const input = parseOrThrow(loginSchema, body);
    return this.auth.login(input, metaFrom(request));
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Req() request: FastifyRequest): Promise<TokenPair> {
    const input = parseOrThrow(refreshSchema, body);
    return this.auth.refresh(input.refreshToken, metaFrom(request));
  }

  @Post("logout")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async logout(@Req() request: AuthenticatedRequest): Promise<{ message: string }> {
    await this.sessions.revokeFamily(request.auth.sessionId);
    return { message: "Logged out." };
  }

  @Post("logout-all")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async logoutAll(@Req() request: AuthenticatedRequest): Promise<{ message: string }> {
    await this.sessions.revokeAllForUser(request.auth.userId);
    return { message: "Logged out of all devices." };
  }

  @Get("me")
  @UseGuards(AccessTokenGuard)
  async me(@Req() request: AuthenticatedRequest): Promise<{
    id: string;
    email: string;
    fullName: string | null;
    emailVerified: boolean;
  }> {
    const user = await this.sessions.getUser(request.auth.userId);
    if (!user) {
      throw new AppError(401, "unauthorized", "Account no longer exists.");
    }
    return user;
  }
}
