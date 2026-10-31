import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config.js";
import { mulberry32 } from "./rng.js";
import { buildServer } from "./server.js";
import { ProviderSim } from "./simulator.js";

function app() {
  const sim = new ProviderSim({
    config: { ...DEFAULT_CONFIG, latencyMs: 0 },
    rng: mulberry32(7),
    send: () => Promise.resolve(),
    schedule: () => undefined,
  });
  return buildServer(sim, "test-key");
}

const headers = { "x-provider-key": "test-key" };
const payload = { reference: "ref-1", amountMinor: 500, destinationLabel: "HDFC ****1234" };

describe("provider simulator HTTP", () => {
  it("serves healthz without a key but guards everything else", async () => {
    const server = app();
    expect((await server.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: "/settlement-report" })).statusCode).toBe(
      401,
    );
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/settlement-report",
          headers: { "x-provider-key": "wrong" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("accepts a payout with 202 and returns the same one for the same reference", async () => {
    const server = app();
    const first = await server.inject({ method: "POST", url: "/payouts", headers, payload });
    expect(first.statusCode).toBe(202);
    const second = await server.inject({ method: "POST", url: "/payouts", headers, payload });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
  });

  it("reads a payout back and returns 404 for unknown ids", async () => {
    const server = app();
    const made = await server.inject({ method: "POST", url: "/payouts", headers, payload });
    const id = made.json<{ id: string }>().id;
    const got = await server.inject({ method: "GET", url: `/payouts/${id}`, headers });
    expect(got.json<{ status: string }>().status).toBe("processing");
    expect((await server.inject({ method: "GET", url: "/payouts/nope", headers })).statusCode).toBe(
      404,
    );
  });

  it("rejects bad payout bodies and a reused reference with another amount", async () => {
    const server = app();
    const bad = await server.inject({
      method: "POST",
      url: "/payouts",
      headers,
      payload: { ...payload, amountMinor: 1.5 },
    });
    expect(bad.statusCode).toBe(422);
    await server.inject({ method: "POST", url: "/payouts", headers, payload });
    const reuse = await server.inject({
      method: "POST",
      url: "/payouts",
      headers,
      payload: { ...payload, amountMinor: 999 },
    });
    expect(reuse.statusCode).toBe(422);
    expect(reuse.json<{ error: { code: string } }>().error.code).toBe("reference_reused");
  });

  it("updates the config and rejects unknown or out-of-range values", async () => {
    const server = app();
    const ok = await server.inject({
      method: "PUT",
      url: "/admin/config",
      headers,
      payload: { failureRate: 0.5 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ failureRate: number }>().failureRate).toBe(0.5);
    expect(
      (
        await server.inject({
          method: "PUT",
          url: "/admin/config",
          headers,
          payload: { failureRate: 2 },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await server.inject({
          method: "PUT",
          url: "/admin/config",
          headers,
          payload: { surprise: true },
        })
      ).statusCode,
    ).toBe(422);
  });
});
