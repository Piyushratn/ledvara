import { describe, expect, it } from "vitest";
import {
  clearRefreshCookie,
  readCookie,
  REFRESH_COOKIE_NAME,
  serializeRefreshCookie,
} from "./refresh-cookie.js";

describe("serializeRefreshCookie", () => {
  it("is HttpOnly, SameSite=Strict and scoped to /v1/auth", () => {
    const cookie = serializeRefreshCookie("abc", 3600, false);
    expect(cookie).toContain("ledvara_refresh=abc");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/v1/auth");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure when asked", () => {
    expect(serializeRefreshCookie("abc", 60, true)).toContain("Secure");
  });
});

describe("clearRefreshCookie", () => {
  it("expires the cookie immediately with the same scope", () => {
    const cookie = clearRefreshCookie(true);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/v1/auth");
    expect(cookie).toContain("Secure");
  });
});

describe("readCookie", () => {
  it("finds the named cookie among several and decodes it", () => {
    const header = `a=1; ${REFRESH_COOKIE_NAME}=${encodeURIComponent("t o+k")}; b=2`;
    expect(readCookie(header, REFRESH_COOKIE_NAME)).toBe("t o+k");
  });

  it("returns null when missing, empty, malformed or only a name suffix matches", () => {
    expect(readCookie(undefined, REFRESH_COOKIE_NAME)).toBeNull();
    expect(readCookie("a=1", REFRESH_COOKIE_NAME)).toBeNull();
    expect(readCookie(`${REFRESH_COOKIE_NAME}=`, REFRESH_COOKIE_NAME)).toBeNull();
    expect(readCookie(`${REFRESH_COOKIE_NAME}=%E0%A4%A`, REFRESH_COOKIE_NAME)).toBeNull();
    expect(readCookie(`x${REFRESH_COOKIE_NAME}=abc`, REFRESH_COOKIE_NAME)).toBeNull();
  });
});
