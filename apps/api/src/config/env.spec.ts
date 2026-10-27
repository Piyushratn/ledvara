import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
};

describe("loadEnv", () => {
  it("applies defaults when optional values are missing", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
  });

  it("throws and names the missing variables", () => {
    expect(() => loadEnv({})).toThrowError(/DATABASE_URL/);
    expect(() => loadEnv({})).toThrowError(/REDIS_URL/);
    expect(() => loadEnv({})).toThrowError(/JWT_SECRET/);
  });

  it("rejects a short JWT secret", () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: "too-short" })).toThrowError(/JWT_SECRET/);
  });

  it("rejects an invalid port", () => {
    expect(() => loadEnv({ ...valid, PORT: "99999" })).toThrowError(/PORT/);
  });

  it("splits CORS_ORIGINS on commas and trims spaces", () => {
    const env = loadEnv({ ...valid, CORS_ORIGINS: "http://a.test, http://b.test ," });
    expect(env.CORS_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
});
