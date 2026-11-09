import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;

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

async function newUser(): Promise<string> {
  const email = `u-${randomUUID()}@example.com`;
  await api.signUpVerified(email);
  return (await api.session(email)).accessToken;
}

async function createOrg(token: string, body: Record<string, unknown>) {
  return api.call("POST", "/v1/orgs", { token, body });
}

async function userInOrg(orgId: string, role: string): Promise<string> {
  const email = `${role}-${randomUUID()}@example.com`;
  await api.signUpVerified(email);
  const session = await api.session(email);
  await api.query(
    "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, $3 FROM users WHERE email = $2",
    [orgId, email, role],
  );
  return session.accessToken;
}

describe("organization slug generation", () => {
  it("generates a slug from the name, and a suffixed one when it is taken", async () => {
    const token = await newUser();
    const name = `Acme ${randomUUID().slice(0, 8)}`;
    const base = name.toLowerCase().replace(/[^a-z0-9]+/gu, "-");

    const first = await createOrg(token, { name });
    expect(first.status).toBe(201);
    expect(first.body.slug).toBe(base);

    const second = await createOrg(token, { name });
    expect(second.status).toBe(201);
    expect(String(second.body.slug)).toMatch(new RegExp(`^${base}-[0-9a-f]{6}$`, "u"));
  });

  it("still returns 409 for an explicit slug that is taken", async () => {
    const token = await newUser();
    const slug = `fixed-${randomUUID().slice(0, 8)}`;
    expect((await createOrg(token, { name: "A", slug })).status).toBe(201);
    expect((await createOrg(token, { name: "B", slug })).status).toBe(409);
  });
});

describe("session-authenticated accounts", () => {
  it("lets an owner create and list accounts, with an audit event", async () => {
    const token = await newUser();
    const org = await createOrg(token, { name: "Ledger Org" });
    const orgId = org.body.id as string;
    const base = `/v1/orgs/${orgId}/accounts`;

    const platform = await api.call("POST", base, {
      token,
      body: { code: "platform_funds", name: "Platform funds", type: "asset", allowNegative: true },
    });
    expect(platform.status).toBe(201);
    const wallet = await api.call("POST", base, {
      token,
      body: { code: "wallet_demo", name: "Demo wallet", type: "wallet" },
    });
    expect(wallet.status).toBe(201);
    expect(wallet.body).toMatchObject({ allowNegative: false, balanceMinor: "0" });

    const list = await api.call("GET", base, { token });
    expect((list.body.data as { code: string }[]).map((a) => a.code)).toEqual([
      "platform_funds",
      "wallet_demo",
    ]);

    expect(
      (
        await api.call("POST", base, {
          token,
          body: { code: "wallet_demo", name: "x", type: "wallet" },
        })
      ).status,
    ).toBe(409);
    expect(
      (await api.call("POST", base, { token, body: { name: "x", type: "bogus" } })).status,
    ).toBe(422);

    const audit = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'account.created'",
      [orgId],
    );
    expect(audit[0]?.n).toBe(2);
  });

  it("lets a viewer read but not create, and hides the organization from outsiders", async () => {
    const owner = await newUser();
    const orgId = (await createOrg(owner, { name: "Roles Org" })).body.id as string;
    const viewer = await userInOrg(orgId, "viewer");
    const outsider = await newUser();
    const base = `/v1/orgs/${orgId}/accounts`;

    expect((await api.call("GET", base, { token: viewer })).status).toBe(200);
    expect(
      (await api.call("POST", base, { token: viewer, body: { name: "x", type: "wallet" } })).status,
    ).toBe(403);
    expect((await api.call("GET", base, { token: outsider })).status).toBe(404);
    expect(
      (await api.call("POST", base, { token: outsider, body: { name: "x", type: "wallet" } }))
        .status,
    ).toBe(404);
  });

  it("only lists the organization's own accounts", async () => {
    const token = await newUser();
    const a = (await createOrg(token, { name: "Org A" })).body.id as string;
    const b = (await createOrg(token, { name: "Org B" })).body.id as string;
    await api.call("POST", `/v1/orgs/${a}/accounts`, {
      token,
      body: { code: "only_in_a", name: "A", type: "wallet" },
    });
    const listB = await api.call("GET", `/v1/orgs/${b}/accounts`, { token });
    expect(listB.body.data).toEqual([]);
  });
});
