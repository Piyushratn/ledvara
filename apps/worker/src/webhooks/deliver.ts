import { decryptSecret } from "./webhook-crypto.js";
import { postJson } from "./http-post.js";
import { UnsafeUrlError, validateWebhookUrl } from "./safe-url.js";
import { buildSignatureHeader, SIGNATURE_HEADER } from "./signing.js";

export const DELIVERY_QUEUE_NAME = "webhook-deliveries";
export const MAX_DELIVERY_ATTEMPTS = 8;

/** BullMQ options for every delivery job: 10s, 20s, 40s ... between attempts. */
export const DELIVERY_JOB_OPTIONS = {
  attempts: MAX_DELIVERY_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: 10_000, jitter: 0.5 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export interface EndpointRecord {
  id: string;
  orgId: string;
  url: string;
  secretEnc: string;
  enabled: boolean;
}

export type AttemptOutcome = "succeeded" | "retry" | "failed";

export interface AttemptRecord {
  endpointId: string;
  orgId: string;
  eventId: string;
  eventType: string;
  outcome: AttemptOutcome;
  statusCode: number | null;
  error: string | null;
}

export interface DeliveryStore {
  loadEndpoint(id: string): Promise<EndpointRecord | null>;
  recordAttempt(record: AttemptRecord): Promise<void>;
}

export interface DeliveryJob {
  endpointId: string;
  orgId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export interface DeliverDeps {
  store: DeliveryStore;
  key: Buffer;
  timeoutMs: number;
  allowPrivate: boolean;
  now?: () => number;
}

export type DeliveryResult = AttemptOutcome | "skipped";

/**
 * Makes one delivery attempt and records it. Returns "retry" when the caller should
 * throw so BullMQ schedules another attempt; "succeeded", "failed" and "skipped" are final.
 */
export async function deliverOnce(
  job: DeliveryJob,
  attempt: { number: number; maxAttempts: number },
  deps: DeliverDeps,
): Promise<DeliveryResult> {
  const endpoint = await deps.store.loadEndpoint(job.endpointId);
  if (!endpoint?.enabled) return "skipped";

  const lastAttempt = attempt.number >= attempt.maxAttempts;
  const retryOrFail = (): AttemptOutcome => (lastAttempt ? "failed" : "retry");

  let outcome: AttemptOutcome;
  let statusCode: number | null = null;
  let error: string | null = null;

  try {
    const secret = decryptSecret(endpoint.secretEnc, deps.key, endpoint.id);
    const url = validateWebhookUrl(endpoint.url, { allowPrivate: deps.allowPrivate });
    const body = JSON.stringify({
      id: job.eventId,
      type: job.eventType,
      createdAt: job.createdAt,
      data: job.payload,
    });
    const timestamp = Math.floor((deps.now?.() ?? Date.now()) / 1000);

    const response = await postJson(
      url,
      body,
      {
        [SIGNATURE_HEADER]: buildSignatureHeader(secret, timestamp, body),
        "ledvara-event-id": job.eventId,
        "ledvara-event-type": job.eventType,
      },
      { timeoutMs: deps.timeoutMs, allowPrivate: deps.allowPrivate },
    );
    statusCode = response.status;
    if (response.status >= 200 && response.status < 300) {
      outcome = "succeeded";
    } else {
      outcome = retryOrFail();
      error = `HTTP ${response.status}`;
    }
  } catch (caught) {
    const code = (caught as NodeJS.ErrnoException).code;
    // A target we refuse to call will not become safe by waiting.
    outcome = caught instanceof UnsafeUrlError || code === "EBLOCKED" ? "failed" : retryOrFail();
    error = caught instanceof Error ? caught.message.slice(0, 300) : "Unknown error";
  }

  await deps.store.recordAttempt({
    endpointId: endpoint.id,
    orgId: endpoint.orgId,
    eventId: job.eventId,
    eventType: job.eventType,
    outcome,
    statusCode,
    error,
  });
  return outcome;
}
