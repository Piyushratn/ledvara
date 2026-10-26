import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./config/env.js";
import { buildLoggerOptions, generateRequestId } from "./logging/logger-options.js";

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
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", async (request, reply) => {
      void reply.header("x-request-id", request.id);
    });

  await app.listen(env.PORT, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
