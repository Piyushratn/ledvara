import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "ledvara-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function buildSignatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, body)}`;
}

/** What a receiver runs. Also used in our own tests to prove the format is verifiable. */
export function verifySignatureHeader(
  secret: string,
  header: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") signatures.push(value);
  }
  if (timestamp === null || !Number.isInteger(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = Buffer.from(computeSignature(secret, timestamp, body));
  return signatures.some((signature) => {
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
