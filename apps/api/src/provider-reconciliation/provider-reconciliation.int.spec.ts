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

async function newOrg(): Promise<string> {
  const rows = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Prov', $1) RETURNING id",
    [`prov-${randomUUID()}`],
  );
  return rows[0]?.id ?? "";
}

async function userIn(orgId: string, role: string): Promise<string> {
  const email = `${role}-${randomUUID()}@example.com`;
  await api.signUpVerified(email);
  const session = await api.session(email);
  await api.query(
    "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, $3 FROM users WHERE email = $2",
    [orgId, email, role],
  );
  return session.accessToken;
}

const item = (kind: string, orgId: string | null, payoutId: string | null) => ({
  kind,
  payoutId,
  orgId,
  providerRef: payoutId ? `prov_${payoutId}` : "prov_ghost",
  ledgerAmountMinor: payoutId ? "1000" : null,
  providerAmountMinor: "999",
  ledgerStatus: payoutId ? "settled" : null,
  providerStatus: "settled",
});

describe("GET /v1/orgs/:orgId/provider-reconciliation", () => {
  it("shows only the caller's discrepancies and never an item without an organization", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const viewer = await userIn(orgA, "viewer");
    const mine = randomUUID();
    const theirs = randomUUID();

    await api.query(
      "INSERT INTO provider_reconciliation_runs (payouts_checked, items) VALUES (3, $1::jsonb)",
      [
        JSON.stringify([
          item("amount_mismatch", orgA, mine),
          item("missing_at_provider", orgB, theirs),
          item("missing_in_ledger", null, null),
        ]),
      ],
    );

    const res = await api.call("GET", `/v1/orgs/${orgA}/provider-reconciliation`, {
      token: viewer,
    });
    expect(res.status).toBe(200);
    const run = (
      res.body.data as { ok: boolean; discrepancies: { payoutId: string; kind: string }[] }[]
    )[0];
    expect(run?.ok).toBe(false);
    expect(run?.discrepancies).toHaveLength(1);
    expect(run?.discrepancies[0]).toMatchObject({ payoutId: mine, kind: "amount_mismatch" });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(theirs);
    expect(text).not.toContain("prov_ghost");
  });

  it("reports a clean run as ok, an error run as not ok, and hides the org from outsiders", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const viewer = await userIn(orgA, "viewer");
    const outsider = await userIn(orgB, "owner");
    const path = `/v1/orgs/${orgA}/provider-reconciliation`;

    await api.query("INSERT INTO provider_reconciliation_runs (payouts_checked) VALUES (2)");
    const clean = await api.call("GET", path, { token: viewer });
    expect((clean.body.data as { ok: boolean }[])[0]?.ok).toBe(true);

    await api.query(
      "INSERT INTO provider_reconciliation_runs (status, error) VALUES ('error', 'provider down')",
    );
    const errored = await api.call("GET", path, { token: viewer });
    const latest = (errored.body.data as { ok: boolean; status: string }[])[0];
    expect(latest).toMatchObject({ ok: false, status: "error" });
    expect(JSON.stringify(errored.body)).not.toContain("provider down");

    expect((await api.call("GET", path, { token: outsider })).status).toBe(404);
  });
});
