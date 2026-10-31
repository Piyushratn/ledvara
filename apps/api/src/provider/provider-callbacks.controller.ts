import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { loadEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { parseOrThrow } from "../validation/parse.js";
import { providerEventSchema, ProviderEventsService } from "./provider-events.service.js";
import { verifySignature } from "./signature.js";

@Controller("v1/provider")
export class ProviderCallbacksController {
  private readonly secret = loadEnv().PROVIDER_CALLBACK_SECRET;

  constructor(@Inject(ProviderEventsService) private readonly events: ProviderEventsService) {}

  @Post("callbacks")
  @HttpCode(200)
  async receive(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ outcome: string }> {
    const header = request.headers["x-provider-signature"];
    // Nest's rawBody option stores the exact request bytes as a Buffer.
    const rawBuffer = (request as unknown as { rawBody?: Buffer }).rawBody;
    const raw = rawBuffer?.toString("utf8");
    if (
      typeof header !== "string" ||
      typeof raw !== "string" ||
      !verifySignature(this.secret, raw, header, Math.floor(Date.now() / 1000))
    ) {
      throw new AppError(401, ErrorCodes.Unauthorized, "Invalid signature.");
    }
    const event = parseOrThrow(providerEventSchema, body);
    return { outcome: await this.events.handle(event) };
  }
}
