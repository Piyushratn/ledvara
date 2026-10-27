import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "./jwt.js";

const secret = "a-test-secret-that-is-at-least-32-characters-long";
const claims = { userId: "11111111-1111-1111-1111-111111111111", sessionId: "sess-1" };

describe("access tokens", () => {
  it("round-trips the claims", async () => {
    const token = await signAccessToken(secret, claims, 60);
    expect(await verifyAccessToken(secret, token)).toEqual(claims);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken(
      "another-secret-that-is-also-32-characters-long",
      claims,
      60,
    );
    await expect(verifyAccessToken(secret, token)).rejects.toThrow();
  });

  it("rejects a tampered token", async () => {
    const token = await signAccessToken(secret, claims, 60);
    const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(verifyAccessToken(secret, tampered)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signAccessToken(secret, claims, 1);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await expect(verifyAccessToken(secret, token)).rejects.toThrow();
  });
});
