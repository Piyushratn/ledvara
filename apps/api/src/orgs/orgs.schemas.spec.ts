import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { createOrgSchema } from "./orgs.schemas.js";

describe("createOrgSchema", () => {
  it("accepts a normal name and slug, lowercasing the slug", () => {
    const input = parseOrThrow(createOrgSchema, { name: " Acme Inc ", slug: "Acme-Pay" });
    expect(input).toEqual({ name: "Acme Inc", slug: "acme-pay" });
  });

  it.each(["ab", "-acme", "acme-", "has space", "under_score", "a".repeat(51)])(
    "rejects the slug %s",
    (slug) => {
      expect(() => parseOrThrow(createOrgSchema, { name: "Acme", slug })).toThrowError(AppError);
    },
  );

  it("rejects an empty name", () => {
    expect(() => parseOrThrow(createOrgSchema, { name: "  ", slug: "acme" })).toThrowError(
      AppError,
    );
  });
});
