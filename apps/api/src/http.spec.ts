import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AllExceptionsFilter } from "./errors/all-exceptions.filter.js";
import { Dependencies } from "./health/dependencies.js";
import { HealthController } from "./health/health.controller.js";
import { ShutdownState } from "./health/shutdown-state.js";

@Controller()
class BoomController {
  @Get("boom")
  boom(): never {
    throw new Error("secret internal detail that must not leak");
  }
}

class FakeDependencies {
  postgresUp = true;
  redisUp = true;
  pingPostgres(): Promise<boolean> {
    return Promise.resolve(this.postgresUp);
  }
  pingRedis(): Promise<boolean> {
    return Promise.resolve(this.redisUp);
  }
}

const fake = new FakeDependencies();
const shutdownState = new ShutdownState();

@Module({
  controllers: [HealthController, BoomController],
  providers: [
    { provide: Dependencies, useValue: fake },
    { provide: ShutdownState, useValue: shutdownState },
  ],
})
class TestModule {}

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), {
    logger: false,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("error format", () => {
  it("returns the standard 404 body", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: { code: string; message: string; requestId: string } }>();
    expect(body.error.code).toBe("not_found");
    expect(typeof body.error.requestId).toBe("string");
  });

  it("hides internal details on unexpected errors", async () => {
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret internal detail");
    expect(res.json<{ error: { code: string } }>().error.code).toBe("internal_error");
  });
});

describe("health endpoints", () => {
  it("/healthz is always ok", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });

  it("/readyz is 200 when dependencies are up", async () => {
    fake.postgresUp = true;
    fake.redisUp = true;
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("ready");
  });

  it("/readyz is 503 when Redis is down", async () => {
    fake.redisUp = false;
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ checks: { redis: string } }>().checks.redis).toBe("down");
    fake.redisUp = true;
  });

  it("/readyz is 503 while shutting down", async () => {
    shutdownState.begin();
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ status: string }>().status).toBe("shutting_down");
  });
});
