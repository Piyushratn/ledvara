import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { createEndpointSchema } from "./webhooks.schemas.js";

describe("createEndpointSchema", () => {
  it("defaults to all events", () => {
    expect(parseOrThrow(createEndpointSchema, { url: "https://example.com/h" }).eventTypes).toEqual(
      ["*"],
    );
  });

  it("accepts dotted event names", () => {
    const input = parseOrThrow(createEndpointSchema, {
      url: "https://example.com/h",
      eventTypes: ["payout.paid", "transfer.posted"],
    });
    expect(input.eventTypes).toHaveLength(2);
  });

  it("rejects a missing url, empty or malformed event types", () => {
    expect(() => parseOrThrow(createEndpointSchema, {})).toThrowError(AppError);
    expect(() =>
      parseOrThrow(createEndpointSchema, { url: "https://example.com/h", eventTypes: [] }),
    ).toThrowError(AppError);
    expect(() =>
      parseOrThrow(createEndpointSchema, {
        url: "https://example.com/h",
        eventTypes: ["Bad Name"],
      }),
    ).toThrowError(AppError);
  });
});
