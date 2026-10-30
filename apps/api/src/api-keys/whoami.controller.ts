import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiKeyGuard, type ApiKeyRequest } from "./api-key.guard.js";
import { RequireScope } from "./scope.decorator.js";

@Controller("v1")
export class WhoAmIController {
  @Get("whoami")
  @UseGuards(ApiKeyGuard)
  whoami(@Req() request: ApiKeyRequest): { keyId: string; orgId: string; scopes: string[] } {
    return {
      keyId: request.apiKey.id,
      orgId: request.apiKey.orgId,
      scopes: request.apiKey.scopes,
    };
  }

  // Proves scope enforcement; real ledger routes will use the same decorator.
  @Get("whoami/ledger")
  @UseGuards(ApiKeyGuard)
  @RequireScope("ledger:write")
  needsLedgerWrite(@Req() request: ApiKeyRequest): { ok: true; orgId: string } {
    return { ok: true, orgId: request.apiKey.orgId };
  }
}
