import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { signUpSchema } from "./auth.schemas.js";

describe("signUpSchema", () => {
  it("trims and lowercases the email", () => {
    const input = parseOrThrow(signUpSchema, {
      email: "  Alice@Example.COM ",
      password: "correct-horse-battery",
    });
    expect(input.email).toBe("alice@example.com");
  });

  it("rejects a short password", () => {
    expect(() =>
      parseOrThrow(signUpSchema, { email: "a@example.com", password: "short" }),
    ).toThrowError(AppError);
  });

  it("rejects an invalid email", () => {
    expect(() =>
      parseOrThrow(signUpSchema, { email: "not-an-email", password: "correct-horse-battery" }),
    ).toThrowError(AppError);
  });

  it("rejects a missing body", () => {
    expect(() => parseOrThrow(signUpSchema, undefined)).toThrowError(AppError);
  });

  it("accepts an optional full name", () => {
    const input = parseOrThrow(signUpSchema, {
      email: "a@example.com",
      password: "correct-horse-battery",
      fullName: "Alice",
    });
    expect(input.fullName).toBe("Alice");
  });
});
