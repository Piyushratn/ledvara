import type { Pool } from "pg";
import type { AttemptRecord, DeliveryStore, EndpointRecord } from "./deliver.js";
import type { FanOutStore } from "./fanout.js";

export const AUTO_DISABLE_THRESHOLD = 10;

export class PgWebhookStore implements DeliveryStore, FanOutStore {
  constructor(private readonly pool: Pool) {}

  async findEndpointIds(orgId: string, eventType: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM webhook_endpoints
        WHERE org_id = $1 AND enabled
          AND ('*' = ANY(event_types) OR $2::text = ANY(event_types))`,
      [orgId, eventType],
    );
    return rows.map((row) => row.id);
  }

  async loadEndpoint(id: string): Promise<EndpointRecord | null> {
    const { rows } = await this.pool.query<{
      id: string;
      org_id: string;
      url: string;
      secret_enc: string;
      enabled: boolean;
    }>("SELECT id, org_id, url, secret_enc, enabled FROM webhook_endpoints WHERE id = $1", [id]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      orgId: row.org_id,
      url: row.url,
      secretEnc: row.secret_enc,
      enabled: row.enabled,
    };
  }

  async recordAttempt(record: AttemptRecord): Promise<void> {
    const status = record.outcome === "retry" ? "pending" : record.outcome;
    await this.pool.query(
      `INSERT INTO webhook_deliveries
         (org_id, endpoint_id, event_id, event_type, status, attempts,
          last_status_code, last_error, last_attempt_at, delivered_at)
       VALUES ($1, $2, $3, $4, $5::text, 1, $6, $7, now(),
               CASE WHEN $5::text = 'succeeded' THEN now() END)
       ON CONFLICT (endpoint_id, event_id) DO UPDATE SET
         status = EXCLUDED.status,
         attempts = webhook_deliveries.attempts + 1,
         last_status_code = EXCLUDED.last_status_code,
         last_error = EXCLUDED.last_error,
         last_attempt_at = now(),
         delivered_at = EXCLUDED.delivered_at`,
      [
        record.orgId,
        record.endpointId,
        record.eventId,
        record.eventType,
        status,
        record.statusCode,
        record.error,
      ],
    );

    if (record.outcome === "retry") return;
    await this.trackStreak(record);
  }

  /**
   * One statement updates the streak and, at the threshold, disables the endpoint,
   * so two workers finishing at the same moment cannot miscount.
   */
  private async trackStreak(record: AttemptRecord): Promise<void> {
    if (record.outcome === "succeeded") {
      await this.pool.query(
        "UPDATE webhook_endpoints SET consecutive_failures = 0 WHERE id = $1 AND consecutive_failures <> 0",
        [record.endpointId],
      );
      return;
    }
    await this.pool.query(
      `UPDATE webhook_endpoints SET
         consecutive_failures = consecutive_failures + 1,
         enabled = CASE WHEN consecutive_failures + 1 >= $2 THEN false ELSE enabled END,
         disabled_at = CASE WHEN consecutive_failures + 1 >= $2 AND enabled THEN now() ELSE disabled_at END,
         disabled_reason = CASE WHEN consecutive_failures + 1 >= $2 AND enabled
                                THEN 'Disabled automatically after repeated failed deliveries.'
                                ELSE disabled_reason END,
         updated_at = now()
       WHERE id = $1`,
      [record.endpointId, AUTO_DISABLE_THRESHOLD],
    );
  }
}
