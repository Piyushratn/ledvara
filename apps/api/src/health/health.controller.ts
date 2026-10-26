import { Controller, Get, HttpCode, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Dependencies } from "./dependencies.js";

@Controller()
export class HealthController {
  constructor(private readonly dependencies: Dependencies) {}

  @Get("healthz")
  @HttpCode(200)
  healthz(): { status: string } {
    return { status: "ok" };
  }

  @Get("readyz")
  async readyz(@Res({ passthrough: true }) reply: FastifyReply): Promise<{
    status: string;
    checks: { postgres: string; redis: string };
  }> {
    const [postgresOk, redisOk] = await Promise.all([
      this.dependencies.pingPostgres(),
      this.dependencies.pingRedis(),
    ]);
    const ready = postgresOk && redisOk;
    void reply.status(ready ? 200 : 503);
    return {
      status: ready ? "ready" : "not_ready",
      checks: {
        postgres: postgresOk ? "up" : "down",
        redis: redisOk ? "up" : "down",
      },
    };
  }
}
