import { describe, expect, it } from "vitest";
import { PasswordService } from "./password.service.js";

const service = new PasswordService();

describe("PasswordService", () => {
  it("hashes with argon2id and verifies the right password", async () => {
    const hashed = await service.hash("correct-horse-battery");
    expect(hashed.startsWith("$argon2id$")).toBe(true);
    expect(await service.verify(hashed, "correct-horse-battery")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hashed = await service.hash("correct-horse-battery");
    expect(await service.verify(hashed, "wrong-password-here")).toBe(false);
  });

  it("uses a different salt every time", async () => {
    const a = await service.hash("same-password-123");
    const b = await service.hash("same-password-123");
    expect(a).not.toBe(b);
  });

  it("returns false for a malformed hash instead of throwing", async () => {
    expect(await service.verify("not-a-hash", "anything-at-all")).toBe(false);
  });
});
