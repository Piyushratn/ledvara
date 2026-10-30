import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { createApiKeySchema } from "./api-keys.schemas.js";

describe("createApiKeySchema", () => {
  it("accepts a name and valid scopes", () => {
    const input = parseOrThrow(createApiKeySchema, {
      name: " Backend ",
      scopes: ["ledger:read", "ledger:write"],
    });
    expect(input.name).toBe("Backend");
  });

  it("rejects empty scopes, unknown scopes and an empty name", () => {
    expect(() => parseOrThrow(createApiKeySchema, { name: "x", scopes: [] })).toThrowError(
      AppError,
    );
    expect(() => parseOrThrow(createApiKeySchema, { name: "x", scopes: ["admin"] })).toThrowError(
      AppError,
    );
    expect(() =>
      parseOrThrow(createApiKeySchema, { name: " ", scopes: ["ledger:read"] }),
    ).toThrowError(AppError);
  });
});
