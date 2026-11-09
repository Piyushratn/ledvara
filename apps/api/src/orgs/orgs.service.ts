import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { eq } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import type { CreateOrgInput } from "./orgs.schemas.js";
import type { Role } from "./roles.js";
import { slugify, withSuffix } from "./slug.js";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

const GENERATED_SLUG_ATTEMPTS = 5;

@Injectable()
export class OrgsService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  async create(userId: string, input: CreateOrgInput): Promise<OrgSummary> {
    // An explicit slug that is taken is a conflict. A generated one gets a suffix and retries.
    if (input.slug !== undefined) return this.insert(userId, input.name, input.slug);

    const base = slugify(input.name);
    for (let attempt = 0; attempt < GENERATED_SLUG_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? base : withSuffix(base);
      const created = await this.tryInsert(userId, input.name, candidate);
      if (created) return created;
    }
    throw new AppError(409, ErrorCodes.Conflict, "Could not generate a free slug. Try again.");
  }

  private async insert(userId: string, name: string, slug: string): Promise<OrgSummary> {
    const created = await this.tryInsert(userId, name, slug);
    if (!created) {
      throw new AppError(409, ErrorCodes.Conflict, "That slug is already taken.");
    }
    return created;
  }

  private async tryInsert(userId: string, name: string, slug: string): Promise<OrgSummary | null> {
    return this.deps.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(schema.organizations)
        .values({ name, slug, createdBy: userId })
        .onConflictDoNothing({ target: schema.organizations.slug })
        .returning();
      if (!org) return null;

      await tx.insert(schema.memberships).values({ orgId: org.id, userId, role: "owner" });
      return { id: org.id, name: org.name, slug: org.slug, role: "owner" as const };
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
