import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { generateToken, hashToken } from "../auth/tokens.js";
import { loadEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { MailerService } from "../mail/mailer.service.js";
import type { CreateInviteInput } from "./invites.schemas.js";
import type { Role } from "./roles.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);
  private readonly appBaseUrl = loadEnv().APP_BASE_URL;

  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(MailerService) private readonly mailer: MailerService,
  ) {}

  async create(
    orgId: string,
    actorId: string,
    input: CreateInviteInput,
  ): Promise<{ id: string; email: string; role: string; expiresAt: Date }> {
    const [membership] = await this.deps.db
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, actorId)))
      .limit(1);

    // 404 (not 403) so non-members cannot discover which organizations exist.
    if (!membership) {
      throw new AppError(404, ErrorCodes.NotFound, "Organization not found.");
    }
    const actorRole = membership.role as Role;
    if (actorRole !== "owner" && actorRole !== "admin") {
      throw new AppError(403, ErrorCodes.Forbidden, "You are not allowed to invite members.");
    }
    if (input.role === "admin" && actorRole !== "owner") {
      throw new AppError(403, ErrorCodes.Forbidden, "Only an owner can invite an admin.");
    }

    const [existingMember] = await this.deps.db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(and(eq(schema.memberships.orgId, orgId), eq(schema.users.email, input.email)))
      .limit(1);
    if (existingMember) {
      throw new AppError(409, ErrorCodes.Conflict, "That person is already a member.");
    }

    const [org] = await this.deps.db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1);

    const token = generateToken();
    const [invite] = await this.deps.db
      .insert(schema.invites)
      .values({
        orgId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedBy: actorId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();

    if (!invite) {
      throw new AppError(500, ErrorCodes.InternalError, "Could not create the invite.");
    }

    try {
      const link = `${this.appBaseUrl}/accept-invite?token=${token}`;
      await this.mailer.send(
        input.email,
        `You were invited to ${org?.name ?? "an organization"} on Ledvara`,
        `You have been invited to join ${org?.name ?? "an organization"} as ${input.role} (sandbox, simulated money only).\n\nAccept within 7 days, logged in with this email address:\n${link}`,
      );
    } catch (error) {
      this.logger.error({ err: error }, "Failed to send invite email");
    }

    return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt };
  }

  async accept(userId: string, token: string): Promise<{ orgId: string; role: string }> {
    const now = new Date();
    return this.deps.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ email: schema.users.email, verified: schema.users.emailVerifiedAt })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (!user || !user.verified) {
        throw new AppError(403, ErrorCodes.Forbidden, "Verify your email before accepting.");
      }

      // Atomic claim: only one request can flip accepted_at from NULL. The email match is
      // part of the WHERE, so a wrong user does not burn someone else's invite.
      const [invite] = await tx
        .update(schema.invites)
        .set({ acceptedAt: now })
        .where(
          and(
            eq(schema.invites.tokenHash, hashToken(token)),
            eq(schema.invites.email, user.email),
            isNull(schema.invites.acceptedAt),
            gt(schema.invites.expiresAt, now),
          ),
        )
        .returning({ orgId: schema.invites.orgId, role: schema.invites.role });

      if (!invite) {
        throw new AppError(
          400,
          "invalid_or_expired_invite",
          "This invite is invalid, expired, or meant for a different email address.",
        );
      }

      await tx
        .insert(schema.memberships)
        .values({ orgId: invite.orgId, userId, role: invite.role })
        .onConflictDoNothing({ target: [schema.memberships.orgId, schema.memberships.userId] });

      return { orgId: invite.orgId, role: invite.role };
    });
  }
}
