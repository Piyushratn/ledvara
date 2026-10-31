import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiKeyGuard, type ApiKeyRequest } from "../api-keys/api-key.guard.js";
import { RequireScope } from "../api-keys/scope.decorator.js";
import { AppError } from "../errors/app-error.js";
import { ProviderClient } from "../provider/provider-client.js";
import { parseOrThrow } from "../validation/parse.js";
import { createPayoutSchema } from "./payouts.schemas.js";
import { PayoutsService, type PayoutView } from "./payouts.service.js";

@Controller("v1/payouts")
@UseGuards(ApiKeyGuard)
export class PayoutsController {
  private readonly logger = new Logger(PayoutsController.name);

  constructor(
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
    @Inject(ProviderClient) private readonly provider: ProviderClient,
  ) {}

  @Post()
  @RequireScope("ledger:write")
  async create(
    @Body() body: unknown,
    @Req() request: ApiKeyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const header = request.headers["idempotency-key"];
    const key = typeof header === "string" ? header.trim() : "";
    if (key.length < 1 || key.length > 255) {
      throw new AppError(
        400,
        "idempotency_key_required",
        "An Idempotency-Key header (1-255 characters) is required.",
      );
    }
    const input = parseOrThrow(createPayoutSchema, body);
    const result = await this.payouts.create(request.apiKey.orgId, key, input);
    void reply.status(result.status);
    void reply.header("Idempotent-Replayed", result.replayed ? "true" : "false");

    // After the commit: tell the provider. The payout id is the idempotent reference, so a
    // repeat is harmless. A failure leaves the payout pending for retry/reconciliation.
    if (!result.replayed) {
      const view = result.body as PayoutView;
      try {
        await this.provider.createPayout({
          reference: view.id,
          amountMinor: view.amountMinor,
          destinationLabel: view.destinationLabel,
        });
      } catch (error) {
        this.logger.error({ err: error, payoutId: view.id }, "Could not reach the provider");
      }
    }
    return result.body;
  }

  @Get(":id")
  @RequireScope("ledger:read")
  async get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: ApiKeyRequest,
  ): Promise<PayoutView> {
    return this.payouts.get(request.apiKey.orgId, id);
  }
}
