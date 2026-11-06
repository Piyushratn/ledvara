import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, renderReport } from "./evaluate.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("evaluate", () => {
  it("computes the confusion matrix and metrics from known outcomes", () => {
    const base = SCENARIOS[0] as Scenario;
    const flaggedHistory = {
      ...base.history,
      countLast10Min: 9,
      amountLastHourMinor: 10_000_000n,
    };
    const result = evaluate([
      { ...base, label: "suspicious", history: flaggedHistory }, // flagged: TP
      { ...base, label: "legitimate", history: flaggedHistory }, // flagged: FP
      { ...base, label: "suspicious" }, // quiet: FN
      { ...base, label: "legitimate" }, // quiet: TN
    ]);
    expect([result.tp, result.fp, result.fn, result.tn]).toEqual([1, 1, 1, 1]);
    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(0.5);
    expect(result.f1).toBe(0.5);
  });

  it("returns null instead of dividing by zero", () => {
    const quiet = evaluate([{ ...(SCENARIOS[0] as Scenario), label: "legitimate" }]);
    expect(quiet.precision).toBeNull();
    expect(quiet.recall).toBeNull();
    expect(quiet.f1).toBeNull();
  });

  it("has a balanced, non-trivial scenario set", () => {
    const suspicious = SCENARIOS.filter((s) => s.label === "suspicious").length;
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20);
    expect(suspicious).toBeGreaterThanOrEqual(8);
    expect(SCENARIOS.length - suspicious).toBeGreaterThanOrEqual(8);
    expect(new Set(SCENARIOS.map((s) => s.name)).size).toBe(SCENARIOS.length);
  });

  it("is deterministic", () => {
    expect(evaluate(SCENARIOS)).toEqual(evaluate(SCENARIOS));
  });

  it("keeps the committed report in sync with the code", () => {
    const committed = readFileSync(join(here, "../../../../../docs/risk-evaluation.md"), "utf8");
    const expected = renderReport(evaluate(SCENARIOS));
    // Ignore line endings and the column padding that Prettier adds to markdown tables.
    const normalize = (text: string): string =>
      text
        .replace(/\r\n/gu, "\n")
        .replace(/[ \t]+/gu, " ")
        .replace(/-{3,}:?/gu, "---")
        .replace(/:?-{3,}/gu, "---");
    expect(normalize(committed)).toBe(normalize(expected));
  });
});
