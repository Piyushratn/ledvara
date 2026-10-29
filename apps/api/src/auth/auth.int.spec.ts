import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "../test-support/test-app.js";
import { Api, PASSWORD } from "../test-support/helpers.js";
import { currentCode } from "../test-support/totp-helper.js";

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

describe("sign up", () => {
  it("creates a user with an argon2id hash and the same 202 for a duplicate", async () => {
    const first = await api.call("POST", "/v1/auth/signup", {
      body: { email: "Alice@Example.com", password: PASSWORD },
    });
    const second = await api.call("POST", "/v1/auth/signup", {
      body: { email: "alice@example.com", password: PASSWORD },
    });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);

    const rows = await api.query<{ email: string; password_hash: string }>(
      "SELECT email, password_hash FROM users",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("alice@example.com");
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/u);
  });

  it("rejects a short password with 422", async () => {
    const res = await api.call("POST", "/v1/auth/signup", {
      body: { email: "bob@example.com", password: "short" },
    });
    expect(res.status).toBe(422);
  });
});

describe("login", () => {
  it("refuses an unverified account", async () => {
    await api.call("POST", "/v1/auth/signup", {
      body: { email: "alice@example.com", password: PASSWORD },
    });
    const res = await api.login("alice@example.com");
    expect(res.status).toBe(403);
  });

  it("returns tokens for a verified account and /me works", async () => {
    await api.signUpVerified("alice@example.com");
    const res = await api.login("alice@example.com");
    expect(res.status).toBe(200);
    const me = await api.call("GET", "/v1/auth/me", { token: res.body.accessToken as string });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("alice@example.com");
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    await api.signUpVerified("alice@example.com");
    const wrong = await api.login("alice@example.com", "definitely-wrong-1");
    const unknown = await api.login("ghost@example.com", "definitely-wrong-1");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);

    const strip = (body: Record<string, unknown>): unknown => {
      const error = (body.error ?? {}) as Record<string, unknown>;
      return { ...body, error: { ...error, requestId: undefined } };
    };
    expect(strip(unknown.body)).toEqual(strip(wrong.body));
    expect((unknown.body.error as { code: string }).code).toBe("invalid_credentials");
  });

  it("rejects /me without a token", async () => {
    const res = await api.call("GET", "/v1/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("refresh rotation", () => {
  it("rotates once, and reusing the old token revokes the whole session", async () => {
    await api.signUpVerified("alice@example.com");
    const s = await api.session("alice@example.com");

    const rotated = await api.call("POST", "/v1/auth/refresh", {
      body: { refreshToken: s.refreshToken },
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(s.refreshToken);

    const replay = await api.call("POST", "/v1/auth/refresh", {
      body: { refreshToken: s.refreshToken },
    });
    expect(replay.status).toBe(401);

    // Theft response: the newest token of that session is dead too.
    const newest = await api.call("POST", "/v1/auth/refresh", {
      body: { refreshToken: rotated.body.refreshToken },
    });
    expect(newest.status).toBe(401);
  });

  it("lets only one of two concurrent refreshes win", async () => {
    await api.signUpVerified("alice@example.com");
    const s = await api.session("alice@example.com");
    const results = await Promise.all([
      api.call("POST", "/v1/auth/refresh", { body: { refreshToken: s.refreshToken } }),
      api.call("POST", "/v1/auth/refresh", { body: { refreshToken: s.refreshToken } }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });
});

describe("logout", () => {
  it("kills the access token immediately", async () => {
    await api.signUpVerified("alice@example.com");
    const s = await api.session("alice@example.com");
    const out = await api.call("POST", "/v1/auth/logout", { token: s.accessToken });
    expect(out.status).toBe(200);
    const me = await api.call("GET", "/v1/auth/me", { token: s.accessToken });
    expect(me.status).toBe(401);
  });

  it("logout-all kills every device", async () => {
    await api.signUpVerified("alice@example.com");
    const a = await api.session("alice@example.com");
    const b = await api.session("alice@example.com");
    await api.call("POST", "/v1/auth/logout-all", { token: a.accessToken });
    expect((await api.call("GET", "/v1/auth/me", { token: a.accessToken })).status).toBe(401);
    expect((await api.call("GET", "/v1/auth/me", { token: b.accessToken })).status).toBe(401);
  });
});

describe("email verification", () => {
  it("verifies once and rejects reuse", async () => {
    await api.call("POST", "/v1/auth/signup", {
      body: { email: "alice@example.com", password: PASSWORD },
    });
    const token = "v".repeat(43);
    await api.plantToken("email_verification_tokens", "alice@example.com", token);

    const first = await api.call("POST", "/v1/auth/verify-email", { body: { token } });
    const second = await api.call("POST", "/v1/auth/verify-email", { body: { token } });
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect((await api.login("alice@example.com")).status).toBe(200);
  });

  it("rejects an expired token", async () => {
    await api.call("POST", "/v1/auth/signup", {
      body: { email: "alice@example.com", password: PASSWORD },
    });
    const token = "e".repeat(43);
    await api.plantToken("email_verification_tokens", "alice@example.com", token, -60);
    const res = await api.call("POST", "/v1/auth/verify-email", { body: { token } });
    expect(res.status).toBe(400);
  });
});

describe("password reset", () => {
  it("answers the same for a real and an unknown email", async () => {
    await api.signUpVerified("alice@example.com");
    const real = await api.call("POST", "/v1/auth/forgot-password", {
      body: { email: "alice@example.com" },
    });
    const ghost = await api.call("POST", "/v1/auth/forgot-password", {
      body: { email: "nobody@example.com" },
    });
    expect(real.status).toBe(202);
    expect(ghost.status).toBe(202);
    expect(ghost.body).toEqual(real.body);
    const tokens = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM password_reset_tokens",
    );
    expect(tokens[0]?.n).toBe(1);
  });

  it("resets once, revokes old sessions, and swaps the password", async () => {
    await api.signUpVerified("alice@example.com");
    const old = await api.session("alice@example.com");
    const token = "r".repeat(43);
    await api.plantToken("password_reset_tokens", "alice@example.com", token);

    const body = { token, newPassword: "brand-new-password-1" };
    const first = await api.call("POST", "/v1/auth/reset-password", { body });
    const second = await api.call("POST", "/v1/auth/reset-password", { body });
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);

    expect((await api.call("GET", "/v1/auth/me", { token: old.accessToken })).status).toBe(401);
    expect((await api.login("alice@example.com", PASSWORD)).status).toBe(401);
    expect((await api.login("alice@example.com", "brand-new-password-1")).status).toBe(200);
  });
});

describe("lockout", () => {
  it("locks after five failures, even for the right password, and spares other accounts", async () => {
    await api.signUpVerified("alice@example.com");
    await api.signUpVerified("bob@example.com");

    for (let i = 0; i < 5; i++) {
      expect((await api.login("alice@example.com", "definitely-wrong-1")).status).toBe(401);
    }
    expect((await api.login("alice@example.com", "definitely-wrong-1")).status).toBe(429);
    expect((await api.login("alice@example.com")).status).toBe(429);
    expect((await api.login("bob@example.com")).status).toBe(200);
  });

  it("a success clears the failure counter", async () => {
    await api.signUpVerified("alice@example.com");
    for (let i = 0; i < 4; i++) await api.login("alice@example.com", "definitely-wrong-1");
    expect((await api.login("alice@example.com")).status).toBe(200);
    for (let i = 0; i < 4; i++) await api.login("alice@example.com", "definitely-wrong-1");
    expect((await api.login("alice@example.com")).status).toBe(200);
  });
});

describe("two-factor authentication", () => {
  async function enable(email: string): Promise<{ secret: string; backupCodes: string[] }> {
    await api.signUpVerified(email);
    const s = await api.session(email);
    const setup = await api.call("POST", "/v1/auth/2fa/setup", { token: s.accessToken });
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    const on = await api.call("POST", "/v1/auth/2fa/enable", {
      token: s.accessToken,
      body: { code: currentCode(secret) },
    });
    expect(on.status).toBe(200);
    return { secret, backupCodes: on.body.backupCodes as string[] };
  }

  it("stores the secret encrypted and returns 10 backup codes", async () => {
    const { secret, backupCodes } = await enable("alice@example.com");
    expect(backupCodes).toHaveLength(10);
    const rows = await api.query<{ two_factor_secret_enc: string }>(
      "SELECT two_factor_secret_enc FROM users",
    );
    const stored = rows[0]?.two_factor_secret_enc ?? "";
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain(secret);
  });

  it("returns a challenge instead of tokens, and a fresh code completes login", async () => {
    const { secret } = await enable("alice@example.com");
    const challenge = await api.login("alice@example.com");
    expect(challenge.status).toBe(200);
    expect(challenge.body.twoFactorRequired).toBe(true);
    expect(challenge.body.accessToken).toBeUndefined();

    // The enable step consumed the current time step; the next one is a fresh code.
    const done = await api.call("POST", "/v1/auth/login/2fa", {
      body: { challengeToken: challenge.body.challengeToken, code: currentCode(secret, 1) },
    });
    expect(done.status).toBe(200);
    expect(done.body.accessToken).toBeDefined();
  });

  it("refuses a replayed code and a wrong code", async () => {
    const { secret } = await enable("alice@example.com");
    const challenge = await api.login("alice@example.com");
    const token = challenge.body.challengeToken;

    const wrong = await api.call("POST", "/v1/auth/login/2fa", {
      body: { challengeToken: token, code: "000000" },
    });
    expect(wrong.status).toBe(401);

    // Same step as the one used to enable 2FA.
    const replay = await api.call("POST", "/v1/auth/login/2fa", {
      body: { challengeToken: token, code: currentCode(secret) },
    });
    expect(replay.status).toBe(401);
  });

  it("accepts each backup code exactly once", async () => {
    const { backupCodes } = await enable("alice@example.com");
    const challenge = await api.login("alice@example.com");
    const body = { challengeToken: challenge.body.challengeToken, code: backupCodes[0] };
    expect((await api.call("POST", "/v1/auth/login/2fa", { body })).status).toBe(200);
    expect((await api.call("POST", "/v1/auth/login/2fa", { body })).status).toBe(401);
  });

  it("rejects a forged challenge", async () => {
    await enable("alice@example.com");
    const res = await api.call("POST", "/v1/auth/login/2fa", {
      body: { challengeToken: "x".repeat(60), code: "123456" },
    });
    expect(res.status).toBe(401);
  });

  it("disable needs the password and a code, then login returns tokens again", async () => {
    const { backupCodes } = await enable("alice@example.com");
    const challenge = await api.login("alice@example.com");
    const done = await api.call("POST", "/v1/auth/login/2fa", {
      body: { challengeToken: challenge.body.challengeToken, code: backupCodes[0] },
    });
    const token = done.body.accessToken as string;

    const badPassword = await api.call("POST", "/v1/auth/2fa/disable", {
      token,
      body: { password: "definitely-wrong-1", code: backupCodes[1] },
    });
    expect(badPassword.status).toBe(403);

    const ok = await api.call("POST", "/v1/auth/2fa/disable", {
      token,
      body: { password: PASSWORD, code: backupCodes[1] },
    });
    expect(ok.status).toBe(200);
    expect((await api.login("alice@example.com")).body.accessToken).toBeDefined();
    const left = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM two_factor_backup_codes",
    );
    expect(left[0]?.n).toBe(0);
  });
});

describe("active sessions", () => {
  it("lists each device once, even after a refresh, and marks the current one", async () => {
    await api.signUpVerified("alice@example.com");
    const laptop = await api.session("alice@example.com", "Laptop/1.0");
    await api.session("alice@example.com", "Phone/1.0");

    const rotated = await api.call("POST", "/v1/auth/refresh", {
      body: { refreshToken: laptop.refreshToken },
      userAgent: "Laptop/1.0",
    });
    const list = await api.call("GET", "/v1/auth/sessions", {
      token: rotated.body.accessToken as string,
    });
    const sessions = list.body.sessions as { current: boolean; userAgent: string }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current).map((s) => s.userAgent)).toEqual(["Laptop/1.0"]);
  });

  it("revokes one device without touching the others", async () => {
    await api.signUpVerified("alice@example.com");
    const laptop = await api.session("alice@example.com", "Laptop/1.0");
    const phone = await api.session("alice@example.com", "Phone/1.0");

    const list = await api.call("GET", "/v1/auth/sessions", { token: laptop.accessToken });
    const other = (list.body.sessions as { id: string; current: boolean }[]).find(
      (s) => !s.current,
    );
    const del = await api.call("DELETE", `/v1/auth/sessions/${other?.id}`, {
      token: laptop.accessToken,
    });
    expect(del.status).toBe(200);
    expect((await api.call("GET", "/v1/auth/me", { token: phone.accessToken })).status).toBe(401);
    expect((await api.call("GET", "/v1/auth/me", { token: laptop.accessToken })).status).toBe(200);
  });

  it("cannot revoke another user's session", async () => {
    await api.signUpVerified("alice@example.com");
    await api.signUpVerified("bob@example.com");
    const alice = await api.session("alice@example.com");
    const bob = await api.session("bob@example.com");

    const bobList = await api.call("GET", "/v1/auth/sessions", { token: bob.accessToken });
    const bobSessionId = (bobList.body.sessions as { id: string }[])[0]?.id;
    const res = await api.call("DELETE", `/v1/auth/sessions/${bobSessionId}`, {
      token: alice.accessToken,
    });
    expect(res.status).toBe(404);
    expect((await api.call("GET", "/v1/auth/me", { token: bob.accessToken })).status).toBe(200);
  });

  it("revokes all other devices and keeps the current one", async () => {
    await api.signUpVerified("alice@example.com");
    const current = await api.session("alice@example.com");
    const other = await api.session("alice@example.com");
    await api.call("DELETE", "/v1/auth/sessions", { token: current.accessToken });
    expect((await api.call("GET", "/v1/auth/me", { token: other.accessToken })).status).toBe(401);
    expect((await api.call("GET", "/v1/auth/me", { token: current.accessToken })).status).toBe(200);
  });
});
