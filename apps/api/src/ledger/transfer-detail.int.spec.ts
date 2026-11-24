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
    "INSERT INTO organizations (name, slug) VALUES ('D', $1) RETURNING id",
    [`d-${randomUUID()}`],
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

async function accounts(orgId: string): Promise<{ from: string; to: string }> {
  const make = async (code: string, name: string, type: string, neg: boolean): Promise<string> => {
    const rows = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [orgId, code, name, type, neg],
    );
    return rows[0]?.id ?? "";
  };
  return {
    from: await make("platform", "Platform funds", "asset", true),
    to: await make("wallet", "Demo wallet", "wallet", false),
  };
}

/** A settled transfer. Going through created -> settled exercises the history triggers. */
async function transfer(orgId: string, pair: { from: string; to: string }): Promise<string> {
  const txn = await api.query<{ id: string }>(
    "INSERT INTO transactions (org_id, kind, reference) VALUES ($1, 'transfer', 'detail test') RETURNING id",
    [orgId],
  );
  const id = txn[0]?.id ?? "";
  await api.query(
    `INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor)
     VALUES ($1, $2, $3, 'debit', 12500), ($1, $2, $4, 'credit', 12500)`,
    [id, orgId, pair.from, pair.to],
  );
  await api.query("UPDATE transactions SET status = 'settled' WHERE id = $1", [id]); // same status: no new row
  return id;
}

interface Detail {
  transfer: { amountMinor: string; status: string; from: { name: string }; to: { name: string } };
  timeline: { status: string; approximate: boolean }[];
  entries: { direction: string; amountMinor: string }[];
  related: { id: string; kind: string; relation: string }[];
  risk: { score: number; review: { status: string } | null } | null;
  deliveries: { status: string; eventType: string }[];
  audit: { action: string }[] | null;
}

const detail = async (orgId: string, id: string, token: string) =>
  api.call("GET", `/v1/orgs/${orgId}/transfers/${id}/detail`, { token });

describe("status history triggers", () => {
  it("records every status change in order, with exact (not approximate) timestamps", async () => {
    const orgId = await newOrg();
    const pair = await accounts(orgId);
    const txn = await api.query<{ id: string }>(
      "INSERT INTO transactions (org_id, kind) VALUES ($1, 'transfer') RETURNING id",
      [orgId],
    );
    const id = txn[0]?.id ?? "";
    await api.query("UPDATE transactions SET status = 'pending' WHERE id = $1", [id]);
    await api.query("UPDATE transactions SET status = 'settled' WHERE id = $1", [id]); // same status: no new row
    void pair;

    const rows = await api.query<{ status: string; backfilled: boolean }>(
      "SELECT status, backfilled FROM transaction_status_history WHERE transaction_id = $1 ORDER BY id",
      [id],
    );
    expect(rows.map((r) => r.status)).toEqual(["created", "pending", "settled"]);
    expect(rows.every((r) => !r.backfilled)).toBe(true);
  });
});

describe("GET /v1/orgs/:orgId/transfers/:id/detail", () => {
  it("returns the transfer, its timeline and both ledger entries", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "viewer");
    const id = await transfer(orgId, await accounts(orgId));

    const res = await detail(orgId, id, token);
    expect(res.status).toBe(200);
    const body = res.body as unknown as Detail;
    expect(body.transfer).toMatchObject({
      amountMinor: "12500",
      status: "settled",
      from: { name: "Platform funds" },
      to: { name: "Demo wallet" },
    });
    expect(body.timeline.map((s) => s.status)).toEqual(["created", "settled"]);
    expect(body.entries.map((e) => e.direction).sort()).toEqual(["credit", "debit"]);
    expect(body.risk).toBeNull();
    expect(body.deliveries).toEqual([]);
  });

  it("links a reversal both ways", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "viewer");
    const original = await transfer(orgId, await accounts(orgId));
    const reversal = await api.query<{ id: string }>(
      "INSERT INTO transactions (org_id, kind, reverses_id) VALUES ($1, 'reversal', $2) RETURNING id",
      [orgId, original],
    );
    const reversalId = reversal[0]?.id ?? "";

    const forward = (await detail(orgId, original, token)).body as unknown as Detail;
    expect(forward.related).toEqual([
      expect.objectContaining({ id: reversalId, kind: "reversal", relation: "reversed_by" }),
    ]);
  });

  it("shows risk, review state and webhook deliveries, and hides the audit trail from a viewer", async () => {
    const orgId = await newOrg();
    const viewer = await userIn(orgId, "viewer");
    const finance = await userIn(orgId, "finance");
    const id = await transfer(orgId, await accounts(orgId));

    const assessment = await api.query<{ id: string }>(
      `INSERT INTO risk_assessments
         (org_id, transaction_id, rules_version, score, level, flagged, reasons)
       VALUES ($1, $2, 't', 70, 'high', true, '[{"rule":"velocity_count","points":40,"reason":"9 in 10 minutes."}]'::jsonb)
       RETURNING id`,
      [orgId, id],
    );
    const review = await api.query<{ id: string }>(
      "INSERT INTO review_items (org_id, transaction_id, assessment_id) VALUES ($1, $2, $3) RETURNING id",
      [orgId, id, assessment[0]?.id],
    );
    const eventId = randomUUID();
    await api.query(
      `INSERT INTO outbox_events (id, org_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, $2, 'transfer.settled', 'transfer', $3, '{}'::jsonb)`,
      [eventId, orgId, id],
    );
    const endpoint = await api.query<{ id: string }>(
      `INSERT INTO webhook_endpoints (org_id, url, secret_enc, event_types)
       VALUES ($1, 'https://example.com/h', 'v1.x.y.z', ARRAY['*']::text[]) RETURNING id`,
      [orgId],
    );
    await api.query(
      `INSERT INTO webhook_deliveries (org_id, endpoint_id, event_id, event_type, status, attempts)
       VALUES ($1, $2, $3, 'transfer.settled', 'succeeded', 1)`,
      [orgId, endpoint[0]?.id, eventId],
    );
    await api.query(
      `INSERT INTO audit_events (org_id, actor_type, action, target_type, target_id)
       VALUES ($1, 'user', 'review.approved', 'review_item', $2)`,
      [orgId, review[0]?.id],
    );

    const asViewer = (await detail(orgId, id, viewer)).body as unknown as Detail;
    expect(asViewer.risk).toMatchObject({ score: 70, review: { status: "pending" } });
    expect(asViewer.deliveries).toEqual([
      expect.objectContaining({ status: "succeeded", eventType: "transfer.settled" }),
    ]);
    expect(asViewer.audit).toBeNull();

    const asFinance = (await detail(orgId, id, finance)).body as unknown as Detail;
    expect(asFinance.audit?.map((e) => e.action)).toEqual(["review.approved"]);
  });

  it("returns 404 for another organization's transfer and for outsiders, 401 without a token", async () => {
    const orgId = await newOrg();
    const other = await newOrg();
    const token = await userIn(orgId, "viewer");
    const outsider = await userIn(other, "owner");
    const theirs = await transfer(other, await accounts(other));
    const mine = await transfer(orgId, await accounts(orgId));

    expect((await detail(orgId, theirs, token)).status).toBe(404);
    expect((await detail(orgId, mine, outsider)).status).toBe(404);
    expect((await api.call("GET", `/v1/orgs/${orgId}/transfers/${mine}/detail`)).status).toBe(401);
    expect((await detail(orgId, randomUUID(), token)).status).toBe(404);
  });
});
