import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { forgotPasswordSchema, resetPasswordSchema } from "./auth.schemas.js";

describe("forgotPasswordSchema", () => {
  it("normalizes the email", () => {
    expect(parseOrThrow(forgotPasswordSchema, { email: " Bob@Example.COM " }).email).toBe(
      "bob@example.com",
    );
  });

  it("rejects an invalid email", () => {
    expect(() => parseOrThrow(forgotPasswordSchema, { email: "nope" })).toThrowError(AppError);
  });
});

describe("resetPasswordSchema", () => {
  const token = "a".repeat(43);

  it("accepts a token and a strong enough password", () => {
    const input = parseOrThrow(resetPasswordSchema, { token, newPassword: "new-correct-horse" });
    expect(input.newPassword).toBe("new-correct-horse");
  });

  it("rejects a short new password", () => {
    expect(() => parseOrThrow(resetPasswordSchema, { token, newPassword: "short" })).toThrowError(
      AppError,
    );
  });

  it("rejects a missing token", () => {
    expect(() =>
      parseOrThrow(resetPasswordSchema, { newPassword: "new-correct-horse" }),
    ).toThrowError(AppError);
  });
});
