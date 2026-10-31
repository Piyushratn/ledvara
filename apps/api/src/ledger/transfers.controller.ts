import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiKeyGuard, type ApiKeyRequest } from "../api-keys/api-key.guard.js";
import { RequireScope } from "../api-keys/scope.decorator.js";
import { AppError } from "../errors/app-error.js";
import { parseOrThrow } from "../validation/parse.js";
import { createRefundSchema } from "./refunds.schemas.js";
import { RefundsService } from "./refunds.service.js";
import { ReversalsService } from "./reversals.service.js";
import { createTransferSchema } from "./transfers.schemas.js";
import { listTransfersSchema, TransfersListService } from "./transfers-list.service.js";
import { TransfersService, type TransferView } from "./transfers.service.js";

function requireIdempotencyKey(request: ApiKeyRequest): string {
  const header = request.headers["idempotency-key"];
  const key = typeof header === "string" ? header.trim() : "";
  if (key.length < 1 || key.length > 255) {
    throw new AppError(
      400,
      "idempotency_key_required",
      "An Idempotency-Key header (1-255 characters) is required.",
    );
  }
  return key;
}

@Controller("v1/transfers")
@UseGuards(ApiKeyGuard)
export class TransfersController {
  constructor(
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(TransfersListService) private readonly listing: TransfersListService,
    @Inject(ReversalsService) private readonly reversals: ReversalsService,
    @Inject(RefundsService) private readonly refunds: RefundsService,
  ) {}

  @Post()
  @RequireScope("ledger:write")
  async create(
    @Body() body: unknown,
    @Req() request: ApiKeyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = requireIdempotencyKey(request);
    const input = parseOrThrow(createTransferSchema, body);
    const result = await this.transfers.create(request.apiKey.orgId, key, input);
    void reply.status(result.status);
    void reply.header("Idempotent-Replayed", result.replayed ? "true" : "false");
    return result.body;
  }

  @Get()
  @RequireScope("ledger:read")
  async list(@Query() query: unknown, @Req() request: ApiKeyRequest) {
    return this.listing.list(request.apiKey.orgId, parseOrThrow(listTransfersSchema, query));
  }

  @Post(":id/reverse")
  @RequireScope("ledger:write")
  async reverse(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: ApiKeyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = requireIdempotencyKey(request);
    const result = await this.reversals.reverse(request.apiKey.orgId, id, key);
    void reply.status(result.status);
    void reply.header("Idempotent-Replayed", result.replayed ? "true" : "false");
    return result.body;
  }

  @Post(":id/refunds")
  @RequireScope("ledger:write")
  async refund(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: ApiKeyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<unknown> {
    const key = requireIdempotencyKey(request);
    const input = parseOrThrow(createRefundSchema, body ?? {});
    const result = await this.refunds.refund(request.apiKey.orgId, id, key, input);
    void reply.status(result.status);
    void reply.header("Idempotent-Replayed", result.replayed ? "true" : "false");
    return result.body;
  }

  @Get(":id")
  @RequireScope("ledger:read")
  async get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: ApiKeyRequest,
  ): Promise<TransferView> {
    return this.transfers.get(request.apiKey.orgId, id);
  }
}
