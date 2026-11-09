import { describe, expect, it } from "vitest";
import { formatInr } from "./money";

describe("formatInr", () => {
  it("formats paise as rupees with Indian grouping", () => {
    expect(formatInr("10000")).toBe("₹100.00");
    expect(formatInr("5")).toBe("₹0.05");
    expect(formatInr("123456789")).toBe("₹12,34,567.89");
    expect(formatInr("99999")).toBe("₹999.99");
    expect(formatInr("100000")).toBe("₹1,000.00");
  });

  it("handles zero and negative amounts", () => {
    expect(formatInr("0")).toBe("₹0.00");
    expect(formatInr("-150000")).toBe("-₹1,500.00");
  });

  it("stays exact beyond the safe integer range", () => {
    expect(formatInr("12345678901234567890")).toBe("₹1,23,45,67,89,01,23,45,678.90");
  });

  it("shows a dash for anything that is not an integer string", () => {
    expect(formatInr("12.5")).toBe("—");
    expect(formatInr("")).toBe("—");
    expect(formatInr("abc")).toBe("—");
  });
});
