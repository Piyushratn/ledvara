import { describe, expect, it } from "vitest";
import { slugify, withSuffix } from "./slug.js";

const RULE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/u;

describe("slugify", () => {
  it("turns a name into a slug", () => {
    expect(slugify("Acme Corp")).toBe("acme-corp");
    expect(slugify("  Café & Co.  ")).toBe("cafe-co");
  });

  it("falls back to 'org' when too little is left", () => {
    expect(slugify("!!")).toBe("org");
    expect(slugify("日本")).toBe("org");
    expect(slugify("ab")).toBe("org");
  });

  it("always satisfies the slug rule, even for long or messy names", () => {
    for (const name of ["x".repeat(200), "-a-b-c-", "A  B   C", "A".repeat(39) + " b"]) {
      expect(slugify(name)).toMatch(RULE);
      expect(withSuffix(slugify(name))).toMatch(RULE);
    }
  });
});

describe("withSuffix", () => {
  it("appends a random 6-character suffix", () => {
    const a = withSuffix("acme");
    expect(a).toMatch(/^acme-[0-9a-f]{6}$/u);
    expect(withSuffix("acme")).not.toBe(a);
  });
});
