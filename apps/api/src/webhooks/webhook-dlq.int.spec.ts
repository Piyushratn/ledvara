import { randomUUID } from "node:crypto";
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
  const rows = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('DLQ', $1) RETURNING id",
    [`dlq-${randomUUID()}`],
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

async function endpointIn(orgId: string, token: string): Promise<string> {
  const res = await api.call("POST", `/v1/orgs/${orgId}/webhook-endpoints`, {
    token,
    body: { url: "https://hooks.example.com/ledvara" },
  });
  return res.body.id as string;
}

async function seedDelivery(
  orgId: string,
  endpointId: string,
  status: "pending" | "succeeded" | "failed",
  withEvent: boolean,
): Promise<string> {
  const eventId = randomUUID();
  if (withEvent) {
    await api.query(
      `INSERT INTO outbox_events (id, org_id, type, aggregate_type, aggregate_id, payload)
       VALUES ($1, $2, 'payout.paid', 'payout', $3, '{"amountMinor":"500"}'::jsonb)`,
      [eventId, orgId, randomUUID()],
    );
  }
  const rows = await api.query<{ id: string }>(
    `INSERT INTO webhook_deliveries (org_id, endpoint_id, event_id, event_type, status, attempts)
     VALUES ($1, $2, $3, 'payout.paid', $4, 8) RETURNING id`,
    [orgId, endpointId, eventId, status],
  );
  return rows[0]?.id ?? "";
}

async function statusOf(deliveryId: string): Promise<string | undefined> {
  const rows = await api.query<{ status: string }>(
    "SELECT status FROM webhook_deliveries WHERE id = $1",
    [deliveryId],
  );
  return rows[0]?.status;
}

async function queuedJobs(): Promise<{ endpointId: string }[]> {
  const jobs = await probe.getJobs(["waiting", "delayed", "active", "prioritized"]);
  return jobs.map((job) => ({ endpointId: (job.data as { endpointId: string }).endpointId }));
}

describe("dead-letter list", () => {
  it("filters deliveries by status and endpoint, and rejects a bad status", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner");
    const a = await endpointIn(orgId, token);
    const b = await endpointIn(orgId, token);
    await seedDelivery(orgId, a, "failed", true);
    await seedDelivery(orgId, a, "succeeded", true);
    await seedDelivery(orgId, b, "failed", true);

    const base = `/v1/orgs/${orgId}/webhook-deliveries`;
    const failed = await api.call("GET", `${base}?status=failed`, { token });
    expect((failed.body.data as unknown[]).length).toBe(2);

    const onlyA = await api.call("GET", `${base}?status=failed&endpointId=${a}`, { token });
    expect((onlyA.body.data as unknown[]).length).toBe(1);

    expect((await api.call("GET", `${base}`, { token })).body.data).toHaveLength(3);
    expect((await api.call("GET", `${base}?status=dead`, { token })).status).toBe(422);
  });
});

describe("replay-failed", () => {
  it("re-queues only what can be rebuilt, and a second call finds nothing left", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner");
    const a = await endpointIn(orgId, token);
    const disabled = await endpointIn(orgId, token);
    await api.query("UPDATE webhook_endpoints SET enabled = false WHERE id = $1", [disabled]);

    const one = await seedDelivery(orgId, a, "failed", true);
    const two = await seedDelivery(orgId, a, "failed", true);
    const testPing = await seedDelivery(orgId, a, "failed", false); // no outbox event
    const behindDisabled = await seedDelivery(orgId, disabled, "failed", true);
    const alreadyFine = await seedDelivery(orgId, a, "succeeded", true);

    const path = `/v1/orgs/${orgId}/webhook-deliveries/replay-failed`;
    const first = await api.call("POST", path, { token });
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ queued: 2, skipped: 0 });

    expect(await queuedJobs()).toHaveLength(2);
    expect(await statusOf(one)).toBe("pending");
    expect(await statusOf(two)).toBe("pending");
    expect(await statusOf(testPing)).toBe("failed");
    expect(await statusOf(behindDisabled)).toBe("failed");
    expect(await statusOf(alreadyFine)).toBe("succeeded");

    const second = await api.call("POST", path, { token });
    expect(second.body).toMatchObject({ queued: 0, skipped: 0 });
    expect(await queuedJobs()).toHaveLength(2);
  });

  it("can be limited to one endpoint", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner");
    const a = await endpointIn(orgId, token);
    const b = await endpointIn(orgId, token);
    await seedDelivery(orgId, a, "failed", true);
    await seedDelivery(orgId, b, "failed", true);

    const res = await api.call("POST", `/v1/orgs/${orgId}/webhook-deliveries/replay-failed`, {
      token,
      body: { endpointId: a },
    });
    expect(res.body).toMatchObject({ queued: 1 });
    const jobs = await queuedJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.endpointId).toBe(a);
  });

  it("is audited, keeps viewers out and never touches another organization", async () => {
    const orgA = await newOrg();
    const orgB = await newOrg();
    const owner = await userIn(orgA, "owner");
    const viewer = await userIn(orgA, "viewer");
    const outsider = await userIn(orgB, "owner");
    const a = await endpointIn(orgA, owner);
    const inB = await endpointIn(orgB, outsider);
    await seedDelivery(orgA, a, "failed", true);
    const bDelivery = await seedDelivery(orgB, inB, "failed", true);

    const path = `/v1/orgs/${orgA}/webhook-deliveries/replay-failed`;
    expect((await api.call("POST", path, { token: viewer })).status).toBe(403);
    expect((await api.call("POST", path, { token: outsider })).status).toBe(404);

    const res = await api.call("POST", path, { token: owner });
    expect(res.body).toMatchObject({ queued: 1 });
    expect(await statusOf(bDelivery)).toBe("failed");

    const audit = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'webhook_delivery.replay_failed'",
      [orgA],
    );
    expect(audit[0]?.n).toBe(1);
  });
});
