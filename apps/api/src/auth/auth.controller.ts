import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuditService, type AuditEventView } from "../audit/audit.service.js";
import { loadEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { AccessTokenGuard, type AuthenticatedRequest } from "./access-token.guard.js";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshBodySchema,
  resetPasswordSchema,
  signUpSchema,
  twoFactorDisableSchema,
  twoFactorEnableSchema,
  twoFactorLoginSchema,
  verifyEmailSchema,
} from "./auth.schemas.js";
import {
  AuthService,
  type LoginResult,
  type RequestMeta,
  type TokenPair,
  type TwoFactorRequiredResult,
} from "./auth.service.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { PasswordResetService } from "./password-reset.service.js";
import {
  clearRefreshCookie,
  readCookie,
  REFRESH_COOKIE_NAME,
  REQUESTED_WITH,
  serializeRefreshCookie,
} from "./refresh-cookie.js";
import { SessionsService } from "./sessions.service.js";
import { TwoFactorService } from "./two-factor.service.js";

function metaFrom(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers["user-agent"];
  return {
    userAgent: typeof userAgent === "string" ? userAgent : null,
    ip: request.ip ?? null,
  };
}

const FAILED_LOGIN_CODES = new Set(["invalid_credentials", "invalid_two_factor_code"]);

const securityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller("v1/auth")
export class AuthController {
  private readonly secureCookies = loadEnv().NODE_ENV === "production";
  private readonly cookieMaxAgeSeconds = loadEnv().REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(PasswordResetService) private readonly passwordReset: PasswordResetService,
    @Inject(LoginThrottleService) private readonly throttle: LoginThrottleService,
    @Inject(TwoFactorService) private readonly twoFactor: TwoFactorService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private setRefreshCookie(reply: FastifyReply, token: string): void {
    void reply.header(
      "set-cookie",
      serializeRefreshCookie(token, this.cookieMaxAgeSeconds, this.secureCookies),
    );
  }

  private clearCookie(reply: FastifyReply): void {
    void reply.header("set-cookie", clearRefreshCookie(this.secureCookies));
  }

  private recordUserEvent(
    userId: string,
    action: string,
    request: FastifyRequest,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      orgId: null,
      actorType: "user",
      actorId: userId,
      action,
      targetType: "user",
      targetId: userId,
      metadata,
      ip: request.ip ?? null,
    });
  }

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
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult | TwoFactorRequiredResult> {
    const input = parseOrThrow(loginSchema, body);
    await this.throttle.assertAllowed(request.ip ?? null, input.email);
    try {
      const result = await this.auth.login(input, metaFrom(request));
      // A password-only success must not reset the counter while a 2FA step is still pending,
      // otherwise code guessing would restart after every correct password.
      if (!("twoFactorRequired" in result)) {
        await this.throttle.recordSuccess(input.email);
        await this.recordUserEvent(result.user.id, "login.succeeded", request);
        this.setRefreshCookie(reply, result.refreshToken);
      }
      return result;
    } catch (error) {
      if (error instanceof AppError) {
        await this.throttle.recordFailure(input.email);
        if (FAILED_LOGIN_CODES.has(error.code)) {
          // Only for real accounts, and only the user id is stored: no typed email, no password.
          const userId = await this.audit.userIdForEmail(input.email);
          if (userId) await this.recordUserEvent(userId, "login.failed", request);
        }
      }
      throw error;
    }
  }

  @Post("login/2fa")
  @HttpCode(200)
  async loginTwoFactor(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResult> {
    const input = parseOrThrow(twoFactorLoginSchema, body);
    const challenge = this.twoFactor.readChallenge(input.challengeToken);
    await this.throttle.assertAllowed(request.ip ?? null, challenge.email);
    try {
      const result = await this.auth.completeTwoFactorLogin(
        challenge,
        input.code,
        metaFrom(request),
      );
      await this.throttle.recordSuccess(challenge.email);
      await this.recordUserEvent(result.user.id, "login.succeeded", request, {
        secondFactor: true,
      });
      this.setRefreshCookie(reply, result.refreshToken);
      return result;
    } catch (error) {
      if (error instanceof AppError) {
        await this.throttle.recordFailure(challenge.email);
        if (FAILED_LOGIN_CODES.has(error.code)) {
          await this.recordUserEvent(challenge.userId, "login.failed", request, {
            secondFactor: true,
          });
        }
      }
      throw error;
    }
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenPair> {
    const input = parseOrThrow(refreshBodySchema, body ?? {});
    const fromCookie = input.refreshToken === undefined;

    let token = input.refreshToken ?? null;
    if (token === null) {
      // Cookie-based refresh: require a header a cross-site page cannot send.
      if (request.headers["x-requested-with"] !== REQUESTED_WITH) {
        throw new AppError(403, "csrf_check_failed", "A required request header is missing.");
      }
      token = readCookie(request.headers.cookie, REFRESH_COOKIE_NAME);
      if (token === null) {
        throw new AppError(
          401,
          "invalid_refresh_token",
          "Your session is no longer valid. Please log in again.",
        );
      }
    }

    try {
      const pair = await this.auth.refresh(token, metaFrom(request));
      this.setRefreshCookie(reply, pair.refreshToken);
      return pair;
    } catch (error) {
      // A cookie that no longer works is dropped so the browser stops sending it.
      if (fromCookie && error instanceof AppError) this.clearCookie(reply);
      throw error;
    }
  }

  @Post("forgot-password")
  @HttpCode(202)
  async forgotPassword(@Body() body: unknown): Promise<{ message: string }> {
    const input = parseOrThrow(forgotPasswordSchema, body);
    await this.passwordReset.requestReset(input.email);
    return { message: "If an account exists for this email, a reset link is on its way." };
  }

  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ message: string }> {
    const input = parseOrThrow(resetPasswordSchema, body);
    const userId = await this.passwordReset.resetPassword(input.token, input.newPassword);
    if (userId) await this.recordUserEvent(userId, "password.reset", request);
    return { message: "Password updated. Please log in with your new password." };
  }

  @Post("2fa/setup")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async twoFactorSetup(
    @Req() request: AuthenticatedRequest,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    return this.twoFactor.setup(request.auth.userId);
  }

  @Post("2fa/enable")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async twoFactorEnable(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ message: string; backupCodes: string[] }> {
    const input = parseOrThrow(twoFactorEnableSchema, body);
    const backupCodes = await this.twoFactor.enable(request.auth.userId, input.code);
    await this.recordUserEvent(request.auth.userId, "two_factor.enabled", request);
    return {
      message: "Two-factor authentication is on. Save these backup codes now; they are shown once.",
      backupCodes,
    };
  }

  @Post("2fa/disable")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async twoFactorDisable(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    const input = parseOrThrow(twoFactorDisableSchema, body);
    const user = await this.sessions.getUser(request.auth.userId);
    if (!user) {
      throw new AppError(401, "unauthorized", "Account no longer exists.");
    }
    // Guess attempts here count against the same per-account lockout as login.
    await this.throttle.assertAllowed(null, user.email);
    try {
      await this.twoFactor.disable(user.id, input.password, input.code);
      await this.throttle.recordSuccess(user.email);
    } catch (error) {
      if (error instanceof AppError) {
        await this.throttle.recordFailure(user.email);
      }
      throw error;
    }
    await this.recordUserEvent(user.id, "two_factor.disabled", request);
    return { message: "Two-factor authentication is off." };
  }

  @Post("logout")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ message: string }> {
    await this.sessions.revokeFamily(request.auth.sessionId);
    await this.recordUserEvent(request.auth.userId, "logout", request);
    this.clearCookie(reply);
    return { message: "Logged out." };
  }

  @Post("logout-all")
  @UseGuards(AccessTokenGuard)
  @HttpCode(200)
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ message: string }> {
    await this.sessions.revokeAllForUser(request.auth.userId);
    await this.recordUserEvent(request.auth.userId, "logout.all", request);
    this.clearCookie(reply);
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

  @Get("security-events")
  @UseGuards(AccessTokenGuard)
  async securityEvents(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ data: AuditEventView[] }> {
    const input = parseOrThrow(securityQuerySchema, query);
    return { data: await this.audit.listForUser(request.auth.userId, input.limit) };
  }
}
