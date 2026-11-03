import { describe, expect, it } from "vitest";
import type { OutboxRow } from "../relay.js";
import { fanOut, type DeliveryQueue } from "./fanout.js";

const event: OutboxRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  org_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  type: "payout.paid",
  aggregate_type: "payout",
  aggregate_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  payload: { amountMinor: "500" },
  created_at: "2026-11-01T10:00:00Z",
};

function fakeQueue(): {
  queue: DeliveryQueue;
  jobs: { data: unknown; options: Record<string, unknown> }[];
} {
  const jobs: { data: unknown; options: Record<string, unknown> }[] = [];
  return {
    jobs,
    queue: {
      add(_name, data, options) {
        jobs.push({ data, options });
        return Promise.resolve();
      },
    },
  };
}

describe("fanOut", () => {
  it("creates one job per matching endpoint with a deterministic id", async () => {
    const { queue, jobs } = fakeQueue();
    const store = { findEndpointIds: () => Promise.resolve(["ep1", "ep2"]) };
    expect(await fanOut(event, store, queue)).toBe(2);
    expect(jobs.map((j) => j.options.jobId)).toEqual([`${event.id}_ep1`, `${event.id}_ep2`]);
    expect(jobs[0]?.options.attempts).toBe(8);
    expect(String(jobs[0]?.options.jobId)).not.toContain(":");
  });

  it("creates nothing when no endpoint listens", async () => {
    const { queue, jobs } = fakeQueue();
    expect(await fanOut(event, { findEndpointIds: () => Promise.resolve([]) }, queue)).toBe(0);
    expect(jobs).toHaveLength(0);
  });
});
