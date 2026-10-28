import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const CHALLENGE_TTL_SECONDS = 5 * 60;

export interface ChallengeData {
  userId: string;
  email: string;
}

const payloadSchema = z.object({
  uid: z.string().min(1),
  email: z.string().min(1),
  exp: z.number(),
});

// The prefix keeps this signature from ever being valid for any other token type.
function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`2fa-challenge:${payload}`).digest("base64url");
}

export function signChallenge(secret: string, data: ChallengeData, nowMs: number): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid: data.userId,
      email: data.email,
      exp: Math.floor(nowMs / 1000) + CHALLENGE_TTL_SECONDS,
    }),
  ).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyChallenge(
  secret: string,
  token: string,
  nowMs: number,
): ChallengeData | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const parsed = payloadSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (!parsed.success || parsed.data.exp * 1000 <= nowMs) return null;
    return { userId: parsed.data.uid, email: parsed.data.email };
  } catch {
    return null;
  }
}
