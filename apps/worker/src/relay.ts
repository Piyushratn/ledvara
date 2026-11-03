import type { Pool } from "pg";

export interface OutboxRow {
  id: string;
  org_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  created_at: string;
}

export interface JobQueue {
  add(name: string, data: unknown, options: { jobId: string }): Promise<unknown>;
}

export const QUEUE_NAME = "outbox-events";

/**
 * Claims a batch of unpublished events, enqueues one job per event, and marks them published,
 * all inside one transaction. SKIP LOCKED lets several relays run without double-claiming.
 * Returns how many events were relayed.
 */
export async function relayOnce(pool: Pool, queue: JobQueue, batchSize: number): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, org_id, type, aggregate_type, aggregate_id, payload, created_at::text
         FROM outbox_events
        WHERE published_at IS NULL
        ORDER BY created_at, id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batchSize],
    );
    for (const row of rows) {
      // The fixed jobId makes a repeat enqueue a no-op, so a crash before COMMIT is harmless.
      await queue.add(row.type, row, { jobId: row.id });
    }
    if (rows.length > 0) {
      await client.query(
        "UPDATE outbox_events SET published_at = now() WHERE id = ANY($1::uuid[])",
        [rows.map((r) => r.id)],
      );
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class RelayLoop {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly pool: Pool,
    private readonly queue: JobQueue,
    private readonly batchSize: number,
    private readonly pollMs: number,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  start(): void {
    const tick = (): void => {
      if (this.stopped || this.running) return;
      this.running = true;
      this.inFlight = (async () => {
        try {
          // Drain: keep going while full batches come back.
          while (
            !this.stopped &&
            (await relayOnce(this.pool, this.queue, this.batchSize)) === this.batchSize
          ) {
            /* continue */
          }
        } catch (error) {
          this.onError(error);
        } finally {
          this.running = false;
        }
      })();
    };
    this.timer = setInterval(tick, this.pollMs);
    tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.inFlight;
  }
}
