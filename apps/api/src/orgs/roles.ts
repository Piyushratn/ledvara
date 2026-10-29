export const ROLES = ["owner", "admin", "developer", "finance", "viewer"] as const;
export type Role = (typeof ROLES)[number];
