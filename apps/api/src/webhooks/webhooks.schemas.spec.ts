import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { createEndpointSchema, updateEndpointSchema } from "./webhooks.schemas.js";

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

describe("updateEndpointSchema", () => {
  it("accepts a single field", () => {
    expect(parseOrThrow(updateEndpointSchema, { enabled: false }).enabled).toBe(false);
    expect(parseOrThrow(updateEndpointSchema, { description: null }).description).toBeNull();
  });

  it("rejects an empty body and bad values", () => {
    expect(() => parseOrThrow(updateEndpointSchema, {})).toThrowError(AppError);
    expect(() => parseOrThrow(updateEndpointSchema, { eventTypes: [] })).toThrowError(AppError);
    expect(() => parseOrThrow(updateEndpointSchema, { enabled: "yes" })).toThrowError(AppError);
  });
});
