import { randomUUID } from "node:crypto";
import type { SimConfig } from "./config.js";

export type PayoutStatus = "processing" | "settled" | "failed";

export interface ProviderEvent {
  eventId: string;
  payoutRef: string;
  reference: string;
  type: "payout.processing" | "payout.settled" | "payout.failed";
  /** 1 = processing, 2 = final. A receiver must not rely on arrival order. */
  sequence: 1 | 2;
  amountMinor: string;
  occurredAt: string;
}

export type Sender = (event: ProviderEvent) => Promise<void>;

export interface PayoutRecord {
  id: string;
  reference: string;
  amountMinor: bigint;
  destinationLabel: string;
  status: PayoutStatus;
  createdAt: string;
}

export class SimError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SimOptions {
  config: SimConfig;
  rng: () => number;
  send: Sender;
  /** Defaults to setTimeout. Tests pass a no-op and call complete() themselves. */
  schedule?: (fn: () => void, ms: number) => void;
  onError?: (error: unknown, event: ProviderEvent) => void;
}

export class ProviderSim {
  private config: SimConfig;
  private readonly payouts = new Map<string, PayoutRecord>();
  private readonly byReference = new Map<string, string>();
  private readonly rng: () => number;
  private readonly send: Sender;
  private readonly schedule: (fn: () => void, ms: number) => void;
  private readonly onError: (error: unknown, event: ProviderEvent) => void;

  constructor(options: SimOptions) {
    this.config = { ...options.config };
    this.rng = options.rng;
    this.send = options.send;
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        timer.unref();
      });
    this.onError = options.onError ?? (() => undefined);
  }

  getConfig(): SimConfig {
    return { ...this.config };
  }

  setConfig(patch: Partial<SimConfig>): SimConfig {
    this.config = { ...this.config, ...patch };
    return this.getConfig();
  }

  /** Same reference returns the same payout; reusing it with another amount is an error. */
  create(input: { reference: string; amountMinor: bigint; destinationLabel: string }): {
    record: PayoutRecord;
    created: boolean;
  } {
    const existingId = this.byReference.get(input.reference);
    if (existingId) {
      const existing = this.payouts.get(existingId);
      if (existing) {
        if (existing.amountMinor !== input.amountMinor) {
          throw new SimError(
            422,
            "reference_reused",
            "This reference was already used with a different amount.",
          );
        }
        return { record: existing, created: false };
      }
    }

    const record: PayoutRecord = {
      id: `prov_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      reference: input.reference,
      amountMinor: input.amountMinor,
      destinationLabel: input.destinationLabel,
      status: "processing",
      createdAt: new Date().toISOString(),
    };
    this.payouts.set(record.id, record);
    this.byReference.set(record.reference, record.id);
    this.schedule(() => void this.complete(record.id), this.config.latencyMs);
    return { record, created: true };
  }

  get(id: string): PayoutRecord | undefined {
    return this.payouts.get(id);
  }

  /** Decides the outcome, updates the provider's truth, then delivers the events. */
  async complete(id: string): Promise<ProviderEvent[]> {
    const record = this.payouts.get(id);
    if (!record || record.status !== "processing") return [];

    const failed = this.rng() < this.config.failureRate;
    record.status = failed ? "failed" : "settled";

    const base = {
      payoutRef: record.id,
      reference: record.reference,
      amountMinor: record.amountMinor.toString(),
    };
    const processing: ProviderEvent = {
      ...base,
      eventId: `evt_${randomUUID()}`,
      type: "payout.processing",
      sequence: 1,
      occurredAt: new Date().toISOString(),
    };
    const final: ProviderEvent = {
      ...base,
      eventId: `evt_${randomUUID()}`,
      type: failed ? "payout.failed" : "payout.settled",
      sequence: 2,
      occurredAt: new Date().toISOString(),
    };

    const outOfOrder = this.rng() < this.config.outOfOrderRate;
    const duplicate = this.rng() < this.config.duplicateRate;
    const queue = outOfOrder ? [final, processing] : [processing, final];
    // A duplicate is the same event (same eventId) delivered again.
    if (duplicate) queue.push(final);

    const delivered: ProviderEvent[] = [];
    for (const event of queue) {
      delivered.push(event);
      try {
        await this.send(event);
      } catch (error) {
        this.onError(error, event);
      }
    }
    return delivered;
  }

  /** What the provider says happened. Reconciliation compares this with our ledger. */
  settlementReport(): {
    providerRef: string;
    reference: string;
    amountMinor: string;
    status: PayoutStatus;
  }[] {
    return [...this.payouts.values()]
      .filter((p) => p.status !== "processing")
      .map((p) => ({
        providerRef: p.id,
        reference: p.reference,
        amountMinor: p.amountMinor.toString(),
        status: p.status,
      }));
  }
}
