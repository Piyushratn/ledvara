import { createHash } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type pg from "pg";

export const PASSWORD = "correct-horse-battery";

export interface Resp {
  status: number;
  body: Record<string, unknown>;
}

export class Api {
  constructor(
    private readonly app: NestFastifyApplication,
    private readonly pool: pg.Pool,
  ) {}

  async call(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    options: { body?: unknown; token?: string; userAgent?: string } = {},
  ): Promise<Resp> {
    const headers: Record<string, string> = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.userAgent) headers["user-agent"] = options.userAgent;
    const res = await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers,
        ...(options.body === undefined ? {} : { payload: options.body as object }),
      });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      // empty or non-JSON body
    }
    return { status: res.statusCode, body };
  }

  /** Typed raw SQL for assertions. */
  async query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async signUpVerified(email: string, password = PASSWORD): Promise<void> {
    const res = await this.call("POST", "/v1/auth/signup", {
      body: { email, password, fullName: "Test User" },
    });
    if (res.status !== 202) throw new Error(`signup failed: ${res.status}`);
    await this.pool.query("UPDATE users SET email_verified_at = now() WHERE email = $1", [email]);
  }

  async login(email: string, password = PASSWORD, userAgent?: string): Promise<Resp> {
    return this.call("POST", "/v1/auth/login", {
      body: { email, password },
      ...(userAgent ? { userAgent } : {}),
    });
  }

  /** Logs in an already verified user and returns the tokens. */
  async session(
    email: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await this.login(email, PASSWORD, userAgent);
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
    return {
      accessToken: res.body.accessToken as string,
      refreshToken: res.body.refreshToken as string,
    };
  }

  /** Plants a known token (the DB only stores the hash). */
  async plantToken(
    table: "password_reset_tokens" | "email_verification_tokens",
    email: string,
    token: string,
    ttlSeconds = 3600,
  ): Promise<void> {
    const hash = createHash("sha256").update(token).digest("hex");
    await this.pool.query(
      `INSERT INTO ${table} (user_id, token_hash, expires_at)
       SELECT id, $2, now() + ($3 || ' seconds')::interval FROM users WHERE email = $1`,
      [email, hash, String(ttlSeconds)],
    );
  }
}
