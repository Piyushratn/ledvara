import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, desc, eq, gt, inArray, isNull, min, ne } from "drizzle-orm";
import { Dependencies } from "../health/dependencies.js";

export interface ActiveSession {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  signedInAt: string;
  lastActiveAt: string;
}

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

  async listActive(userId: string, currentFamilyId: string): Promise<ActiveSession[]> {
    const now = new Date();

    // Each live session has exactly one unused, unrevoked token: its newest one.
    const latest = await this.deps.db
      .select({
        familyId: schema.refreshTokens.familyId,
        userAgent: schema.refreshTokens.userAgent,
        ipAddress: schema.refreshTokens.ipAddress,
        lastActiveAt: schema.refreshTokens.createdAt,
      })
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          isNull(schema.refreshTokens.usedAt),
          isNull(schema.refreshTokens.revokedAt),
          gt(schema.refreshTokens.expiresAt, now),
        ),
      )
      .orderBy(desc(schema.refreshTokens.createdAt))
      .limit(100);

    if (latest.length === 0) return [];

    const starts = await this.deps.db
      .select({
        familyId: schema.refreshTokens.familyId,
        signedInAt: min(schema.refreshTokens.createdAt),
      })
      .from(schema.refreshTokens)
      .where(
        inArray(
          schema.refreshTokens.familyId,
          latest.map((row) => row.familyId),
        ),
      )
      .groupBy(schema.refreshTokens.familyId);
    const signedInAt = new Map(starts.map((row) => [row.familyId, row.signedInAt]));

    return latest.map((row) => ({
      id: row.familyId,
      current: row.familyId === currentFamilyId,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      signedInAt: new Date(signedInAt.get(row.familyId) ?? row.lastActiveAt).toISOString(),
      lastActiveAt: row.lastActiveAt.toISOString(),
    }));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.deps.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(schema.refreshTokens.familyId, familyId), isNull(schema.refreshTokens.revokedAt)),
      );
  }

  /** Revokes one of the user's own sessions. Returns false if it doesn't exist or isn't theirs. */
  async revokeOne(userId: string, familyId: string): Promise<boolean> {
    const rows = await this.deps.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.familyId, familyId),
          eq(schema.refreshTokens.userId, userId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      )
      .returning({ id: schema.refreshTokens.id });
    return rows.length > 0;
  }

  async revokeOthers(userId: string, currentFamilyId: string): Promise<void> {
    await this.deps.db
      .update(schema.refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          ne(schema.refreshTokens.familyId, currentFamilyId),
          isNull(schema.refreshTokens.revokedAt),
        ),
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
