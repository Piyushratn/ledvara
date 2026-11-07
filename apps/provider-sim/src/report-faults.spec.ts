import { describe, expect, it } from "vitest";
import { applyReportFaults, NO_FAULTS, type ReportEntry } from "./report-faults.js";

const entry = (reference: string, amountMinor = "1000", status: "settled" | "failed" = "settled") =>
  ({ providerRef: `prov_${reference}`, reference, amountMinor, status }) satisfies ReportEntry;

const report = [entry("a"), entry("b"), entry("c")];

describe("applyReportFaults", () => {
  it("returns the report unchanged when there are no faults", () => {
    expect(applyReportFaults(report, NO_FAULTS)).toEqual(report);
  });

  it("drops entries and overrides amounts and statuses by reference", () => {
    const result = applyReportFaults(report, {
      ...NO_FAULTS,
      drop: ["a"],
      amountOverrides: { b: "999" },
      statusOverrides: { c: "failed" },
    });
    expect(result.map((r) => r.reference)).toEqual(["b", "c"]);
    expect(result[0]?.amountMinor).toBe("999");
    expect(result[1]?.status).toBe("failed");
  });

  it("appends invented entries", () => {
    const ghost = entry("ghost", "5");
    const result = applyReportFaults(report, { ...NO_FAULTS, extra: [ghost] });
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual(ghost);
  });

  it("does not modify its input", () => {
    const before = JSON.stringify(report);
    applyReportFaults(report, { ...NO_FAULTS, drop: ["a"], amountOverrides: { b: "1" } });
    expect(JSON.stringify(report)).toBe(before);
  });
});
