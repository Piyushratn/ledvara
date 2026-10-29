import { base32Decode, generateTotp } from "../auth/totp.js";

export function currentCode(secret: string, offsetSteps = 0): string {
  return generateTotp(base32Decode(secret), Date.now() + offsetSteps * 30_000);
}
