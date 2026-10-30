import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { can } from "./permissions.js";
import type { Role } from "./roles.js";

export interface MemberView {
  userId: string;
  email: string;
  fullName: string | null;
  role: Role;
  joinedAt: Date;
}

@Injectable()
export class MembersService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async list(orgId: string): Promise<MemberView[]> {
    const rows = await this.deps.db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        fullName: schema.users.fullName,
        role: schema.memberships.role,
        joinedAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.orgId, orgId))
      .orderBy(schema.memberships.createdAt);
    return rows.map((row) => ({ ...row, role: row.role as Role }));
  }

  async updateRole(orgId: string, targetUserId: string, newRole: Role): Promise<MemberView> {
    await this.deps.db.transaction(async (tx) => {
      // Lock every owner row so concurrent demotions cannot both remove the last owner.
      const owners = await tx
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.role, "owner")))
        .for("update");

      const [target] = await tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetUserId)),
        )
        .limit(1);
      if (!target) {
        throw new AppError(404, ErrorCodes.NotFound, "Member not found.");
      }

      const demotingLastOwner =
        target.role === "owner" && newRole !== "owner" && owners.length <= 1;
      if (demotingLastOwner) {
        throw new AppError(
          409,
          ErrorCodes.Conflict,
          "An organization must keep at least one owner.",
        );
      }

      await tx
        .update(schema.memberships)
        .set({ role: newRole })
        .where(
          and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetUserId)),
        );
    });

    const member = (await this.list(orgId)).find((m) => m.userId === targetUserId);
    if (!member) {
      throw new AppError(404, ErrorCodes.NotFound, "Member not found.");
    }
    return member;
  }

  async remove(
    orgId: string,
    actorId: string,
    actorRole: Role,
    targetUserId: string,
  ): Promise<void> {
    const leaving = actorId === targetUserId;
    if (!leaving && !can(actorRole, "members:remove")) {
      throw new AppError(403, ErrorCodes.Forbidden, "You do not have permission to do that.");
    }

    await this.deps.db.transaction(async (tx) => {
      const owners = await tx
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.role, "owner")))
        .for("update");

      const [target] = await tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(
          and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetUserId)),
        )
        .limit(1);
      if (!target) {
        throw new AppError(404, ErrorCodes.NotFound, "Member not found.");
      }

      // Only an owner may remove another owner.
      if (!leaving && target.role === "owner" && actorRole !== "owner") {
        throw new AppError(403, ErrorCodes.Forbidden, "Only an owner can remove an owner.");
      }
      if (target.role === "owner" && owners.length <= 1) {
        throw new AppError(
          409,
          ErrorCodes.Conflict,
          "An organization must keep at least one owner.",
        );
      }

      await tx
        .delete(schema.memberships)
        .where(
          and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, targetUserId)),
        );
    });
  }
}
