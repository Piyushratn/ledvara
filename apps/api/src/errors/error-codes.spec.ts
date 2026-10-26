import { describe, expect, it } from "vitest";
import { ErrorCodes, codeForStatus } from "./error-codes.js";

describe("codeForStatus", () => {
  it.each([
    [400, ErrorCodes.BadRequest],
    [401, ErrorCodes.Unauthorized],
    [403, ErrorCodes.Forbidden],
    [404, ErrorCodes.NotFound],
    [409, ErrorCodes.Conflict],
    [422, ErrorCodes.ValidationFailed],
    [429, ErrorCodes.RateLimited],
    [500, ErrorCodes.InternalError],
    [503, ErrorCodes.InternalError],
  ])("maps status %i to %s", (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});
