import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, type Permission } from "./permissions.js";
import { ROLES, type Role } from "./roles.js";

const expected: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: PERMISSIONS.filter((p) => p !== "members:invite_admin" && p !== "members:update_role"),
  developer: [
    "org:read",
    "members:read",
    "ledger:read",
    "reports:read",
    "api_keys:read",
    "api_keys:manage",
    "ledger:write",
  ],
  finance: [
    "org:read",
    "members:read",
    "ledger:read",
    "reports:read",
    "ledger:write",
    "audit:read",
  ],
  viewer: ["org:read", "members:read", "ledger:read", "reports:read"],
};

describe("role permission matrix", () => {
  for (const role of ROLES) {
    describe(role, () => {
      for (const permission of PERMISSIONS) {
        const allowed = expected[role].includes(permission);
        it(`${allowed ? "may" : "may not"} ${permission}`, () => {
          expect(can(role, permission)).toBe(allowed);
        });
      }
    });
  }

  it("only owners can change roles or invite admins", () => {
    for (const role of ROLES) {
      expect(can(role, "members:update_role")).toBe(role === "owner");
      expect(can(role, "members:invite_admin")).toBe(role === "owner");
    }
  });
});
