import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { acceptInviteSchema, createInviteSchema } from "./invites.schemas.js";

describe("createInviteSchema", () => {
  it("normalizes the email and accepts a valid role", () => {
    const input = parseOrThrow(createInviteSchema, { email: " Bob@Example.COM ", role: "finance" });
    expect(input).toEqual({ email: "bob@example.com", role: "finance" });
  });

  it("never allows inviting an owner", () => {
    expect(() =>
      parseOrThrow(createInviteSchema, { email: "bob@example.com", role: "owner" }),
    ).toThrowError(AppError);
  });

  it("rejects an unknown role and a bad email", () => {
    expect(() =>
      parseOrThrow(createInviteSchema, { email: "bob@example.com", role: "root" }),
    ).toThrowError(AppError);
    expect(() => parseOrThrow(createInviteSchema, { email: "nope", role: "viewer" })).toThrowError(
      AppError,
    );
  });
});

describe("acceptInviteSchema", () => {
  it("rejects a short token", () => {
    expect(() => parseOrThrow(acceptInviteSchema, { token: "short" })).toThrowError(AppError);
  });
});
