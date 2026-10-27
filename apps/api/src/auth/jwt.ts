import { SignJWT, jwtVerify } from "jose";

const ISSUER = "ledvara";
const AUDIENCE = "ledvara-api";

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

function keyFrom(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export function signAccessToken(
  secret: string,
  claims: AccessClaims,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keyFrom(secret));
}

export async function verifyAccessToken(secret: string, token: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, keyFrom(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    throw new Error("Access token is missing required claims");
  }
  return { userId: payload.sub, sessionId: payload.sid };
}
