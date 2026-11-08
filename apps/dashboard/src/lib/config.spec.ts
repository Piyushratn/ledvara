import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "./config";

describe("resolveApiUrl", () => {
  it("falls back to localhost:3000 for missing or blank values", () => {
    expect(resolveApiUrl(undefined)).toBe("http://localhost:3000");
    expect(resolveApiUrl("   ")).toBe("http://localhost:3000");
    expect(resolveApiUrl(42)).toBe("http://localhost:3000");
  });

  it("trims the value and removes trailing slashes", () => {
    expect(resolveApiUrl(" https://api.example.com// ")).toBe("https://api.example.com");
  });
});
