import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "./ip-guard.js";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.5",
    "64:ff9b::7f00:1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("allows public address %s", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});
