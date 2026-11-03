import "dotenv/config";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import pg from "pg";
import { loadConfig } from "./config.js";
import { ReconcileLoop } from "./reconcile.js";
import { QUEUE_NAME, RelayLoop, type OutboxRow } from "./relay.js";
import {
  DELIVERY_QUEUE_NAME,
  MAX_DELIVERY_ATTEMPTS,
  deliverOnce,
  type DeliveryJob,
} from "./webhooks/deliver.js";
import { fanOut } from "./webhooks/fanout.js";
import { PgWebhookStore } from "./webhooks/pg-store.js";
import { parseKey } from "./webhooks/webhook-crypto.js";

const config = loadConfig();
const key = parseKey(config.WEBHOOK_SECRET_KEY);
if (config.WEBHOOK_ALLOW_PRIVATE_TARGETS) {
  console.warn("WEBHOOK_ALLOW_PRIVATE_TARGETS is on: private addresses can be called. Dev only.");
}

const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 });
// BullMQ requires maxRetriesPerRequest: null on its connections.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const store = new PgWebhookStore(pool);

const eventQueue = new Queue(QUEUE_NAME, { connection });
const deliveryQueue = new Queue(DELIVERY_QUEUE_NAME, { connection });

// Stage 1: each outbox event becomes one delivery job per matching endpoint.
const fanOutWorker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const count = await fanOut(job.data as OutboxRow, store, deliveryQueue);
    console.log(`event ${job.id} ${job.name}: ${count} delivery job(s)`);
  },
  { connection, concurrency: 5 },
);
fanOutWorker.on("failed", (job, error) =>
  console.error(`fan-out ${job?.id} failed: ${error.message}`),
);

// Stage 2: make one signed HTTP attempt. BullMQ's backoff handles the retries.
const deliveryWorker = new Worker(
  DELIVERY_QUEUE_NAME,
  async (job) => {
    const result = await deliverOnce(
      job.data as DeliveryJob,
      { number: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? MAX_DELIVERY_ATTEMPTS },
      {
        store,
        key,
        timeoutMs: config.WEBHOOK_TIMEOUT_MS,
        allowPrivate: config.WEBHOOK_ALLOW_PRIVATE_TARGETS,
      },
    );
    if (result === "retry") throw new Error("Delivery failed; will retry.");
    if (result === "failed") throw new UnrecoverableError("Delivery failed permanently.");
  },
  { connection, concurrency: 10 },
);
deliveryWorker.on("failed", (job, error) =>
  console.error(`delivery ${job?.id} failed: ${error.message}`),
);

const relay = new RelayLoop(
  pool,
  eventQueue,
  config.OUTBOX_BATCH_SIZE,
  config.OUTBOX_POLL_MS,
  (error) => console.error("relay error:", error instanceof Error ? error.message : error),
);
relay.start();

const reconcile =
  config.RECONCILE_INTERVAL_MS > 0
    ? new ReconcileLoop(pool, config.RECONCILE_INTERVAL_MS, (message, data) => {
        if (message.startsWith("Reconciliation ok")) console.log(message);
        else console.error(message, data ?? "");
      })
    : undefined;
reconcile?.start();

console.log("Worker started: relaying outbox events and delivering webhooks");

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}, stopping worker...`);
  setTimeout(() => process.exit(1), 10_000).unref();
  await relay.stop();
  await reconcile?.stop();
  await fanOutWorker.close();
  await deliveryWorker.close();
  await eventQueue.close();
  await deliveryQueue.close();
  connection.disconnect();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
