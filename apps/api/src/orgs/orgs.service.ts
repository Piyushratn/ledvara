import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import type { CreateOrgInput } from "./orgs.schemas.js";
import type { Role } from "./roles.js";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

@Injectable()
export class OrgsService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async create(userId: string, input: CreateOrgInput): Promise<OrgSummary> {
    return this.deps.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(schema.organizations)
        .values({ name: input.name, slug: input.slug, createdBy: userId })
        .onConflictDoNothing({ target: schema.organizations.slug })
        .returning();

      if (!org) {
        throw new AppError(409, ErrorCodes.Conflict, "That slug is already taken.");
      }

      await tx.insert(schema.memberships).values({ orgId: org.id, userId, role: "owner" });
      return { id: org.id, name: org.name, slug: org.slug, role: "owner" };
    });
  }

  async listForUser(userId: string): Promise<OrgSummary[]> {
    const rows = await this.deps.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.slug,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.memberships.orgId, schema.organizations.id))
      .where(eq(schema.memberships.userId, userId))
      .orderBy(schema.organizations.createdAt);
    return rows.map((row) => ({ ...row, role: row.role as Role }));
  }
}
