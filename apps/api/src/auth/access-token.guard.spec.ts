import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../errors/app-error.js";
import { AccessTokenGuard, type AuthenticatedRequest } from "./access-token.guard.js";
import { signAccessToken } from "./jwt.js";
import type { SessionsService } from "./sessions.service.js";

const secret = "a-test-secret-that-is-at-least-32-characters-long";
vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/db");
vi.stubEnv("REDIS_URL", "redis://localhost:6379");
vi.stubEnv("JWT_SECRET", secret);

function contextFor(request: object): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function guardWith(active: boolean): AccessTokenGuard {
  const sessions = { isActive: () => Promise.resolve(active) } as unknown as SessionsService;
  return new AccessTokenGuard(sessions);
}

const claims = {
  userId: "11111111-1111-1111-1111-111111111111",
  sessionId: "22222222-2222-2222-2222-222222222222",
};

describe("AccessTokenGuard", () => {
  it("rejects a request with no Authorization header", async () => {
    await expect(guardWith(true).canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it("rejects a garbage token", async () => {
    const request = { headers: { authorization: "Bearer not-a-jwt" } };
    await expect(guardWith(true).canActivate(contextFor(request))).rejects.toBeInstanceOf(AppError);
  });

  it("accepts a valid token for an active session and attaches the claims", async () => {
    const token = await signAccessToken(secret, claims, 60);
    const request = { headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest;
    await expect(guardWith(true).canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.auth).toEqual(claims);
  });

  it("rejects a valid token when the session was revoked", async () => {
    const token = await signAccessToken(secret, claims, 60);
    const request = { headers: { authorization: `Bearer ${token}` } };
    await expect(guardWith(false).canActivate(contextFor(request))).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
