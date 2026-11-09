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
    "INSERT INTO organizations (name, slug) VALUES ('Ov', $1) RETURNING id",
    [`ov-${randomUUID()}`],
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

async function account(orgId: string, code: string, type: string, negative: boolean) {
  const rows = await api.query<{ id: string }>(
    "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
    [orgId, code, type, negative],
  );
  return rows[0]?.id ?? "";
}

/** A transfer at a chosen time. Balances are untouched: the overview only reads entries. */
async function transfer(
  orgId: string,
  from: string,
  to: string,
  amount: number,
  daysAgo: number,
  status = "settled",
): Promise<void> {
  const txn = await api.query<{ id: string }>(
    `INSERT INTO transactions (org_id, kind, created_at)
     VALUES ($1, 'transfer', now() - ($2::int * interval '1 day')) RETURNING id`,
    [orgId, daysAgo],
  );
  const id = txn[0]?.id;
  await api.query(
    `INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor)
     VALUES ($1, $2, $3, 'debit', $5), ($1, $2, $4, 'credit', $5)`,
    [id, orgId, from, to, amount],
  );
  // The state machine allows created -> settled -> reversed, never created -> reversed.
  await api.query("UPDATE transactions SET status = 'settled' WHERE id = $1", [id]);
  if (status !== "settled") {
    await api.query("UPDATE transactions SET status = $2 WHERE id = $1", [id, status]);
  }
}

interface Overview {
  accepted: number;
  refused: number;
  volumeMinor: string;
  daily: { date: string; accepted: number; volumeMinor: string }[];
  pendingReviews: number;
  reconciliation: { status: string };
}

describe("GET /v1/orgs/:orgId/overview", () => {
  it("returns seven zero days for an organization with no activity", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "viewer");
    const res = await api.call("GET", `/v1/orgs/${orgId}/overview`, { token });
    expect(res.status).toBe(200);
    const body = res.body as unknown as Overview;
    expect(body.daily).toHaveLength(7);
    expect(body.daily.every((d) => d.accepted === 0 && d.volumeMinor === "0")).toBe(true);
    expect(body).toMatchObject({ accepted: 0, refused: 0, volumeMinor: "0", pendingReviews: 0 });
  });

  it("counts accepted transfers, sums settled volume, and ignores older ones", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner");
    const from = await account(orgId, "platform", "asset", true);
    const to = await account(orgId, "wallet", "wallet", false);

    await transfer(orgId, from, to, 1000, 0);
    await transfer(orgId, from, to, 2500, 0);
    await transfer(orgId, from, to, 700, 3);
    await transfer(orgId, from, to, 400, 2, "reversed"); // accepted, but not volume
    await transfer(orgId, from, to, 9999, 30); // outside the window

    const body = (await api.call("GET", `/v1/orgs/${orgId}/overview`, { token }))
      .body as unknown as Overview;
    expect(body.accepted).toBe(4);
    expect(body.volumeMinor).toBe("4200");
    expect(body.daily.at(-1)).toMatchObject({ accepted: 2, volumeMinor: "3500" });
    expect(body.daily.at(-4)).toMatchObject({ accepted: 1, volumeMinor: "700" });
    expect(body.daily.at(-3)).toMatchObject({ accepted: 1, volumeMinor: "0" });
  });

  it("counts refusals and pending reviews, and nothing from another organization", async () => {
    const orgId = await newOrg();
    const other = await newOrg();
    const token = await userIn(orgId, "viewer");
    const from = await account(orgId, "platform", "asset", true);
    const to = await account(orgId, "wallet", "wallet", false);
    const otherFrom = await account(other, "platform", "asset", true);
    const otherTo = await account(other, "wallet", "wallet", false);

    await transfer(orgId, from, to, 100, 0);
    await transfer(other, otherFrom, otherTo, 555, 0);
    await api.query(
      `INSERT INTO transfer_failures (org_id, from_account_id, amount_minor, code)
       VALUES ($1, $2, 10, 'insufficient_funds'), ($3, $4, 10, 'insufficient_funds')`,
      [orgId, to, other, otherTo],
    );

    const txn = await api.query<{ id: string }>(
      "INSERT INTO transactions (org_id, kind) VALUES ($1, 'transfer') RETURNING id",
      [other],
    );
    const assessment = await api.query<{ id: string }>(
      `INSERT INTO risk_assessments
         (org_id, transaction_id, rules_version, score, level, flagged)
       VALUES ($1, $2, 't', 70, 'high', true) RETURNING id`,
      [other, txn[0]?.id],
    );
    await api.query(
      "INSERT INTO review_items (org_id, transaction_id, assessment_id) VALUES ($1, $2, $3)",
      [other, txn[0]?.id, assessment[0]?.id],
    );

    const body = (await api.call("GET", `/v1/orgs/${orgId}/overview`, { token }))
      .body as unknown as Overview;
    expect(body).toMatchObject({ accepted: 1, refused: 1, volumeMinor: "100", pendingReviews: 0 });
  });

  it("reports reconciliation status for this organization only", async () => {
    const orgId = await newOrg();
    const other = await newOrg();
    const token = await userIn(orgId, "viewer");
    const path = `/v1/orgs/${orgId}/overview`;
    const status = async (): Promise<string> =>
      ((await api.call("GET", path, { token })).body as unknown as Overview).reconciliation.status;

    expect(await status()).toBe("none");

    await api.query(
      "INSERT INTO reconciliation_runs (accounts_checked, details) VALUES (2, $1::jsonb)",
      [JSON.stringify({ drifts: [{ orgId: other }], unbalanced: [] })],
    );
    expect(await status()).toBe("ok");

    await api.query(
      "INSERT INTO reconciliation_runs (accounts_checked, details) VALUES (2, $1::jsonb)",
      [JSON.stringify({ drifts: [{ orgId }], unbalanced: [] })],
    );
    expect(await status()).toBe("drift");
  });

  it("is open to any member and hidden from outsiders", async () => {
    const orgId = await newOrg();
    const outsider = await userIn(await newOrg(), "owner");
    const finance = await userIn(orgId, "finance");
    expect((await api.call("GET", `/v1/orgs/${orgId}/overview`, { token: finance })).status).toBe(
      200,
    );
    expect((await api.call("GET", `/v1/orgs/${orgId}/overview`, { token: outsider })).status).toBe(
      404,
    );
    expect((await api.call("GET", `/v1/orgs/${orgId}/overview`)).status).toBe(401);
  });
});
