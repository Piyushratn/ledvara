import { randomUUID } from "node:crypto";
import type { Env } from "../config/env.js";

export function buildLoggerOptions(env: Env) {
  return {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
      censor: "[redacted]",
    },
    ...(env.NODE_ENV === "development"
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
          },
        }
      : {}),
  };
}

export function generateRequestId(): string {
  return randomUUID();
}
