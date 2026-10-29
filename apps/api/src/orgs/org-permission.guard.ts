import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { schema } from "@ledvara/db";
import { and, eq } from "drizzle-orm";
import { validate as isUuid } from "uuid";
import type { AuthenticatedRequest } from "../auth/access-token.guard.js";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { can, type Permission } from "./permissions.js";
import { PERMISSION_KEY } from "./require-permission.js";
import type { Role } from "./roles.js";

export type OrgRequest = AuthenticatedRequest & {
  membership: { orgId: string; role: Role };
};

@Injectable()
export class OrgPermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Dependencies) private readonly deps: Dependencies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Permission | undefined>(
      PERMISSION_KEY,
      context.getHandler(),
    );
    const request = context
      .switchToHttp()
      .getRequest<OrgRequest & { params: { orgId?: string } }>();
    const orgId = request.params.orgId;

    // Fail closed: a route using this guard must declare a permission and an :orgId.
    if (!required || !orgId || !request.auth) {
      throw new AppError(403, ErrorCodes.Forbidden, "Access denied.");
    }
    if (!isUuid(orgId)) {
      throw new AppError(404, ErrorCodes.NotFound, "Organization not found.");
    }

    const [membership] = await this.deps.db
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.orgId, orgId),
          eq(schema.memberships.userId, request.auth.userId),
        ),
      )
      .limit(1);

    // 404 for non-members so organizations cannot be discovered.
    if (!membership) {
      throw new AppError(404, ErrorCodes.NotFound, "Organization not found.");
    }
    const role = membership.role as Role;
    if (!can(role, required)) {
      throw new AppError(403, ErrorCodes.Forbidden, "You do not have permission to do that.");
    }

    request.membership = { orgId, role };
    return true;
  }
}
