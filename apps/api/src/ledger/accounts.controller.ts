import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiKeyGuard, type ApiKeyRequest } from "../api-keys/api-key.guard.js";
import { RequireScope } from "../api-keys/scope.decorator.js";
import { parseOrThrow } from "../validation/parse.js";
import { balanceQuerySchema, createAccountSchema } from "./accounts.schemas.js";
import { AccountsService, type AccountView } from "./accounts.service.js";

@Controller("v1/accounts")
@UseGuards(ApiKeyGuard)
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Post()
  @RequireScope("ledger:write")
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() request: ApiKeyRequest): Promise<AccountView> {
    return this.accounts.create(request.apiKey.orgId, parseOrThrow(createAccountSchema, body));
  }

  @Get()
  @RequireScope("ledger:read")
  async list(@Req() request: ApiKeyRequest): Promise<{ data: AccountView[] }> {
    return { data: await this.accounts.list(request.apiKey.orgId) };
  }

  @Get(":id/balance")
  @RequireScope("ledger:read")
  async balance(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
    @Req() request: ApiKeyRequest,
  ) {
    const input = parseOrThrow(balanceQuerySchema, query);
    return this.accounts.balance(request.apiKey.orgId, id, input.at);
  }
}
