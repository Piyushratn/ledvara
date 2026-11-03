import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig(valid);
    expect(config.OUTBOX_POLL_MS).toBe(1000);
    expect(config.OUTBOX_BATCH_SIZE).toBe(50);
  });

  it("names missing variables", () => {
    expect(() => loadConfig({})).toThrowError(/DATABASE_URL/);
    expect(() => loadConfig({})).toThrowError(/REDIS_URL/);
  });

  it("rejects out-of-range values", () => {
    expect(() => loadConfig({ ...valid, OUTBOX_BATCH_SIZE: "0" })).toThrowError(
      /OUTBOX_BATCH_SIZE/,
    );
    expect(() => loadConfig({ ...valid, OUTBOX_POLL_MS: "10" })).toThrowError(/OUTBOX_POLL_MS/);
  });
});
