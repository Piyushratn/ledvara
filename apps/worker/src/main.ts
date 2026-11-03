import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pg from "pg";
import { loadConfig } from "./config.js";
import { QUEUE_NAME, RelayLoop } from "./relay.js";

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5 });
// BullMQ requires maxRetriesPerRequest: null on its connections.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue(QUEUE_NAME, { connection });

// Step 68 replaces this logger with real webhook delivery.
const consumer = new Worker(
  QUEUE_NAME,
  async (job) => {
    console.log(`event ${job.id} ${job.name}`);
  },
  { connection, concurrency: 5 },
);
consumer.on("failed", (job, error) => console.error(`job ${job?.id} failed: ${error.message}`));

const relay = new RelayLoop(pool, queue, config.OUTBOX_BATCH_SIZE, config.OUTBOX_POLL_MS, (error) =>
  console.error("relay error:", error instanceof Error ? error.message : error),
);
relay.start();
console.log("Worker started: relaying outbox events");

let stopping = false;
const shutdown = async (signal: string): Promise<void> => {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}, stopping worker...`);
  setTimeout(() => process.exit(1), 10_000).unref();
  await relay.stop();
  await consumer.close();
  await queue.close();
  connection.disconnect();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
