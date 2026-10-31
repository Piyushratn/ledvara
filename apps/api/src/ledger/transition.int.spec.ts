import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Api } from "../test-support/helpers.js";
import { startTestApp, type TestApp } from "../test-support/test-app.js";

let ctx: TestApp;
let api: Api;
let orgId: string;
let txnId: string;
let svc: import("./transition.service.js").TransitionService;

beforeAll(async () => {
  ctx = await startTestApp();
  api = new Api(ctx.app, ctx.pool);
  const { TransitionService } = await import("./transition.service.js");
  svc = ctx.app.get(TransitionService);
});

afterAll(async () => {
  await ctx.stop();
});

beforeEach(async () => {
  await ctx.reset();
  const org = await api.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', 'acme') RETURNING id",
  );
  orgId = org[0]?.id ?? "";
  const txn = await api.query<{ id: string }>(
    "INSERT INTO transactions (org_id, kind) VALUES ($1, 'transfer') RETURNING id",
    [orgId],
  );
  txnId = txn[0]?.id ?? "";
});

async function status(): Promise<string> {
  const rows = await api.query<{ status: string }>(
    "SELECT status FROM transactions WHERE id = $1",
    [txnId],
  );
  return rows[0]?.status ?? "";
}

describe("transfer state machine", () => {
  it("walks created -> pending -> settled -> reversed", async () => {
    expect(await svc.transition(orgId, txnId, "pending")).toBe("pending");
    expect(await svc.transition(orgId, txnId, "settled")).toBe("settled");
    expect(await svc.transition(orgId, txnId, "reversed")).toBe("reversed");
  });

  it("rejects invalid moves in code and leaves the status alone", async () => {
    await svc.transition(orgId, txnId, "failed");
    await expect(svc.transition(orgId, txnId, "settled")).rejects.toMatchObject({
      code: "invalid_transition",
    });
    expect(await status()).toBe("failed");
  });

  it("rejects invalid moves even with raw SQL", async () => {
    await expect(
      api.query("UPDATE transactions SET status = 'reversed' WHERE id = $1", [txnId]),
    ).rejects.toThrow(/invalid transaction status transition/u);
    await api.query("UPDATE transactions SET status = 'failed' WHERE id = $1", [txnId]);
    await expect(
      api.query("UPDATE transactions SET status = 'settled' WHERE id = $1", [txnId]),
    ).rejects.toThrow(/invalid transaction status transition/u);
  });

  it("lets only one of two racing requests win", async () => {
    const results = await Promise.allSettled([
      svc.transition(orgId, txnId, "settled"),
      svc.transition(orgId, txnId, "failed"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(["settled", "failed"]).toContain(await status());
  });

  it("returns 404 for another organization's transaction", async () => {
    const other = await api.query<{ id: string }>(
      "INSERT INTO organizations (name, slug) VALUES ('Other', 'other') RETURNING id",
    );
    await expect(svc.transition(other[0]?.id ?? "", txnId, "pending")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
