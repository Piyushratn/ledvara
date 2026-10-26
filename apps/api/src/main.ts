import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./config/env.js";
import { AllExceptionsFilter } from "./errors/all-exceptions.filter.js";
import { ShutdownState } from "./health/shutdown-state.js";
import { buildLoggerOptions, generateRequestId } from "./logging/logger-options.js";
import { registerSecurity } from "./security/register-security.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const adapter = new FastifyAdapter({
    logger: buildLoggerOptions(env),
    requestIdHeader: "x-request-id",
    genReqId: () => generateRequestId(),
    requestIdLogLabel: "requestId",
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  await registerSecurity(app, env);
  app.useGlobalFilters(new AllExceptionsFilter());

  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", async (request, reply) => {
      void reply.header("x-request-id", request.id);
    });

  const shutdownState = app.get(ShutdownState);
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownState.begin();
    console.log(`Received ${signal}, shutting down gracefully...`);

    // Safety net: never let a stuck request block a deploy forever.
    const timer = setTimeout(() => {
      console.error(`Shutdown took longer than ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    app
      .close()
      .then(() => {
        console.log("Shutdown complete.");
        process.exit(0);
      })
      .catch((error: unknown) => {
        console.error("Error during shutdown:", error);
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await app.listen(env.PORT, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
