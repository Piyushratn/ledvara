export const API_KEY_SCOPES = [
  "ledger:read",
  "ledger:write",
  "reports:read",
  "webhooks:manage",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
