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
    "INSERT INTO organizations (name, slug) VALUES ('Review', $1) RETURNING id",
    [`review-${randomUUID()}`],
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

/** A flagged transfer's assessment and its pending review item, created directly. */
async function seedReview(orgId: string): Promise<{ reviewId: string; transactionId: string }> {
  const txn = await api.query<{ id: string }>(
    "INSERT INTO transactions (org_id, kind) VALUES ($1, 'transfer') RETURNING id",
    [orgId],
  );
  const transactionId = txn[0]?.id ?? "";
  const reasons = [{ rule: "velocity_count", points: 40, reason: "9 transfers in 10 minutes." }];
  const inputs = { amountMinor: "1050000", fromAccountId: randomUUID() };
  const assessment = await api.query<{ id: string }>(
    `INSERT INTO risk_assessments
       (org_id, transaction_id, rules_version, score, level, flagged, reasons, inputs)
     VALUES ($1, $2, 'test', 70, 'high', true, $3::jsonb, $4::jsonb) RETURNING id`,
    [orgId, transactionId, JSON.stringify(reasons), JSON.stringify(inputs)],
  );
  const review = await api.query<{ id: string }>(
    "INSERT INTO review_items (org_id, transaction_id, assessment_id) VALUES ($1, $2, $3) RETURNING id",
    [orgId, transactionId, assessment[0]?.id],
  );
  return { reviewId: review[0]?.id ?? "", transactionId };
}

describe("review queue", () => {
  it("lists pending items with their reasons, to any member of the organization only", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const viewer = await userIn(orgA, "viewer");
    const outsider = await userIn(orgB, "owner");
    const { reviewId } = await seedReview(orgA);
    await seedReview(orgB);

    const res = await api.call("GET", `/v1/orgs/${orgA}/review-items?status=pending`, {
      token: viewer,
    });
    expect(res.status).toBe(200);
    const data = res.body.data as {
      id: string;
      score: number;
      amountMinor: string;
      reasons: { rule: string }[];
    }[];
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: reviewId, score: 70, amountMinor: "1050000" });
    expect(data[0]?.reasons[0]?.rule).toBe("velocity_count");

    expect(
      (await api.call("GET", `/v1/orgs/${orgA}/review-items`, { token: outsider })).status,
    ).toBe(404);
    expect(
      (await api.call("GET", `/v1/orgs/${orgB}/review-items/${reviewId}`, { token: outsider }))
        .status,
    ).toBe(404);
  });

  it("approves once, records who and why, audits it, queues a webhook event and leaves the money alone", async () => {
    const orgId = await newOrg();
    const finance = await userIn(orgId, "finance");
    const { reviewId, transactionId } = await seedReview(orgId);
    const before = await api.query<{ status: string }>(
      "SELECT status FROM transactions WHERE id = $1",
      [transactionId],
    );

    const res = await api.call("POST", `/v1/orgs/${orgId}/review-items/${reviewId}/approve`, {
      token: finance,
      body: { note: "Customer confirmed by phone." },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "approved",
      reviewerNote: "Customer confirmed by phone.",
    });
    expect(res.body.reviewerId).not.toBeNull();
    expect(res.body.decidedAt).not.toBeNull();

    const after = await api.query<{ status: string }>(
      "SELECT status FROM transactions WHERE id = $1",
      [transactionId],
    );
    expect(after[0]?.status).toBe(before[0]?.status);

    const audit = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'review.approved'",
      [orgId],
    );
    expect(audit[0]?.n).toBe(1);

    const events = await api.query<{ payload: { decision: string } }>(
      "SELECT payload FROM outbox_events WHERE org_id = $1 AND type = 'risk.review_decided'",
      [orgId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.decision).toBe("approved");
  });

  it("requires a note to reject, refuses a second decision, and keeps viewers out", async () => {
    const orgId = await newOrg();
    const owner = await userIn(orgId, "owner");
    const viewer = await userIn(orgId, "viewer");
    const { reviewId } = await seedReview(orgId);
    const base = `/v1/orgs/${orgId}/review-items/${reviewId}`;

    expect((await api.call("POST", `${base}/reject`, { token: owner, body: {} })).status).toBe(422);
    expect((await api.call("POST", `${base}/approve`, { token: viewer, body: {} })).status).toBe(
      403,
    );

    const rejected = await api.call("POST", `${base}/reject`, {
      token: owner,
      body: { note: "Looks fraudulent." },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");

    const again = await api.call("POST", `${base}/approve`, { token: owner, body: {} });
    expect(again.status).toBe(409);
    const stored = await api.query<{ status: string }>(
      "SELECT status FROM review_items WHERE id = $1",
      [reviewId],
    );
    expect(stored[0]?.status).toBe("rejected");

    const unknown = await api.call(
      "POST",
      `/v1/orgs/${orgId}/review-items/${randomUUID()}/approve`,
      { token: owner, body: {} },
    );
    expect(unknown.status).toBe(404);
  });

  it("lets only one of two simultaneous decisions win", async () => {
    const orgId = await newOrg();
    const owner = await userIn(orgId, "owner");
    const { reviewId } = await seedReview(orgId);
    const base = `/v1/orgs/${orgId}/review-items/${reviewId}`;

    const results = await Promise.all([
      api.call("POST", `${base}/approve`, { token: owner, body: {} }),
      api.call("POST", `${base}/reject`, { token: owner, body: { note: "no" } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const events = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM outbox_events WHERE org_id = $1 AND type = 'risk.review_decided'",
      [orgId],
    );
    expect(events[0]?.n).toBe(1);
  });
});
