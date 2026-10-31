import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { createTransferSchema } from "./transfers.schemas.js";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";

describe("createTransferSchema", () => {
  it("accepts a valid transfer", () => {
    const input = parseOrThrow(createTransferSchema, {
      fromAccountId: a,
      toAccountId: b,
      amountMinor: 500,
      reference: " order-1 ",
    });
    expect(input.reference).toBe("order-1");
  });

  it.each([0, -5, 1.5, "100", null, Number.MAX_SAFE_INTEGER + 2])(
    "rejects amount %s",
    (amountMinor) => {
      expect(() =>
        parseOrThrow(createTransferSchema, { fromAccountId: a, toAccountId: b, amountMinor }),
      ).toThrowError(AppError);
    },
  );

  it("rejects the same source and destination", () => {
    expect(() =>
      parseOrThrow(createTransferSchema, { fromAccountId: a, toAccountId: a, amountMinor: 5 }),
    ).toThrowError(AppError);
  });
});
