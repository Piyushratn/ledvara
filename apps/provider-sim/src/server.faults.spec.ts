import { describe, expect, it } from "vitest";
import type { SimConfig } from "./config.js";
import { buildServer } from "./server.js";
import { ProviderSim } from "./simulator.js";

const KEY = "test-provider-key";
const headers = { "x-provider-key": KEY };

interface ReportBody {
  data: { reference: string; amountMinor: string; status: string }[];
}

async function setup() {
  const sim = new ProviderSim({
    config: { latencyMs: 0, failureRate: 0, outOfOrderRate: 0, duplicateRate: 0 } as SimConfig,
    rng: () => 0.5, // never below a zero rate, so every payout settles in order
    send: () => Promise.resolve(),
    schedule: () => undefined,
  });
  for (const reference of ["ref-a", "ref-b", "ref-c"]) {
    const { record } = sim.create({ reference, amountMinor: 1000n, destinationLabel: "bank" });
    await sim.complete(record.id);
  }
  return buildServer(sim, KEY);
}

async function fetchReport(app: Awaited<ReturnType<typeof setup>>): Promise<ReportBody["data"]> {
  const res = await app.inject({ method: "GET", url: "/settlement-report", headers });
  return (JSON.parse(res.body) as ReportBody).data;
}

describe("settlement report faults", () => {
  it("reports every finished payout when no faults are set", async () => {
    const report = await fetchReport(await setup());
    expect(report.map((r) => r.reference).sort()).toEqual(["ref-a", "ref-b", "ref-c"]);
  });

  it("applies drop, amount, status and invented-entry faults", async () => {
    const app = await setup();
    const put = await app.inject({
      method: "PUT",
      url: "/admin/report-faults",
      headers,
      payload: {
        drop: ["ref-a"],
        amountOverrides: { "ref-b": "999" },
        statusOverrides: { "ref-c": "failed" },
        extra: [
          { providerRef: "prov_ghost", reference: "ghost", amountMinor: "5", status: "settled" },
        ],
      },
    });
    expect(put.statusCode).toBe(200);

    const report = await fetchReport(app);
    const byRef = new Map(report.map((r) => [r.reference, r]));
    expect(byRef.has("ref-a")).toBe(false);
    expect(byRef.get("ref-b")?.amountMinor).toBe("999");
    expect(byRef.get("ref-c")?.status).toBe("failed");
    expect(byRef.get("ghost")?.amountMinor).toBe("5");
  });

  it("clears all faults when an empty body is sent", async () => {
    const app = await setup();
    await app.inject({
      method: "PUT",
      url: "/admin/report-faults",
      headers,
      payload: { drop: ["ref-a"] },
    });
    await app.inject({ method: "PUT", url: "/admin/report-faults", headers, payload: {} });
    expect(await fetchReport(app)).toHaveLength(3);
  });

  it("requires the provider key and rejects malformed faults", async () => {
    const app = await setup();
    const noKey = await app.inject({ method: "PUT", url: "/admin/report-faults", payload: {} });
    expect(noKey.statusCode).toBe(401);
    const bad = await app.inject({
      method: "PUT",
      url: "/admin/report-faults",
      headers,
      payload: { amountOverrides: { "ref-a": "12.5" } },
    });
    expect(bad.statusCode).toBe(422);
  });
});
