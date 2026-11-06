import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { approveSchema, listReviewsSchema, rejectSchema } from "./review.schemas.js";

describe("review schemas", () => {
  it("defaults the list limit and validates the status filter", () => {
    expect(parseOrThrow(listReviewsSchema, {}).limit).toBe(50);
    expect(parseOrThrow(listReviewsSchema, { status: "pending", limit: "10" })).toEqual({
      status: "pending",
      limit: 10,
    });
    expect(() => parseOrThrow(listReviewsSchema, { status: "maybe" })).toThrowError(AppError);
    expect(() => parseOrThrow(listReviewsSchema, { limit: "0" })).toThrowError(AppError);
  });

  it("makes the note optional for approve and required for reject", () => {
    expect(parseOrThrow(approveSchema, {}).note).toBeUndefined();
    expect(parseOrThrow(approveSchema, { note: " ok " }).note).toBe("ok");
    expect(() => parseOrThrow(rejectSchema, {})).toThrowError(AppError);
    expect(() => parseOrThrow(rejectSchema, { note: "   " })).toThrowError(AppError);
    expect(parseOrThrow(rejectSchema, { note: "looks stolen" }).note).toBe("looks stolen");
  });
});
