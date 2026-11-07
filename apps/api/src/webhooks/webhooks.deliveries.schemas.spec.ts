import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { listDeliveriesSchema, replayFailedSchema } from "./webhooks.schemas.js";

describe("listDeliveriesSchema", () => {
  it("defaults the limit and accepts the filters", () => {
    expect(parseOrThrow(listDeliveriesSchema, {}).limit).toBe(50);
    const input = parseOrThrow(listDeliveriesSchema, {
      status: "failed",
      endpointId: "11111111-1111-4111-8111-111111111111",
      limit: "10",
    });
    expect(input).toMatchObject({ status: "failed", limit: 10 });
  });

  it("rejects an unknown status, a bad endpoint id and an out-of-range limit", () => {
    expect(() => parseOrThrow(listDeliveriesSchema, { status: "dead" })).toThrowError(AppError);
    expect(() => parseOrThrow(listDeliveriesSchema, { endpointId: "nope" })).toThrowError(AppError);
    expect(() => parseOrThrow(listDeliveriesSchema, { limit: "101" })).toThrowError(AppError);
  });
});

describe("replayFailedSchema", () => {
  it("accepts an empty body or an endpoint id, and rejects a malformed id", () => {
    expect(parseOrThrow(replayFailedSchema, {}).endpointId).toBeUndefined();
    expect(
      parseOrThrow(replayFailedSchema, { endpointId: "11111111-1111-4111-8111-111111111111" })
        .endpointId,
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(() => parseOrThrow(replayFailedSchema, { endpointId: "x" })).toThrowError(AppError);
  });
});
