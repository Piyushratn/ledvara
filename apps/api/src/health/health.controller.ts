import { Controller, Get, HttpCode, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Dependencies } from "./dependencies.js";
import { ShutdownState } from "./shutdown-state.js";

@Controller()
export class HealthController {
  constructor(
    private readonly dependencies: Dependencies,
    private readonly shutdownState: ShutdownState,
  ) {}

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
    if (this.shutdownState.isShuttingDown()) {
      void reply.status(503);
      return { status: "shutting_down", checks: { postgres: "unknown", redis: "unknown" } };
    }

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
