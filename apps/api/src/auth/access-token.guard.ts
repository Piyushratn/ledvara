import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { loadEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { type AccessClaims, verifyAccessToken } from "./jwt.js";
import { SessionsService } from "./sessions.service.js";

export type AuthenticatedRequest = FastifyRequest & { auth: AccessClaims };

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly secret = loadEnv().JWT_SECRET;

  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new AppError(401, "unauthorized", "Missing access token.");
    }

    let claims: AccessClaims;
    try {
      claims = await verifyAccessToken(this.secret, header.slice("Bearer ".length));
    } catch {
      throw new AppError(401, "unauthorized", "Invalid or expired access token.");
    }

    if (!(await this.sessions.isActive(claims.sessionId))) {
      throw new AppError(401, "unauthorized", "Session has ended. Please log in again.");
    }

    request.auth = claims;
    return true;
  }
}
