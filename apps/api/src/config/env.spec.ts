import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadEnv", () => {
  it("applies defaults when optional values are missing", () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
  });

  it("throws and names the missing variables", () => {
    expect(() => loadEnv({})).toThrowError(/DATABASE_URL/);
    expect(() => loadEnv({})).toThrowError(/REDIS_URL/);
  });

  it("rejects an invalid port", () => {
    expect(() => loadEnv({ ...valid, PORT: "99999" })).toThrowError(/PORT/);
  });

  it("splits CORS_ORIGINS on commas and trims spaces", () => {
    const env = loadEnv({ ...valid, CORS_ORIGINS: "http://a.test, http://b.test ," });
    expect(env.CORS_ORIGINS).toEqual(["http://a.test", "http://b.test"]);
  });
});
