import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Env } from "../config/env.js";

export async function registerSecurity(app: NestFastifyApplication, env: Env): Promise<void> {
  await app.register(helmet);

  await app.register(cors, {
    origin: (origin, callback) => {
      // Requests without an Origin header (curl, server-to-server) are not browser CORS requests.
      if (!origin || env.CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
    credentials: true,
    maxAge: 600,
  });
}
