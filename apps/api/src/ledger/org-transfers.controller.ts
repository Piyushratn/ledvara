import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import { parseOrThrow } from "../validation/parse.js";
import { transfersToCsv } from "./csv.js";
import {
  listTransfersSchema,
  TransfersListService,
  type TransferListItem,
} from "./transfers-list.service.js";
import { TransfersService, type TransferView } from "./transfers.service.js";

const EXPORT_CAP = 5000;

/** The transfers the API-key endpoints serve, for signed-in dashboard users. */
@Controller("v1/orgs/:orgId")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class OrgTransfersController {
  constructor(
    @Inject(TransfersListService) private readonly listing: TransfersListService,
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("transfers")
  @RequirePermission("ledger:read")
  async list(
    @Query() query: unknown,
    @Req() request: OrgRequest,
  ): Promise<{ data: TransferListItem[]; nextCursor: string | null }> {
    return this.listing.list(request.membership.orgId, parseOrThrow(listTransfersSchema, query));
  }

  @Get("transfers.csv")
  @RequirePermission("ledger:read")
  async exportCsv(
    @Query() query: unknown,
    @Req() request: OrgRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const orgId = request.membership.orgId;
    const input = parseOrThrow(listTransfersSchema, query);
    const { rows, truncated } = await this.listing.listAll(orgId, input, EXPORT_CAP);

    await this.audit.record({
      orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: "transfers.exported",
      targetType: "organization",
      targetId: orgId,
      metadata: { rows: rows.length, truncated },
      ip: request.ip ?? null,
    });

    void reply.header("content-type", "text/csv; charset=utf-8");
    void reply.header("content-disposition", 'attachment; filename="transfers.csv"');
    void reply.header("x-export-truncated", truncated ? "true" : "false");
    return transfersToCsv(rows);
  }

  @Get("transfers/:id")
  @RequirePermission("ledger:read")
  async get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: OrgRequest,
  ): Promise<TransferView> {
    return this.transfers.get(request.membership.orgId, id);
  }
}
