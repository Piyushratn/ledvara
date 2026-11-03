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
    [`Org ${counter}`, `org-${counter}-${Date.now()}`],
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

const GOOD_URL = "https://hooks.example.com/ledvara";

describe("webhook endpoints", () => {
  it("creates an endpoint, shows the secret once and stores it encrypted", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner", "owner@example.com");

    const created = await api.call("POST", `/v1/orgs/${orgId}/webhook-endpoints`, {
      token,
      body: { url: GOOD_URL, eventTypes: ["payout.paid"] },
    });
    expect(created.status).toBe(201);
    const secret = created.body.secret as string;
    expect(secret.startsWith("whsec_")).toBe(true);

    const rows = await api.query<{ secret_enc: string }>(
      "SELECT secret_enc FROM webhook_endpoints",
    );
    expect(rows[0]?.secret_enc.startsWith("v1.")).toBe(true);
    expect(rows[0]?.secret_enc).not.toContain(secret);

    const list = await api.call("GET", `/v1/orgs/${orgId}/webhook-endpoints`, { token });
    expect(list.status).toBe(200);
    const data = list.body.data as Record<string, unknown>[];
    expect(data).toHaveLength(1);
    expect(data[0]?.secret).toBeUndefined();
    expect(data[0]?.secretEnc).toBeUndefined();
  });

  it("rejects unsafe URLs with 422", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner", "owner@example.com");
    for (const url of [
      "http://example.com/hook",
      "https://localhost/hook",
      "https://169.254.169.254/latest",
      "https://10.0.0.5/hook",
      "https://user:pw@example.com/hook",
    ]) {
      const res = await api.call("POST", `/v1/orgs/${orgId}/webhook-endpoints`, {
        token,
        body: { url },
      });
      expect(res.status).toBe(422);
    }
  });

  it("enforces roles and hides the organization from outsiders", async () => {
    const orgId = await newOrg();
    const viewer = await userIn(orgId, "viewer", "viewer@example.com");
    const developer = await userIn(orgId, "developer", "dev@example.com");
    await api.signUpVerified("outsider@example.com");
    const outsider = (await api.session("outsider@example.com")).accessToken;

    const asViewer = await api.call("POST", `/v1/orgs/${orgId}/webhook-endpoints`, {
      token: viewer,
      body: { url: GOOD_URL },
    });
    expect(asViewer.status).toBe(403);

    const asDeveloper = await api.call("POST", `/v1/orgs/${orgId}/webhook-endpoints`, {
      token: developer,
      body: { url: GOOD_URL },
    });
    expect(asDeveloper.status).toBe(201);

    const asOutsider = await api.call("GET", `/v1/orgs/${orgId}/webhook-endpoints`, {
      token: outsider,
    });
    expect(asOutsider.status).toBe(404);
  });

  it("rotates the secret and deletes, and cannot touch another organization's endpoint", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const token = await userIn(orgA, "owner", "owner@example.com");
    await api.query(
      "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, 'owner' FROM users WHERE email = $2",
      [orgB, "owner@example.com"],
    );

    const inA = await api.call("POST", `/v1/orgs/${orgA}/webhook-endpoints`, {
      token,
      body: { url: GOOD_URL },
    });
    const inB = await api.call("POST", `/v1/orgs/${orgB}/webhook-endpoints`, {
      token,
      body: { url: GOOD_URL },
    });
    const idA = inA.body.id as string;
    const idB = inB.body.id as string;

    const before = await api.query<{ secret_enc: string }>(
      "SELECT secret_enc FROM webhook_endpoints WHERE id = $1",
      [idA],
    );
    const rotated = await api.call(
      "POST",
      `/v1/orgs/${orgA}/webhook-endpoints/${idA}/rotate-secret`,
      {
        token,
      },
    );
    expect(rotated.status).toBe(200);
    expect(String(rotated.body.secret).startsWith("whsec_")).toBe(true);
    const after = await api.query<{ secret_enc: string }>(
      "SELECT secret_enc FROM webhook_endpoints WHERE id = $1",
      [idA],
    );
    expect(after[0]?.secret_enc).not.toBe(before[0]?.secret_enc);

    // Org B's endpoint is invisible through org A's URL.
    const cross = await api.call("DELETE", `/v1/orgs/${orgA}/webhook-endpoints/${idB}`, { token });
    expect(cross.status).toBe(404);

    expect(
      (await api.call("DELETE", `/v1/orgs/${orgA}/webhook-endpoints/${idA}`, { token })).status,
    ).toBe(200);
    expect(
      (await api.call("DELETE", `/v1/orgs/${orgA}/webhook-endpoints/${idA}`, { token })).status,
    ).toBe(404);
  });
});
