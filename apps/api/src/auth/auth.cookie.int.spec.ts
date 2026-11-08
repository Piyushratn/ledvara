import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api, PASSWORD } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";
import { REQUESTED_WITH } from "./refresh-cookie.js";

let ctx: TestApp;
let api: Api;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
});

afterAll(async () => {
  await ctx.stop();
});

beforeEach(async () => {
  await ctx.reset();
});

interface Answer {
  status: number;
  body: Record<string, unknown>;
  setCookie: string | null;
}

async function send(
  method: "POST",
  url: string,
  options: { headers?: Record<string, string>; payload?: unknown } = {},
): Promise<Answer> {
  const res = await ctx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: options.headers ?? {},
      ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    });
  const header = res.headers["set-cookie"];
  const setCookie = Array.isArray(header) ? (header[0] ?? null) : (header ?? null);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    // empty body
  }
  return { status: res.statusCode, body, setCookie };
}

function cookieValue(setCookie: string | null): string {
  const match = /^ledvara_refresh=([^;]+)/u.exec(setCookie ?? "");
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

async function loggedIn(): Promise<Answer> {
  await api.signUpVerified("alice@example.com");
  return send("POST", "/v1/auth/login", {
    payload: { email: "alice@example.com", password: PASSWORD },
  });
}

describe("refresh token cookie", () => {
  it("login sets an httpOnly, SameSite=Strict cookie scoped to /v1/auth, matching the body token", async () => {
    const login = await loggedIn();
    expect(login.status).toBe(200);
    expect(login.setCookie).toContain("HttpOnly");
    expect(login.setCookie).toContain("SameSite=Strict");
    expect(login.setCookie).toContain("Path=/v1/auth");
    expect(cookieValue(login.setCookie)).toBe(login.body.refreshToken);
  });

  it("refreshes from the cookie with the required header, rotating the token", async () => {
    const login = await loggedIn();
    const first = cookieValue(login.setCookie);
    const refreshed = await send("POST", "/v1/auth/refresh", {
      headers: { cookie: `ledvara_refresh=${first}`, "x-requested-with": REQUESTED_WITH },
      payload: {},
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeDefined();
    const second = cookieValue(refreshed.setCookie);
    expect(second).not.toBe("");
    expect(second).not.toBe(first);
  });

  it("refuses a cookie refresh without the header, and the token stays usable", async () => {
    const login = await loggedIn();
    const token = cookieValue(login.setCookie);
    const cookie = { cookie: `ledvara_refresh=${token}` };

    const blocked = await send("POST", "/v1/auth/refresh", { headers: cookie, payload: {} });
    expect(blocked.status).toBe(403);

    const allowed = await send("POST", "/v1/auth/refresh", {
      headers: { ...cookie, "x-requested-with": REQUESTED_WITH },
      payload: {},
    });
    expect(allowed.status).toBe(200);
  });

  it("still accepts the token in the body, with no cookie or header (API clients)", async () => {
    const login = await loggedIn();
    const refreshed = await send("POST", "/v1/auth/refresh", {
      payload: { refreshToken: login.body.refreshToken },
    });
    expect(refreshed.status).toBe(200);
  });

  it("answers 401 for a missing or bad cookie, and clears a bad one", async () => {
    const headers = { "x-requested-with": REQUESTED_WITH };
    const none = await send("POST", "/v1/auth/refresh", { headers, payload: {} });
    expect(none.status).toBe(401);

    const bad = await send("POST", "/v1/auth/refresh", {
      headers: { ...headers, cookie: `ledvara_refresh=${"x".repeat(43)}` },
      payload: {},
    });
    expect(bad.status).toBe(401);
    expect(bad.setCookie).toContain("Max-Age=0");
  });

  it("logout clears the cookie", async () => {
    const login = await loggedIn();
    const out = await send("POST", "/v1/auth/logout", {
      headers: { authorization: `Bearer ${String(login.body.accessToken)}` },
    });
    expect(out.status).toBe(200);
    expect(out.setCookie).toContain("Max-Age=0");
  });
});
