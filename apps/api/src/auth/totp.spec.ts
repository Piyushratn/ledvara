import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, buildOtpauthUrl, generateTotp, verifyTotp } from "./totp.js";

// RFC 6238 test secret (ASCII "12345678901234567890"). The RFC lists 8 digits; we use the last 6.
const rfcSecret = Buffer.from("12345678901234567890");

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(generateTotp(rfcSecret, 59_000)).toBe("287082");
    expect(generateTotp(rfcSecret, 1_111_111_109_000)).toBe("081804");
    expect(generateTotp(rfcSecret, 1_234_567_890_000)).toBe("005924");
  });

  it("returns the matching step and accepts one step of clock drift", () => {
    const now = 1_234_567_890_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(rfcSecret, generateTotp(rfcSecret, now), now)).toBe(step);
    expect(verifyTotp(rfcSecret, generateTotp(rfcSecret, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(rfcSecret, generateTotp(rfcSecret, now + 30_000), now)).toBe(step + 1);
  });

  it("rejects a code from two steps away", () => {
    const now = 1_234_567_890_000;
    expect(verifyTotp(rfcSecret, generateTotp(rfcSecret, now - 90_000), now)).toBeNull();
  });

  it("rejects malformed codes", () => {
    const now = 1_234_567_890_000;
    expect(verifyTotp(rfcSecret, "12345", now)).toBeNull();
    expect(verifyTotp(rfcSecret, "abcdef", now)).toBeNull();
    expect(verifyTotp(rfcSecret, "", now)).toBeNull();
  });
});

describe("base32", () => {
  it("encodes like the RFC 4648 test vectors", () => {
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB");
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });

  it("decodes back to the original bytes", () => {
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it("rejects invalid characters", () => {
    expect(() => base32Decode("not-base32!")).toThrowError();
  });
});

describe("buildOtpauthUrl", () => {
  it("builds a standard otpauth URI", () => {
    const url = buildOtpauthUrl({
      issuer: "Ledvara",
      account: "a@example.com",
      secret: "ABCDEFGH",
    });
    expect(url).toBe(
      "otpauth://totp/Ledvara:a%40example.com?secret=ABCDEFGH&issuer=Ledvara&algorithm=SHA1&digits=6&period=30",
    );
  });
});
