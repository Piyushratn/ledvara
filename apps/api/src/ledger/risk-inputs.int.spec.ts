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

async function setup(): Promise<{
  orgId: string;
  keyId: string;
  key: string;
  platform: string;
  wallet: string;
}> {
  const email = `owner-${randomUUID()}@example.com`;
  await api.signUpVerified(email);
  const session = await api.session(email);
  const org = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Risk', $1) RETURNING id",
    [`risk-${randomUUID()}`],
  );
  const orgId = org[0]?.id ?? "";
  await api.query(
    "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, 'owner' FROM users WHERE email = $2",
    [orgId, email],
  );
  const created = await api.call("POST", `/v1/orgs/${orgId}/api-keys`, {
    token: session.accessToken,
    body: { name: "risk", scopes: ["ledger:write", "ledger:read"] },
  });
  expect(created.status).toBe(201);

  const account = async (code: string, type: string, allowNegative: boolean): Promise<string> => {
    const rows = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
      [orgId, code, type, allowNegative],
    );
    return rows[0]?.id ?? "";
  };
  return {
    orgId,
    keyId: created.body.id as string,
    key: created.body.key as string,
    platform: await account("platform_funds", "asset", true),
    wallet: await account("wallet_one", "wallet", false),
  };
}

async function postTransfer(
  key: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
): Promise<number> {
  const res = await ctx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: "POST",
      url: "/v1/transfers",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": idempotencyKey },
      payload: body,
    });
  return res.statusCode;
}

describe("risk inputs recorded by the API", () => {
  it("puts the API key id into the transfer.settled event", async () => {
    const s = await setup();
    const status = await postTransfer(s.key, randomUUID(), {
      fromAccountId: s.platform,
      toAccountId: s.wallet,
      amountMinor: 1000,
    });
    expect(status).toBe(201);

    const rows = await api.query<{ key: string | null }>(
      "SELECT payload->>'apiKeyId' AS key FROM outbox_events WHERE org_id = $1 AND type = 'transfer.settled'",
      [s.orgId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe(s.keyId);
  });

  it("logs a refused overdraft even though the transfer rolled back", async () => {
    const s = await setup();
    const status = await postTransfer(s.key, randomUUID(), {
      fromAccountId: s.wallet,
      toAccountId: s.platform,
      amountMinor: 500,
    });
    expect(status).toBe(409);

    const failures = await api.query<{ code: string; from_account_id: string; api_key_id: string }>(
      "SELECT code, from_account_id, api_key_id FROM transfer_failures WHERE org_id = $1",
      [s.orgId],
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      code: "insufficient_funds",
      from_account_id: s.wallet,
      api_key_id: s.keyId,
    });
    const moved = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM transactions WHERE org_id = $1",
      [s.orgId],
    );
    expect(moved[0]?.n).toBe(0);
  });

  it("does not log validation errors or successful transfers", async () => {
    const s = await setup();
    const bad = await postTransfer(s.key, randomUUID(), {
      fromAccountId: s.platform,
      toAccountId: s.platform,
      amountMinor: 100,
    });
    expect(bad).toBe(422);
    const ok = await postTransfer(s.key, randomUUID(), {
      fromAccountId: s.platform,
      toAccountId: s.wallet,
      amountMinor: 100,
    });
    expect(ok).toBe(201);

    const failures = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM transfer_failures WHERE org_id = $1",
      [s.orgId],
    );
    expect(failures[0]?.n).toBe(0);
  });
});
