import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { updateMemberRoleSchema } from "./members.schemas.js";

describe("updateMemberRoleSchema", () => {
  it.each(["owner", "admin", "developer", "finance", "viewer"])("accepts %s", (role) => {
    expect(parseOrThrow(updateMemberRoleSchema, { role })).toEqual({ role });
  });

  it("rejects an unknown role and a missing role", () => {
    expect(() => parseOrThrow(updateMemberRoleSchema, { role: "root" })).toThrowError(AppError);
    expect(() => parseOrThrow(updateMemberRoleSchema, {})).toThrowError(AppError);
  });
});
