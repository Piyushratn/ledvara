import { z } from "zod";
import { client as defaultClient } from "./client";
import type { ApiClient } from "./http";

const orgSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string(),
});

const accountSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  balanceMinor: z.string(),
});

const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  key: z.string().min(1),
});

export type Org = z.infer<typeof orgSchema>;
export type Account = z.infer<typeof accountSchema>;
export type CreatedKey = z.infer<typeof apiKeySchema>;

export interface NewAccount {
  code: string;
  name: string;
  type: "asset" | "wallet";
  allowNegative: boolean;
}

export interface OrgApi {
  listOrgs(): Promise<Org[]>;
  createOrg(name: string): Promise<Org>;
  listAccounts(orgId: string): Promise<Account[]>;
  createAccount(orgId: string, input: NewAccount): Promise<Account>;
  createApiKey(orgId: string, name: string): Promise<CreatedKey>;
}

export function createOrgApi(client: ApiClient): OrgApi {
  return {
    async listOrgs() {
      const raw = await client.request("/v1/orgs");
      return z.object({ data: z.array(orgSchema) }).parse(raw).data;
    },
    async createOrg(name) {
      const raw = await client.request("/v1/orgs", { method: "POST", body: { name } });
      return orgSchema.parse(raw);
    },
    async listAccounts(orgId) {
      const raw = await client.request(`/v1/orgs/${orgId}/accounts`);
      return z.object({ data: z.array(accountSchema) }).parse(raw).data;
    },
    async createAccount(orgId, input) {
      const raw = await client.request(`/v1/orgs/${orgId}/accounts`, {
        method: "POST",
        body: input,
      });
      return accountSchema.parse(raw);
    },
    async createApiKey(orgId, name) {
      const raw = await client.request(`/v1/orgs/${orgId}/api-keys`, {
        method: "POST",
        body: { name, scopes: ["ledger:write", "ledger:read"] },
      });
      return apiKeySchema.parse(raw);
    },
  };
}

export const orgApi: OrgApi = createOrgApi(defaultClient);
