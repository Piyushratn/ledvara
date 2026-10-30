import { describe, expect, it } from "vitest";
import { balanceDelta } from "./balance-rules.js";

describe("balanceDelta", () => {
  it.each([
    ["asset", "debit", 100n],
    ["asset", "credit", -100n],
    ["expense", "debit", 100n],
    ["expense", "credit", -100n],
    ["liability", "credit", 100n],
    ["liability", "debit", -100n],
    ["revenue", "credit", 100n],
    ["wallet", "credit", 100n],
    ["wallet", "debit", -100n],
  ] as const)("%s %s changes the balance by %s", (type, direction, expected) => {
    expect(balanceDelta(type, direction, 100n)).toBe(expected);
  });
});
