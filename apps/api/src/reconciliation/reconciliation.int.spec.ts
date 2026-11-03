import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let counter = 0;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
});

afterAll(async () => {
  await ctx.stop();
});

beforeEach(async () => {
  await ctx.reset();
});

async function newOrg(): Promise<string> {
  counter += 1;
  const rows = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [`Org ${counter}`, `recon-${counter}-${Date.now()}`],
  );
  return rows[0]?.id ?? "";
}

async function userIn(orgId: string, role: string, email: string): Promise<string> {
  await api.signUpVerified(email);
  const session = await api.session(email);
  await api.query(
    "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, $3 FROM users WHERE email = $2",
    [orgId, email, role],
  );
  return session.accessToken;
}

describe("GET /v1/orgs/:orgId/reconciliation", () => {
  it("shows only the caller's organization's findings", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const token = await userIn(orgA, "viewer", "viewer@example.com");

    const details = {
      drifts: [
        {
          accountId: "11111111-1111-4111-8111-111111111111",
          orgId: orgA,
          stored: "5",
          derived: "4",
        },
        {
          accountId: "22222222-2222-4222-8222-222222222222",
          orgId: orgB,
          stored: "9",
          derived: "1",
        },
      ],
      unbalanced: [],
    };
    await api.query(
      "INSERT INTO reconciliation_runs (accounts_checked, balance_drifts, details) VALUES (4, 2, $1::jsonb)",
      [JSON.stringify(details)],
    );

    const res = await api.call("GET", `/v1/orgs/${orgA}/reconciliation`, { token });
    expect(res.status).toBe(200);
    const run = (res.body.data as { ok: boolean; drifts: { accountId: string }[] }[])[0];
    expect(run?.ok).toBe(false);
    expect(run?.drifts).toHaveLength(1);
    expect(run?.drifts[0]?.accountId).toBe("11111111-1111-4111-8111-111111111111");
    expect(JSON.stringify(res.body)).not.toContain("22222222-2222-4222");
  });

  it("reports a clean run as ok and hides the organization from outsiders", async () => {
    const orgA = await newOrg();
    const token = await userIn(orgA, "viewer", "viewer@example.com");
    await api.query("INSERT INTO reconciliation_runs (accounts_checked) VALUES (3)");

    const res = await api.call("GET", `/v1/orgs/${orgA}/reconciliation`, { token });
    expect((res.body.data as { ok: boolean }[])[0]?.ok).toBe(true);

    await api.signUpVerified("outsider@example.com");
    const outsider = (await api.session("outsider@example.com")).accessToken;
    expect(
      (await api.call("GET", `/v1/orgs/${orgA}/reconciliation`, { token: outsider })).status,
    ).toBe(404);
  });
});
