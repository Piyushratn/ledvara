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
import { AuditService } from "../audit/audit.service.js";
import { AccessTokenGuard } from "../auth/access-token.guard.js";
import { OrgPermissionGuard, type OrgRequest } from "../orgs/org-permission.guard.js";
import { RequirePermission } from "../orgs/require-permission.js";
import { parseOrThrow } from "../validation/parse.js";
import { approveSchema, listReviewsSchema, rejectSchema } from "./review.schemas.js";
import { ReviewService, type ReviewItemView } from "./review.service.js";

@Controller("v1/orgs/:orgId/review-items")
@UseGuards(AccessTokenGuard, OrgPermissionGuard)
export class ReviewController {
  constructor(
    @Inject(ReviewService) private readonly reviews: ReviewService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission("reports:read")
  async list(
    @Query() query: unknown,
    @Req() request: OrgRequest,
  ): Promise<{ data: ReviewItemView[] }> {
    const input = parseOrThrow(listReviewsSchema, query);
    return { data: await this.reviews.list(request.membership.orgId, input) };
  }

  @Get(":id")
  @RequirePermission("reports:read")
  async get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: OrgRequest,
  ): Promise<ReviewItemView> {
    return this.reviews.get(request.membership.orgId, id);
  }

  @Post(":id/approve")
  @HttpCode(200)
  @RequirePermission("ledger:write")
  async approve(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: OrgRequest,
  ): Promise<ReviewItemView> {
    const input = parseOrThrow(approveSchema, body ?? {});
    return this.decide(request, id, "approved", input.note ?? null);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermission("ledger:write")
  async reject(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: OrgRequest,
  ): Promise<ReviewItemView> {
    const input = parseOrThrow(rejectSchema, body ?? {});
    return this.decide(request, id, "rejected", input.note);
  }

  private async decide(
    request: OrgRequest,
    id: string,
    decision: "approved" | "rejected",
    note: string | null,
  ): Promise<ReviewItemView> {
    const orgId = request.membership.orgId;
    const item = await this.reviews.decide(orgId, id, request.auth.userId, decision, note);
    await this.audit.record({
      orgId,
      actorType: "user",
      actorId: request.auth.userId,
      action: decision === "approved" ? "review.approved" : "review.rejected",
      targetType: "review_item",
      targetId: id,
      metadata: { transactionId: item.transactionId, score: item.score, hasNote: note !== null },
      ip: request.ip ?? null,
    });
    return item;
  }
}
