import { describe, expect, it } from "vitest";
import { toQuery } from "./transfers-api";

describe("toQuery", () => {
  it("drops empty filters and sets the page size", () => {
    expect(toQuery({ status: "settled", search: "", minAmount: undefined })).toBe(
      "status=settled&limit=25",
    );
  });

  it("adds the cursor when given", () => {
    const query = toQuery({ search: "rent" }, "abc");
    expect(query).toContain("search=rent");
    expect(query).toContain("cursor=abc");
  });
});
