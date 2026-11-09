import type { Account, CreatedKey, Org, OrgApi } from "./lib/org-api";

export const TEST_ORG: Org = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme",
  slug: "acme",
  role: "owner",
};

export const TEST_KEY: CreatedKey = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "sandbox",
  prefix: "lv_test_ab",
  key: "lv_test_secretvalue",
};

/** An in-memory OrgApi. Accounts created through it show up in listAccounts. */
export function fakeOrgApi(overrides: Partial<OrgApi> = {}): OrgApi & { created: string[] } {
  const accounts: Account[] = [];
  const created: string[] = [];
  return {
    created,
    listOrgs: () => Promise.resolve([TEST_ORG]),
    createOrg: () => Promise.resolve(TEST_ORG),
    listAccounts: () => Promise.resolve([...accounts]),
    createAccount: (_orgId, input) => {
      const account: Account = {
        id: `acc-${accounts.length + 1}`,
        code: input.code,
        name: input.name,
        type: input.type,
        balanceMinor: "0",
      };
      accounts.push(account);
      created.push(input.code);
      return Promise.resolve(account);
    },
    createApiKey: () => Promise.resolve(TEST_KEY),
    ...overrides,
  };
}
