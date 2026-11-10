import { describe, expect, it } from "vitest";
import { csvCell, plainInr, transfersToCsv } from "./csv.js";

describe("csvCell", () => {
  it("leaves plain text alone and quotes commas, quotes and newlines", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("defuses formula injection", () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
  });

  it("does not touch a formula character that is not first", () => {
    expect(csvCell("a=b")).toBe("a=b");
  });
});

describe("plainInr", () => {
  it("formats paise exactly, beyond the safe integer range too", () => {
    expect(plainInr("10000")).toBe("100.00");
    expect(plainInr("5")).toBe("0.05");
    expect(plainInr("12345678901234567890")).toBe("123456789012345678.90");
    expect(plainInr("x")).toBe("");
  });
});

describe("transfersToCsv", () => {
  it("writes a header, one line per row, and an empty cell for a missing reference", () => {
    const csv = transfersToCsv([
      {
        id: "t1",
        status: "settled",
        createdAt: "2026-11-09T10:00:00Z",
        fromAccountId: "a",
        toAccountId: "b",
        amountMinor: "10000",
        currency: "INR",
        reference: null,
      },
    ]);
    const [header, line] = csv.split("\r\n");
    expect(header).toBe(
      "id,status,created_at,from_account_id,to_account_id,amount_minor,amount_inr,currency,reference",
    );
    expect(line).toBe("t1,settled,2026-11-09T10:00:00Z,a,b,10000,100.00,INR,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
