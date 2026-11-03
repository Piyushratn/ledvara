import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSignatureHeader, verifySignatureHeader } from "./signing.js";

const secret = "whsec_test_secret";
const body = '{"id":"evt_1","type":"payout.paid"}';
const now = 1_800_000_000;

describe("webhook signing", () => {
  it("signs HMAC-SHA256 over timestamp.body", () => {
    const expected = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
    expect(buildSignatureHeader(secret, now, body)).toBe(`t=${now},v1=${expected}`);
  });

  it("verifies a good signature", () => {
    expect(verifySignatureHeader(secret, buildSignatureHeader(secret, now, body), body, now)).toBe(
      true,
    );
  });

  it("rejects a wrong secret, a tampered body and a malformed header", () => {
    const header = buildSignatureHeader(secret, now, body);
    expect(verifySignatureHeader("other", header, body, now)).toBe(false);
    expect(verifySignatureHeader(secret, header, `${body} `, now)).toBe(false);
    expect(verifySignatureHeader(secret, "garbage", body, now)).toBe(false);
    expect(verifySignatureHeader(secret, `t=abc,v1=00`, body, now)).toBe(false);
  });

  it("rejects old timestamps (replay) but allows small clock drift", () => {
    const header = buildSignatureHeader(secret, now, body);
    expect(verifySignatureHeader(secret, header, body, now + 301)).toBe(false);
    expect(verifySignatureHeader(secret, header, body, now + 60)).toBe(true);
  });
});
