import type { Role } from "./roles.js";

export const PERMISSIONS = [
  "org:read",
  "org:update",
  "members:read",
  "members:invite",
  "members:invite_admin",
  "members:update_role",
  "members:remove",
  "api_keys:read",
  "api_keys:manage",
  "ledger:read",
  "ledger:write",
  "reports:read",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEW: Permission[] = ["org:read", "members:read", "ledger:read", "reports:read"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [...PERMISSIONS],
  admin: PERMISSIONS.filter((p) => p !== "members:invite_admin" && p !== "members:update_role"),
  developer: [...VIEW, "api_keys:read", "api_keys:manage", "ledger:write"],
  finance: [...VIEW, "ledger:write", "audit:read"],
  viewer: VIEW,
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
