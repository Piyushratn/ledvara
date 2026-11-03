import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";
import { DELIVERY_QUEUE_NAME } from "./webhook-queue.service.js";

let ctx: TestApp;
let api: Api;
let probeConnection: Redis;
let probe: Queue;
let counter = 0;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
  probeConnection = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
  probe = new Queue(DELIVERY_QUEUE_NAME, { connection: probeConnection });
});

afterAll(async () => {
  await probe.close();
  probeConnection.disconnect();
  await ctx.stop();
});

beforeEach(async () => {
  await ctx.reset();
});

async function newOrg(): Promise<string> {
  counter += 1;
  const rows = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
    [`Org ${counter}`, `dispatch-${counter}-${Date.now()}`],
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

async function endpointIn(orgId: string, token: string): Promise<string> {
  const res = await api.call("POST", `/v1/orgs/${orgId}/webhook-endpoints`, {
    token,
    body: { url: "https://hooks.example.com/ledvara" },
  });
  return res.body.id as string;
}

async function queuedJobs(): Promise<{ name: string; data: Record<string, unknown> }[]> {
  const jobs = await probe.getJobs(["waiting", "delayed", "active", "prioritized"]);
  return jobs.map((job) => ({ name: job.name, data: job.data as Record<string, unknown> }));
}

describe("test ping", () => {
  it("queues one webhook.test job for exactly that endpoint", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner", "owner@example.com");
    const first = await endpointIn(orgId, token);
    await endpointIn(orgId, token);

    const res = await api.call("POST", `/v1/orgs/${orgId}/webhook-endpoints/${first}/test`, {
      token,
    });
    expect(res.status).toBe(202);

    const jobs = await queuedJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe("webhook.test");
    expect(jobs[0]?.data).toMatchObject({ endpointId: first, orgId, eventType: "webhook.test" });
  });

  it("enforces roles and hides other organizations", async () => {
    const orgId = await newOrg();
    const owner = await userIn(orgId, "owner", "owner@example.com");
    const viewer = await userIn(orgId, "viewer", "viewer@example.com");
    const endpointId = await endpointIn(orgId, owner);
    await api.signUpVerified("outsider@example.com");
    const outsider = (await api.session("outsider@example.com")).accessToken;

    const path = `/v1/orgs/${orgId}/webhook-endpoints/${endpointId}/test`;
    expect((await api.call("POST", path, { token: viewer })).status).toBe(403);
    expect((await api.call("POST", path, { token: outsider })).status).toBe(404);

    const otherOrg = await newOrg();
    await api.query(
      "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, 'owner' FROM users WHERE email = $2",
      [otherOrg, "owner@example.com"],
    );
    const cross = await api.call(
      "POST",
      `/v1/orgs/${otherOrg}/webhook-endpoints/${endpointId}/test`,
      {
        token: owner,
      },
    );
    expect(cross.status).toBe(404);
    expect(await queuedJobs()).toHaveLength(0);
  });

  it("refuses a disabled endpoint", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner", "owner@example.com");
    const endpointId = await endpointIn(orgId, token);
    await api.query("UPDATE webhook_endpoints SET enabled = false WHERE id = $1", [endpointId]);
    const res = await api.call("POST", `/v1/orgs/${orgId}/webhook-endpoints/${endpointId}/test`, {
      token,
    });
    expect(res.status).toBe(409);
  });
});

describe("resend", () => {
  async function seedDelivery(
    orgId: string,
    endpointId: string,
    withEvent: boolean,
  ): Promise<string> {
    const eventId = "55555555-5555-4555-8555-555555555555";
    if (withEvent) {
      await api.query(
        `INSERT INTO outbox_events (id, org_id, type, aggregate_type, aggregate_id, payload)
         VALUES ($1, $2, 'payout.paid', 'payout', $3, '{"amountMinor":"500"}'::jsonb)`,
        [eventId, orgId, "66666666-6666-4666-8666-666666666666"],
      );
    }
    const rows = await api.query<{ id: string }>(
      `INSERT INTO webhook_deliveries (org_id, endpoint_id, event_id, event_type, status, attempts)
       VALUES ($1, $2, $3, 'payout.paid', 'failed', 8) RETURNING id`,
      [orgId, endpointId, eventId],
    );
    return rows[0]?.id ?? "";
  }

  it("re-queues the original event and sets the delivery back to pending", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner", "owner@example.com");
    const endpointId = await endpointIn(orgId, token);
    const deliveryId = await seedDelivery(orgId, endpointId, true);

    const res = await api.call(
      "POST",
      `/v1/orgs/${orgId}/webhook-deliveries/${deliveryId}/resend`,
      {
        token,
      },
    );
    expect(res.status).toBe(202);

    const jobs = await queuedJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({
      endpointId,
      eventType: "payout.paid",
      payload: { amountMinor: "500" },
    });
    const rows = await api.query<{ status: string }>(
      "SELECT status FROM webhook_deliveries WHERE id = $1",
      [deliveryId],
    );
    expect(rows[0]?.status).toBe("pending");
  });

  it("returns 409 for an event that is not in the outbox, and 404 for another organization", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner", "owner@example.com");
    const endpointId = await endpointIn(orgId, token);
    const deliveryId = await seedDelivery(orgId, endpointId, false);

    const path = `/v1/orgs/${orgId}/webhook-deliveries/${deliveryId}/resend`;
    expect((await api.call("POST", path, { token })).status).toBe(409);

    const otherOrg = await newOrg();
    await api.query(
      "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, 'owner' FROM users WHERE email = $2",
      [otherOrg, "owner@example.com"],
    );
    const cross = await api.call(
      "POST",
      `/v1/orgs/${otherOrg}/webhook-deliveries/${deliveryId}/resend`,
      { token },
    );
    expect(cross.status).toBe(404);
    expect(await queuedJobs()).toHaveLength(0);
  });
});
