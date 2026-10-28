import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, isNull } from "drizzle-orm";
import { Dependencies } from "../health/dependencies.js";

@Injectable()
export class SessionsService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  // A session (token family) is active while at least one of its tokens is not revoked.
  async isActive(familyId: string): Promise<boolean> {
    const [row] = await this.deps.db
      .select({ id: schema.refreshTokens.id })
      .from(schema.refreshTokens)
      .where(
        and(eq(schema.refreshTokens.familyId, familyId), isNull(schema.refreshTokens.revokedAt)),
      )
      .limit(1);
    return Boolean(row);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.deps.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(schema.refreshTokens.familyId, familyId), isNull(schema.refreshTokens.revokedAt)),
      );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.deps.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));
  }

  async getUser(userId: string): Promise<{
    id: string;
    email: string;
    fullName: string | null;
    emailVerified: boolean;
  } | null> {
    const [user] = await this.deps.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }
}
