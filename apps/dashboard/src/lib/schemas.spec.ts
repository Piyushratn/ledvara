import { describe, expect, it } from "vitest";
import { loginSchema, signUpSchema, twoFactorSchema } from "./schemas";

describe("dashboard form schemas", () => {
  it("normalizes the email and accepts a valid sign-up", () => {
    const result = signUpSchema.safeParse({
      fullName: "",
      email: "  Alice@Example.COM ",
      password: "correct-horse-battery",
    });
    expect(result.success && result.data.email).toBe("alice@example.com");
  });

  it("rejects a short password and a bad email with readable messages", () => {
    const result = signUpSchema.safeParse({ fullName: "", email: "nope", password: "short" });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages).toContain("Enter a valid email address.");
    expect(messages).toContain("Use at least 10 characters.");
  });

  it("requires a password to sign in", () => {
    expect(loginSchema.safeParse({ email: "a@example.com", password: "" }).success).toBe(false);
  });

  it("requires at least six characters for the second factor", () => {
    expect(twoFactorSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(twoFactorSchema.safeParse({ code: " 123456 " }).success).toBe(true);
  });
});
