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
    "INSERT INTO organizations (name, slug) VALUES ('T', $1) RETURNING id",
    [`t-${randomUUID()}`],
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
  const make = async (code: string, type: string, negative: boolean): Promise<string> => {
    const rows = await api.query<{ id: string }>(
      "INSERT INTO accounts (org_id, code, name, type, allow_negative) VALUES ($1, $2, $2, $3, $4) RETURNING id",
      [orgId, code, type, negative],
    );
    return rows[0]?.id ?? "";
  };
  return { from: await make("platform", "asset", true), to: await make("wallet", "wallet", false) };
}

/** A settled transfer, `minutesAgo` minutes old. Balances are untouched: these routes only read. */
async function transfer(
  orgId: string,
  pair: { from: string; to: string },
  amount: number,
  reference: string | null,
  minutesAgo: number,
): Promise<string> {
  const txn = await api.query<{ id: string }>(
    `INSERT INTO transactions (org_id, kind, reference, created_at)
     VALUES ($1, 'transfer', $2, now() - ($3::int * interval '1 minute')) RETURNING id`,
    [orgId, reference, minutesAgo],
  );
  const id = txn[0]?.id ?? "";
  await api.query(
    `INSERT INTO ledger_entries (transaction_id, org_id, account_id, direction, amount_minor)
     VALUES ($1, $2, $3, 'debit', $5), ($1, $2, $4, 'credit', $5)`,
    [id, orgId, pair.from, pair.to, amount],
  );
  await api.query("UPDATE transactions SET status = 'settled' WHERE id = $1", [id]);
  return id;
}

async function csv(orgId: string, token: string, query = "") {
  const res = await ctx.app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: "GET",
      url: `/v1/orgs/${orgId}/transfers.csv${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  return { status: res.statusCode, text: res.body, headers: res.headers };
}

interface Listed {
  data: { id: string; reference: string | null; amountMinor: string }[];
  nextCursor: string | null;
}

describe("GET /v1/orgs/:orgId/transfers", () => {
  it("lists newest first and pages with a cursor, with no repeats or gaps", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "viewer");
    const pair = await accounts(orgId);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await transfer(orgId, pair, 100 + i, `ref ${i}`, 50 - i));

    const base = `/v1/orgs/${orgId}/transfers`;
    const first = (await api.call("GET", `${base}?limit=2`, { token })).body as unknown as Listed;
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = (await api.call("GET", `${base}?limit=2&cursor=${first.nextCursor}`, { token }))
      .body as unknown as Listed;
    const third = (await api.call("GET", `${base}?limit=2&cursor=${second.nextCursor}`, { token }))
      .body as unknown as Listed;

    const seen = [...first.data, ...second.data, ...third.data].map((row) => row.id);
    expect(seen).toEqual([...ids].reverse());
    expect(third.nextCursor).toBeNull();
  });

  it("searches references case-insensitively, and treats % and _ literally", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "viewer");
    const pair = await accounts(orgId);
    await transfer(orgId, pair, 100, "Invoice 100% paid", 3);
    await transfer(orgId, pair, 200, "Invoice 1000 paid", 2);
    await transfer(orgId, pair, 300, "rent_march", 1);

    const search = async (term: string): Promise<string[]> => {
      const res = await api.call(
        "GET",
        `/v1/orgs/${orgId}/transfers?search=${encodeURIComponent(term)}`,
        {
          token,
        },
      );
      return (res.body as unknown as Listed).data.map((row) => row.reference ?? "");
    };

    expect(await search("INVOICE")).toHaveLength(2);
    expect(await search("100%")).toEqual(["Invoice 100% paid"]);
    expect(await search("t_m")).toEqual(["rent_march"]);
    expect(await search("%")).toEqual(["Invoice 100% paid"]);
  });

  it("filters by amount range and never shows another organization's transfers", async () => {
    const orgId = await newOrg();
    const other = await newOrg();
    const token = await userIn(orgId, "viewer");
    const pair = await accounts(orgId);
    const otherPair = await accounts(other);
    await transfer(orgId, pair, 100, "mine small", 2);
    await transfer(orgId, pair, 900, "mine large", 1);
    await transfer(other, otherPair, 900, "theirs", 1);

    const res = await api.call("GET", `/v1/orgs/${orgId}/transfers?minAmount=500`, { token });
    const data = (res.body as unknown as Listed).data;
    expect(data.map((row) => row.reference)).toEqual(["mine large"]);
  });

  it("returns one transfer by id, 404 for another organization's, and hides the org from outsiders", async () => {
    const orgId = await newOrg();
    const other = await newOrg();
    const token = await userIn(orgId, "viewer");
    const outsider = await userIn(other, "owner");
    const pair = await accounts(orgId);
    const otherPair = await accounts(other);
    const mine = await transfer(orgId, pair, 100, "mine", 1);
    const theirs = await transfer(other, otherPair, 100, "theirs", 1);

    const ok = await api.call("GET", `/v1/orgs/${orgId}/transfers/${mine}`, { token });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: mine, amountMinor: "100", status: "settled" });
    expect((await api.call("GET", `/v1/orgs/${orgId}/transfers/${theirs}`, { token })).status).toBe(
      404,
    );
    expect((await api.call("GET", `/v1/orgs/${orgId}/transfers`, { token: outsider })).status).toBe(
      404,
    );
    expect((await api.call("GET", `/v1/orgs/${orgId}/transfers`)).status).toBe(401);
  });
});

describe("GET /v1/orgs/:orgId/transfers.csv", () => {
  it("exports matching rows with headers, rupee amounts and an audit event", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "finance");
    const pair = await accounts(orgId);
    await transfer(orgId, pair, 10000, "first", 2);
    await transfer(orgId, pair, 5, "second", 1);

    const res = await csv(orgId, token);
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/csv");
    expect(String(res.headers["content-disposition"])).toContain("attachment");
    expect(res.headers["x-export-truncated"]).toBe("false");

    const lines = res.text.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(",5,0.05,INR,second");
    expect(lines[2]).toContain(",10000,100.00,INR,first");

    const audit = await api.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_events WHERE org_id = $1 AND action = 'transfers.exported'",
      [orgId],
    );
    expect(audit[0]?.n).toBe(1);
  });

  it("defuses formulas in references, and applies the same filters", async () => {
    const orgId = await newOrg();
    const token = await userIn(orgId, "owner");
    const pair = await accounts(orgId);
    await transfer(orgId, pair, 100, '=HYPERLINK("http://evil")', 3);
    await transfer(orgId, pair, 100, "@SUM(A1)", 2);
    await transfer(orgId, pair, 100, "plain, with comma", 1);

    const all = await csv(orgId, token);
    expect(all.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(all.text).toContain("'@SUM(A1)");
    expect(all.text).toContain('"plain, with comma"');
    expect(all.text).not.toMatch(/,=HYPERLINK/u);

    const filtered = await csv(orgId, token, "?search=plain");
    expect(filtered.text.trim().split("\r\n")).toHaveLength(2);
  });

  it("keeps outsiders out", async () => {
    const orgId = await newOrg();
    const outsider = await userIn(await newOrg(), "owner");
    expect((await csv(orgId, outsider)).status).toBe(404);
  });
});
