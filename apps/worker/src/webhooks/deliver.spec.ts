import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deliverOnce,
  type AttemptRecord,
  type DeliverDeps,
  type DeliveryJob,
  type DeliveryStore,
  type EndpointRecord,
} from "./deliver.js";
import { verifySignatureHeader } from "./signing.js";
import { encryptSecret } from "./webhook-crypto.js";

const key = Buffer.alloc(32, 9);
const secret = "whsec_integration_secret";
const ENDPOINT_ID = "11111111-1111-4111-8111-111111111111";

interface Seen {
  headers: http.IncomingHttpHeaders;
  body: string;
}

let server: http.Server;
let port = 0;
let seen: Seen[] = [];
let respond: (res: http.ServerResponse) => void = (res) => res.writeHead(200).end("ok");

class FakeStore implements DeliveryStore {
  endpoint: EndpointRecord | null = null;
  attempts: AttemptRecord[] = [];

  loadEndpoint(): Promise<EndpointRecord | null> {
    return Promise.resolve(this.endpoint);
  }

  recordAttempt(record: AttemptRecord): Promise<void> {
    this.attempts.push(record);
    return Promise.resolve();
  }
}

const job: DeliveryJob = {
  endpointId: ENDPOINT_ID,
  orgId: "22222222-2222-4222-8222-222222222222",
  eventId: "33333333-3333-4333-8333-333333333333",
  eventType: "payout.paid",
  payload: { amountMinor: "1000" },
  createdAt: "2026-11-01T10:00:00Z",
};

let store: FakeStore;

function deps(overrides: Partial<DeliverDeps> = {}): DeliverDeps {
  return { store, key, timeoutMs: 1500, allowPrivate: true, ...overrides };
}

function endpointFor(url: string, enabled = true): EndpointRecord {
  return {
    id: ENDPOINT_ID,
    orgId: job.orgId,
    url,
    secretEnc: encryptSecret(secret, key, ENDPOINT_ID),
    enabled,
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      respond(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  respond = (res) => res.writeHead(200).end("ok");
  store = new FakeStore();
  store.endpoint = endpointFor(`http://127.0.0.1:${port}/hook`);
});

describe("deliverOnce", () => {
  it("delivers a body the receiver can verify with the secret", async () => {
    const result = await deliverOnce(job, { number: 1, maxAttempts: 8 }, deps());
    expect(result).toBe("succeeded");
    expect(seen).toHaveLength(1);

    const request = seen[0];
    const signature = String(request?.headers["ledvara-signature"]);
    expect(
      verifySignatureHeader(secret, signature, request?.body ?? "", Math.floor(Date.now() / 1000)),
    ).toBe(true);
    expect(request?.headers["ledvara-event-id"]).toBe(job.eventId);
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      id: job.eventId,
      type: "payout.paid",
    });
    expect(store.attempts[0]).toMatchObject({ outcome: "succeeded", statusCode: 200 });
  });

  it("asks for a retry on a 500, and fails for good on the last attempt", async () => {
    respond = (res) => res.writeHead(500).end("boom");
    expect(await deliverOnce(job, { number: 1, maxAttempts: 3 }, deps())).toBe("retry");
    expect(await deliverOnce(job, { number: 3, maxAttempts: 3 }, deps())).toBe("failed");
    expect(store.attempts.map((a) => a.outcome)).toEqual(["retry", "failed"]);
    expect(store.attempts[0]?.error).toBe("HTTP 500");
  });

  it("does not follow redirects", async () => {
    respond = (res) => res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" }).end();
    expect(await deliverOnce(job, { number: 1, maxAttempts: 3 }, deps())).toBe("retry");
    expect(seen).toHaveLength(1);
    expect(store.attempts[0]?.statusCode).toBe(302);
  });

  it("times out a receiver that never answers", async () => {
    respond = () => undefined;
    const result = await deliverOnce(job, { number: 1, maxAttempts: 3 }, deps({ timeoutMs: 300 }));
    expect(result).toBe("retry");
    expect(store.attempts[0]?.statusCode).toBeNull();
  });

  it("refuses private targets in production mode and never sends the request", async () => {
    const result = await deliverOnce(
      job,
      { number: 1, maxAttempts: 8 },
      deps({ allowPrivate: false }),
    );
    expect(result).toBe("failed");
    expect(seen).toHaveLength(0);
    expect(store.attempts[0]).toMatchObject({ outcome: "failed" });
  });

  it("fails immediately when the secret cannot be decrypted", async () => {
    const result = await deliverOnce(
      job,
      { number: 1, maxAttempts: 8 },
      deps({ key: Buffer.alloc(32, 1) }),
    );
    expect(result).toBe("retry");
    expect(seen).toHaveLength(0);
  });

  it("skips a disabled or missing endpoint without recording anything", async () => {
    store.endpoint = endpointFor(`http://127.0.0.1:${port}/hook`, false);
    expect(await deliverOnce(job, { number: 1, maxAttempts: 8 }, deps())).toBe("skipped");
    store.endpoint = null;
    expect(await deliverOnce(job, { number: 1, maxAttempts: 8 }, deps())).toBe("skipped");
    expect(seen).toHaveLength(0);
    expect(store.attempts).toHaveLength(0);
  });
});
