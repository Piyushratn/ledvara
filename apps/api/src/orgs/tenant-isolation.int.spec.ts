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

interface World {
  aliceToken: string; // owner of org A
  bobToken: string; // owner of org B
  carolToken: string; // developer in org A
  aliceId: string;
  bobId: string;
  carolId: string;
  orgA: string;
  orgB: string;
  keyA: { id: string; key: string };
  keyB: { id: string; key: string };
}

let w: World;

async function userId(email: string): Promise<string> {
  const rows = await api.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]?.id ?? "";
}

async function createOrg(token: string, slug: string): Promise<string> {
  const res = await api.call("POST", "/v1/orgs", { token, body: { name: slug, slug } });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function createKey(token: string, orgId: string): Promise<{ id: string; key: string }> {
  const res = await api.call("POST", `/v1/orgs/${orgId}/api-keys`, {
    token,
    body: { name: "Backend", scopes: ["ledger:read"] },
  });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, key: res.body.key as string };
}

beforeEach(async () => {
  await ctx.reset();
  for (const email of ["alice@example.com", "bob@example.com", "carol@example.com"]) {
    await api.signUpVerified(email);
  }
  const alice = await api.session("alice@example.com");
  const bob = await api.session("bob@example.com");
  const carol = await api.session("carol@example.com");

  const orgA = await createOrg(alice.accessToken, "org-a");
  const orgB = await createOrg(bob.accessToken, "org-b");

  const aliceId = await userId("alice@example.com");
  const bobId = await userId("bob@example.com");
  const carolId = await userId("carol@example.com");

  // Carol is a developer in org A (membership added directly; invites are tested elsewhere).
  await api.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'developer')", [
    orgA,
    carolId,
  ]);

  w = {
    aliceToken: alice.accessToken,
    bobToken: bob.accessToken,
    carolToken: carol.accessToken,
    aliceId,
    bobId,
    carolId,
    orgA,
    orgB,
    keyA: await createKey(alice.accessToken, orgA),
    keyB: await createKey(bob.accessToken, orgB),
  };
});

/** Everything that belongs to org A, as one comparable string. */
async function snapshotOrgA(): Promise<string> {
  const parts = await Promise.all([
    api.query("SELECT * FROM memberships WHERE org_id = $1 ORDER BY user_id", [w.orgA]),
    api.query("SELECT * FROM api_keys WHERE org_id = $1 ORDER BY id", [w.orgA]),
    api.query("SELECT * FROM invites WHERE org_id = $1 ORDER BY id", [w.orgA]),
    api.query("SELECT * FROM organizations WHERE id = $1", [w.orgA]),
  ]);
  return JSON.stringify(parts);
}

describe("an outsider cannot touch another organization", () => {
  it("gets 404 on every org A endpoint and changes nothing", async () => {
    const before = await snapshotOrgA();
    const base = `/v1/orgs/${w.orgA}`;
    const token = w.bobToken;

    const attempts = [
      api.call("GET", `${base}/members`, { token }),
      api.call("PATCH", `${base}/members/${w.aliceId}`, { token, body: { role: "viewer" } }),
      api.call("DELETE", `${base}/members/${w.aliceId}`, { token }),
      api.call("DELETE", `${base}/members/${w.bobId}`, { token }),
      api.call("POST", `${base}/invites`, {
        token,
        body: { email: "mallory@example.com", role: "viewer" },
      }),
      api.call("POST", `${base}/api-keys`, {
        token,
        body: { name: "Stolen", scopes: ["ledger:read"] },
      }),
      api.call("GET", `${base}/api-keys`, { token }),
      api.call("DELETE", `${base}/api-keys/${w.keyA.id}`, { token }),
      api.call("POST", `${base}/api-keys/${w.keyA.id}/rotate`, { token }),
      api.call("GET", `${base}/audit-events`, { token }),
    ];

    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
    }
    expect(await snapshotOrgA()).toBe(before);
  });

  it("gets 404 for a malformed organization id too", async () => {
    const res = await api.call("GET", "/v1/orgs/not-a-uuid/members", { token: w.bobToken });
    expect(res.status).toBe(404);
  });

  it("cannot use org A ids inside the URL of his own org B", async () => {
    const before = await snapshotOrgA();
    const base = `/v1/orgs/${w.orgB}`;
    const token = w.bobToken;

    const results = await Promise.all([
      api.call("DELETE", `${base}/api-keys/${w.keyA.id}`, { token }),
      api.call("POST", `${base}/api-keys/${w.keyA.id}/rotate`, { token }),
      api.call("PATCH", `${base}/members/${w.aliceId}`, { token, body: { role: "viewer" } }),
      api.call("DELETE", `${base}/members/${w.aliceId}`, { token }),
    ]);
    for (const res of results) expect(res.status).toBe(404);

    expect(await snapshotOrgA()).toBe(before);
    const keys = await api.query<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM api_keys WHERE id = $1",
      [w.keyA.id],
    );
    expect(keys[0]?.revoked_at).toBeNull();
  });

  it("keeps org A members out of org B's lists", async () => {
    const res = await api.call("GET", `/v1/orgs/${w.orgB}/members`, { token: w.bobToken });
    expect(res.status).toBe(200);
    const emails = (res.body.data as { email: string }[]).map((m) => m.email);
    expect(emails).toEqual(["bob@example.com"]);

    const orgs = await api.call("GET", "/v1/orgs", { token: w.bobToken });
    const slugs = (orgs.body.data as { slug: string }[]).map((o) => o.slug);
    expect(slugs).toEqual(["org-b"]);
  });

  it("does not leak org B events into org A's audit log", async () => {
    const res = await api.call("GET", `/v1/orgs/${w.orgA}/audit-events`, {
      token: w.aliceToken,
    });
    expect(res.status).toBe(200);
    const events = res.body.data as { targetId: string | null }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.targetId === w.orgB || e.targetId === w.keyB.id)).toBe(false);
  });

  it("applies to members of A attacking B as well", async () => {
    const res = await api.call("GET", `/v1/orgs/${w.orgB}/members`, { token: w.carolToken });
    expect(res.status).toBe(404);
  });
});

describe("roles are enforced inside an organization", () => {
  it("lets a developer manage keys but not roles, invites or the audit log", async () => {
    const base = `/v1/orgs/${w.orgA}`;
    const token = w.carolToken;

    const list = await api.call("GET", `${base}/api-keys`, { token });
    expect(list.status).toBe(200);

    const role = await api.call("PATCH", `${base}/members/${w.carolId}`, {
      token,
      body: { role: "owner" },
    });
    expect(role.status).toBe(403);

    const invite = await api.call("POST", `${base}/invites`, {
      token,
      body: { email: "dave@example.com", role: "viewer" },
    });
    expect(invite.status).toBe(403);

    const audit = await api.call("GET", `${base}/audit-events`, { token });
    expect(audit.status).toBe(403);

    const removeOwner = await api.call("DELETE", `${base}/members/${w.aliceId}`, { token });
    expect(removeOwner.status).toBe(403);
  });

  it("refuses to demote or remove the last owner", async () => {
    const base = `/v1/orgs/${w.orgA}`;
    const demote = await api.call("PATCH", `${base}/members/${w.aliceId}`, {
      token: w.aliceToken,
      body: { role: "viewer" },
    });
    expect(demote.status).toBe(409);
    const leave = await api.call("DELETE", `${base}/members/${w.aliceId}`, {
      token: w.aliceToken,
    });
    expect(leave.status).toBe(409);
  });
});

describe("API keys are bound to their own organization", () => {
  it("always reports the key's own organization", async () => {
    const a = await api.call("GET", `/v1/whoami?orgId=${w.orgB}`, { token: w.keyA.key });
    expect(a.status).toBe(200);
    expect(a.body.orgId).toBe(w.orgA);

    const b = await api.call("GET", `/v1/whoami?orgId=${w.orgA}`, { token: w.keyB.key });
    expect(b.status).toBe(200);
    expect(b.body.orgId).toBe(w.orgB);
  });

  it("rejects a revoked key", async () => {
    const revoke = await api.call("DELETE", `/v1/orgs/${w.orgA}/api-keys/${w.keyA.id}`, {
      token: w.aliceToken,
    });
    expect(revoke.status).toBe(204);
    const res = await api.call("GET", "/v1/whoami", { token: w.keyA.key });
    expect(res.status).toBe(401);
  });

  it("rejects the old key after rotation", async () => {
    const rotated = await api.call("POST", `/v1/orgs/${w.orgA}/api-keys/${w.keyA.id}/rotate`, {
      token: w.aliceToken,
    });
    expect(rotated.status).toBe(201);
    expect((await api.call("GET", "/v1/whoami", { token: w.keyA.key })).status).toBe(401);
    const fresh = await api.call("GET", "/v1/whoami", { token: rotated.body.key as string });
    expect(fresh.status).toBe(200);
    expect(fresh.body.orgId).toBe(w.orgA);
  });

  it("stops working when the organization is deleted", async () => {
    await api.query("DELETE FROM organizations WHERE id = $1", [w.orgA]);
    const res = await api.call("GET", "/v1/whoami", { token: w.keyA.key });
    expect(res.status).toBe(401);
  });

  it("enforces scopes", async () => {
    const res = await api.call("GET", "/v1/whoami/ledger", { token: w.keyA.key });
    expect(res.status).toBe(403);
  });

  it("never stores a key in plain text", async () => {
    const rows = await api.query<{ key_hash: string; key_prefix: string }>(
      "SELECT key_hash, key_prefix FROM api_keys WHERE id = $1",
      [w.keyA.id],
    );
    expect(rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(w.keyA.key.startsWith(rows[0]?.key_prefix ?? "?")).toBe(true);
    expect(rows[0]?.key_hash).not.toContain(w.keyA.key);
  });
});

describe("the audit log cannot be rewritten", () => {
  it("rejects UPDATE and DELETE on audit_events", async () => {
    await expect(api.query("UPDATE audit_events SET action = 'tampered'")).rejects.toThrow(
      /append-only/u,
    );
    await expect(api.query("DELETE FROM audit_events")).rejects.toThrow(/append-only/u);
  });
});
