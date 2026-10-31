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
import { createTransferSchema } from "./transfers.schemas.js";
import { listTransfersSchema, TransfersListService } from "./transfers-list.service.js";
import { TransfersService, type TransferView } from "./transfers.service.js";

@Controller("v1/transfers")
@UseGuards(ApiKeyGuard)
export class TransfersController {
  constructor(
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(TransfersListService) private readonly listing: TransfersListService,
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

  @Get(":id")
  @RequireScope("ledger:read")
  async get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: ApiKeyRequest,
  ): Promise<TransferView> {
    return this.transfers.get(request.apiKey.orgId, id);
  }
}
