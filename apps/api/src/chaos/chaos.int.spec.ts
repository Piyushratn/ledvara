import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiProcess, freePort } from "../test-support/api-process.js";
import { startInfra, type Infra } from "../test-support/infra.js";

const REQUESTS = 40;
const KILL_AFTER = 5;
const AMOUNT = 1000;
const PASSWORD = "correct-horse-battery";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let infra: Infra;
let api: ApiProcess;

beforeAll(async () => {
  infra = await startInfra();
  api = new ApiProcess(await freePort(), {
    NODE_ENV: "test",
    DATABASE_URL: infra.databaseUrl,
    REDIS_URL: infra.redisUrl,
    JWT_SECRET: "chaos-test-secret-chaos-test-secret-1234",
    TWO_FACTOR_ENCRYPTION_KEY: "ab".repeat(32),
    WEBHOOK_SECRET_KEY: "cd".repeat(32),
    APP_BASE_URL: "http://localhost:5173",
  });
});

afterAll(async () => {
  await api.kill();
  await infra.stop();
});

async function json(
  method: string,
  path: string,
  token: string | undefined,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${api.url}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}

interface Scenario {
  orgId: string;
  apiKey: string;
  platform: string;
  wallet: string;
}

async function setup(): Promise<Scenario> {
  const email = `chaos-${randomUUID()}@example.com`;
  const signup = await json("POST", "/v1/auth/signup", undefined, { email, password: PASSWORD });
  expect(signup.status).toBe(202);
  await infra.pool.query("UPDATE users SET email_verified_at = now() WHERE email = $1", [email]);
  const login = await json("POST", "/v1/auth/login", undefined, { email, password: PASSWORD });
  expect(login.status).toBe(200);
  const token = login.body.accessToken as string;

  const org = await infra.pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Chaos', $1) RETURNING id",
    [`chaos-${randomUUID()}`],
  );
  const orgId = org.rows[0]?.id ?? "";
  await infra.pool.query(
    "INSERT INTO memberships (org_id, user_id, role) SELECT $1, id, 'owner' FROM users WHERE email = $2",
    [orgId, email],
  );
  const key = await json("POST", `/v1/orgs/${orgId}/api-keys`, token, {
    name: "chaos",
    scopes: ["ledger:write", "ledger:read"],
  });
  expect(key.status).toBe(201);

  const account = async (code: string, type: string, allowNegative: boolean): Promise<string> => {
    const rows = await infra.pool.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
      [orgId, code, type, allowNegative],
    );
    return rows.rows[0]?.id ?? "";
  };
  return {
    orgId,
    apiKey: key.body.key as string,
    platform: await account("platform_funds", "asset", true),
    wallet: await account("wallet_chaos", "wallet", false),
  };
}

interface Sent {
  /** null means the connection was lost before a complete answer arrived. */
  status: number | null;
  replayed: boolean;
  retryAfterSeconds: number | null;
}

async function sendTransfer(s: Scenario, runKey: string, index: number): Promise<Sent> {
  try {
    const res = await fetch(`${api.url}/v1/transfers`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${s.apiKey}`,
        "idempotency-key": `${runKey}-${index}`,
      },
      body: JSON.stringify({
        fromAccountId: s.platform,
        toAccountId: s.wallet,
        amountMinor: AMOUNT,
        reference: `chaos-${index}`,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    await res.text();
    const retryAfter = Number(res.headers.get("retry-after"));
    return {
      status: res.status,
      replayed: res.headers.get("idempotent-replayed") === "true",
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    };
  } catch {
    return { status: null, replayed: false, retryAfterSeconds: null };
  }
}

/** Retries a request until it gets a definite answer, the way a real client would. */
async function sendUntilAnswered(s: Scenario, runKey: string, index: number): Promise<Sent> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const sent = await sendTransfer(s, runKey, index);
    const retryable =
      sent.status === null || sent.status === 429 || sent.status === 409 || sent.status === 503;
    if (!retryable) return sent;
    await sleep(Math.min(sent.retryAfterSeconds ?? 0.3, 5) * 1000);
  }
  throw new Error(`Request ${index} never got a definite answer`);
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const rows = await infra.pool.query<{ n: number }>(sql, params);
  return rows.rows[0]?.n ?? -1;
}

describe("chaos: killing the API mid-transfer", () => {
  it.each([1, 2, 3])(
    "round %i leaves the ledger consistent and moves each request's money exactly once",
    async (round) => {
      await api.start();
      const s = await setup();
      const runKey = `chaos-${round}-${randomUUID()}`;

      // Fire everything at once, and kill the process after a few answers arrive.
      let answered = 0;
      let killing: Promise<void> | undefined;
      const first = await Promise.all(
        Array.from({ length: REQUESTS }, async (_, index) => {
          const sent = await sendTransfer(s, runKey, index);
          if (sent.status !== null) {
            answered += 1;
            if (answered === KILL_AFTER) killing = api.kill();
          }
          return sent;
        }),
      );
      await killing;

      const acknowledged = first.flatMap((sent, index) => (sent.status === 201 ? [index] : []));
      const cutOff = first.filter((sent) => sent.status === null).length;
      expect(acknowledged.length, "some requests must be answered before the kill").toBeGreaterThan(
        0,
      );
      expect(cutOff, "the kill must interrupt at least one in-flight request").toBeGreaterThan(0);

      // Everything the client was told succeeded must really be in the database.
      const committedAtKill = await count(
        "SELECT count(*)::int AS n FROM transactions WHERE org_id = $1 AND kind = 'transfer'",
        [s.orgId],
      );
      expect(committedAtKill).toBeGreaterThanOrEqual(acknowledged.length);
      console.log(
        `chaos round ${round}: ${acknowledged.length} acknowledged, ${cutOff} cut off, ` +
          `${committedAtKill} committed at the moment of the kill`,
      );

      // Restart and retry every request with its original idempotency key.
      await api.start();
      const retried = await Promise.all(
        Array.from({ length: REQUESTS }, (_, index) => sendUntilAnswered(s, runKey, index)),
      );
      expect(retried.every((sent) => sent.status === 201)).toBe(true);
      for (const index of acknowledged) {
        expect(
          retried[index]?.replayed,
          `request ${index} was acknowledged, so it must replay`,
        ).toBe(true);
      }

      // Money moved exactly once per request.
      const p = [s.orgId];
      expect(
        await count(
          "SELECT count(*)::int AS n FROM transactions WHERE org_id = $1 AND kind = 'transfer'",
          p,
        ),
      ).toBe(REQUESTS);
      expect(
        await count("SELECT count(*)::int AS n FROM ledger_entries WHERE org_id = $1", p),
      ).toBe(REQUESTS * 2);
      const balances = await infra.pool.query<{ code: string; balance: string }>(
        "SELECT code, balance_minor::text AS balance FROM accounts WHERE org_id = $1",
        p,
      );
      const total = String(REQUESTS * AMOUNT);
      expect(Object.fromEntries(balances.rows.map((r) => [r.code, r.balance]))).toEqual({
        platform_funds: total,
        wallet_chaos: total,
      });

      // The ledger is internally consistent.
      expect(
        await count(
          `SELECT count(*)::int AS n FROM (
             SELECT transaction_id FROM ledger_entries WHERE org_id = $1
              GROUP BY transaction_id
             HAVING sum(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
           ) unbalanced`,
          p,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM transactions t
            WHERE t.org_id = $1
              AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.transaction_id = t.id)`,
          p,
        ),
      ).toBe(0);
      expect(
        await count(
          "SELECT count(*)::int AS n FROM transactions WHERE org_id = $1 AND status <> 'settled'",
          p,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM (
             SELECT a.id
               FROM accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
              WHERE a.org_id = $1
              GROUP BY a.id, a.type, a.balance_minor
             HAVING a.balance_minor <> COALESCE(sum(CASE
               WHEN a.type IN ('asset', 'expense') THEN
                 CASE e.direction WHEN 'debit' THEN e.amount_minor ELSE -e.amount_minor END
               ELSE
                 CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END
             END), 0)
           ) drift`,
          p,
        ),
      ).toBe(0);

      // Outbox and idempotency records match the ledger exactly.
      expect(
        await count(
          "SELECT count(*)::int AS n FROM outbox_events WHERE org_id = $1 AND type = 'transfer.settled'",
          p,
        ),
      ).toBe(REQUESTS);
      expect(
        await count(
          `SELECT count(DISTINCT aggregate_id)::int AS n FROM outbox_events
            WHERE org_id = $1 AND type = 'transfer.settled'`,
          p,
        ),
      ).toBe(REQUESTS);
      expect(
        await count(
          `SELECT count(*)::int AS n FROM outbox_events o
            WHERE o.org_id = $1 AND o.type = 'transfer.settled'
              AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = o.aggregate_id)`,
          p,
        ),
      ).toBe(0);
      expect(
        await count("SELECT count(*)::int AS n FROM idempotency_keys WHERE org_id = $1", p),
      ).toBe(REQUESTS);
      expect(
        await count(
          "SELECT count(*)::int AS n FROM idempotency_keys WHERE org_id = $1 AND response_status <> 201",
          p,
        ),
      ).toBe(0);
    },
    120_000,
  );
});
