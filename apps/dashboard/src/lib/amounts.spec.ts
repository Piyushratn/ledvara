import { describe, expect, it } from "vitest";
import { rupeesToPaise } from "./amounts";

describe("rupeesToPaise", () => {
  it("converts rupees exactly, without floating point", () => {
    expect(rupeesToPaise("12.34")).toBe("1234");
    expect(rupeesToPaise("0.1")).toBe("10");
    expect(rupeesToPaise("1,000")).toBe("100000");
    expect(rupeesToPaise("  500 ")).toBe("50000");
    expect(rupeesToPaise("99999999999999999.99")).toBe("9999999999999999999");
  });

  it("rejects blanks, zero, negatives, more than two decimals and junk", () => {
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("0")).toBeNull();
    expect(rupeesToPaise("-5")).toBeNull();
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
  });
});
