import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type SimConfig } from "./config.js";
import { mulberry32 } from "./rng.js";
import { signPayload, verifySignature } from "./signature.js";
import { ProviderSim, SimError, type ProviderEvent } from "./simulator.js";

const QUIET: SimConfig = {
  ...DEFAULT_CONFIG,
  latencyMs: 0,
  failureRate: 0,
  duplicateRate: 0,
  outOfOrderRate: 0,
};

function make(config: Partial<SimConfig> = {}, seed = 1) {
  const events: ProviderEvent[] = [];
  const sim = new ProviderSim({
    config: { ...QUIET, ...config },
    rng: mulberry32(seed),
    send: (event) => {
      events.push(event);
      return Promise.resolve();
    },
    schedule: () => undefined,
  });
  return { sim, events };
}

const input = { reference: "ref-1", amountMinor: 500n, destinationLabel: "HDFC ****1234" };

describe("ProviderSim", () => {
  it("is idempotent on reference and rejects a different amount", () => {
    const { sim } = make();
    const a = sim.create(input);
    const b = sim.create(input);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.record.id).toBe(a.record.id);
    expect(() => sim.create({ ...input, amountMinor: 501n })).toThrowError(SimError);
  });

  it("delivers processing then settled in order", async () => {
    const { sim, events } = make();
    const { record } = sim.create(input);
    await sim.complete(record.id);
    expect(events.map((e) => e.type)).toEqual(["payout.processing", "payout.settled"]);
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
    expect(sim.get(record.id)?.status).toBe("settled");
  });

  it("fails every payout when failureRate is 1", async () => {
    const { sim, events } = make({ failureRate: 1 });
    const { record } = sim.create(input);
    await sim.complete(record.id);
    expect(events.at(-1)?.type).toBe("payout.failed");
    expect(sim.get(record.id)?.status).toBe("failed");
  });

  it("delivers the final event twice with the same id when duplicateRate is 1", async () => {
    const { sim, events } = make({ duplicateRate: 1 });
    const { record } = sim.create(input);
    await sim.complete(record.id);
    const finals = events.filter((e) => e.sequence === 2);
    expect(finals).toHaveLength(2);
    expect(finals[0]?.eventId).toBe(finals[1]?.eventId);
  });

  it("delivers the final event first when outOfOrderRate is 1", async () => {
    const { sim, events } = make({ outOfOrderRate: 1 });
    const { record } = sim.create(input);
    await sim.complete(record.id);
    expect(events[0]?.sequence).toBe(2);
    expect(events[1]?.sequence).toBe(1);
  });

  it("completes a payout only once", async () => {
    const { sim, events } = make();
    const { record } = sim.create(input);
    await sim.complete(record.id);
    const count = events.length;
    expect(await sim.complete(record.id)).toEqual([]);
    expect(events).toHaveLength(count);
  });

  it("keeps the final status even when delivery fails", async () => {
    const errors: unknown[] = [];
    const sim = new ProviderSim({
      config: QUIET,
      rng: mulberry32(1),
      send: () => Promise.reject(new Error("receiver down")),
      schedule: () => undefined,
      onError: (error) => errors.push(error),
    });
    const { record } = sim.create(input);
    await sim.complete(record.id);
    expect(errors).toHaveLength(2);
    expect(sim.get(record.id)?.status).toBe("settled");
  });

  it("reports only finished payouts in the settlement report", async () => {
    const { sim } = make();
    const done = sim.create(input).record;
    sim.create({ ...input, reference: "ref-2" });
    await sim.complete(done.id);
    const report = sim.settlementReport();
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      providerRef: done.id,
      amountMinor: "500",
      status: "settled",
    });
  });

  it("gives the same outcomes for the same seed", async () => {
    async function run(seed: number): Promise<string[]> {
      const { sim } = make({ failureRate: 0.5 }, seed);
      const out: string[] = [];
      for (let i = 0; i < 30; i += 1) {
        const { record } = sim.create({ ...input, reference: `r${i}` });
        await sim.complete(record.id);
        out.push(sim.get(record.id)?.status ?? "");
      }
      return out;
    }
    expect(await run(42)).toEqual(await run(42));
    expect(new Set(await run(42)).size).toBe(2); // both outcomes occur
  });
});

describe("callback signatures", () => {
  const body = '{"a":1}';
  const now = 1_700_000_000;

  it("accepts a correct signature", () => {
    expect(verifySignature("s3cret", body, signPayload("s3cret", body, now), now)).toBe(true);
  });

  it("rejects a wrong secret, a changed body and an old timestamp", () => {
    const header = signPayload("s3cret", body, now);
    expect(verifySignature("other", body, header, now)).toBe(false);
    expect(verifySignature("s3cret", '{"a":2}', header, now)).toBe(false);
    expect(verifySignature("s3cret", body, header, now + 301)).toBe(false);
  });

  it("rejects malformed headers", () => {
    expect(verifySignature("s3cret", body, "garbage", now)).toBe(false);
    expect(verifySignature("s3cret", body, "t=abc,v1=00", now)).toBe(false);
  });
});
