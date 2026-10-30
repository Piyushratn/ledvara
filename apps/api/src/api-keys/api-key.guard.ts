import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { schema } from "@ledvara/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { hashApiKey } from "./api-key-token.js";
import { checkKeyLimit } from "./api-key-limiter.js";
import { SCOPE_KEY } from "./scope.decorator.js";
import type { ApiKeyScope } from "./scopes.js";

export type ApiKeyRequest = FastifyRequest & {
  apiKey: { id: string; orgId: string; scopes: string[] };
};

const LAST_USED_THROTTLE_MS = 60_000;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Dependencies) private readonly deps: Dependencies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<ApiKeyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const presented = this.extractKey(request);
    if (!presented || !presented.startsWith("lv_test_")) {
      throw new AppError(401, ErrorCodes.Unauthorized, "Invalid API key.");
    }

    const [key] = await this.deps.db
      .select()
      .from(schema.apiKeys)
      .where(
        and(eq(schema.apiKeys.keyHash, hashApiKey(presented)), isNull(schema.apiKeys.revokedAt)),
      )
      .limit(1);
    if (!key) {
      throw new AppError(401, ErrorCodes.Unauthorized, "Invalid API key.");
    }

    await this.applyRateLimit(key.id, reply);

    const required = this.reflector.get<ApiKeyScope | undefined>(SCOPE_KEY, context.getHandler());
    if (required && !key.scopes.includes(required)) {
      throw new AppError(403, ErrorCodes.Forbidden, `This API key lacks the ${required} scope.`);
    }

    this.touchLastUsed(key.id);
    request.apiKey = { id: key.id, orgId: key.orgId, scopes: key.scopes };
    return true;
  }

  private extractKey(request: FastifyRequest): string | null {
    const header = request.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length).trim();
    }
    const alt = request.headers["x-api-key"];
    return typeof alt === "string" ? alt.trim() : null;
  }

  private async applyRateLimit(keyId: string, reply: FastifyReply): Promise<void> {
    try {
      const redis = this.deps.redis;
      if (redis.status === "wait" || redis.status === "end") {
        await redis.connect();
      }
      const result = await checkKeyLimit(redis, keyId);
      void reply.header("X-RateLimit-Limit", String(result.limit));
      void reply.header("X-RateLimit-Remaining", String(result.remaining));
      void reply.header("X-RateLimit-Reset", String(result.resetSeconds));
      if (!result.allowed) {
        void reply.header("Retry-After", String(result.resetSeconds));
        throw new AppError(429, ErrorCodes.RateLimited, "Rate limit exceeded for this API key.");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error }, "API key rate limiter unavailable, allowing request");
    }
  }

  // Fire and forget, throttled in SQL: at most one write per key per minute.
  private touchLastUsed(keyId: string): void {
    const cutoff = new Date(Date.now() - LAST_USED_THROTTLE_MS);
    this.deps.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.id, keyId),
          or(isNull(schema.apiKeys.lastUsedAt), lt(schema.apiKeys.lastUsedAt, cutoff)),
        ),
      )
      .then(
        () => undefined,
        (error: unknown) => this.logger.error({ err: error }, "Failed to update last_used_at"),
      );
  }
}
