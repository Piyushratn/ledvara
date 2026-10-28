import { describe, expect, it } from "vitest";
import { CHALLENGE_TTL_SECONDS, signChallenge, verifyChallenge } from "./two-factor-challenge.js";

const secret = "test-secret-test-secret-test-secret";
const now = 1_700_000_000_000;
const data = { userId: "user-1", email: "a@example.com" };

describe("two-factor challenge", () => {
  it("round-trips", () => {
    expect(verifyChallenge(secret, signChallenge(secret, data, now), now)).toEqual(data);
  });

  it("expires", () => {
    const token = signChallenge(secret, data, now);
    const later = now + (CHALLENGE_TTL_SECONDS + 1) * 1000;
    expect(verifyChallenge(secret, token, later)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = signChallenge("another-secret-another-secret-123", data, now);
    expect(verifyChallenge(secret, token, now)).toBeNull();
  });

  it("rejects a forged payload", () => {
    const token = signChallenge(secret, data, now);
    const signature = token.split(".")[1] ?? "";
    const forgedPayload = Buffer.from(
      JSON.stringify({ uid: "user-2", email: "b@example.com", exp: 9_999_999_999 }),
    ).toString("base64url");
    expect(verifyChallenge(secret, `${forgedPayload}.${signature}`, now)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyChallenge(secret, "garbage", now)).toBeNull();
    expect(verifyChallenge(secret, "a.b.c", now)).toBeNull();
    expect(verifyChallenge(secret, "", now)).toBeNull();
  });
});
