import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { Dependencies } from "../health/dependencies.js";
import { MailerService } from "../mail/mailer.service.js";
import { PasswordService } from "./password.service.js";
import { generateToken, hashToken } from "./tokens.js";

const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly appBaseUrl = loadEnv().APP_BASE_URL;

  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(MailerService) private readonly mailer: MailerService,
  ) {}

  async requestReset(email: string): Promise<void> {
    try {
      const [user] = await this.deps.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (!user) return;

      const token = generateToken();
      await this.deps.db.insert(schema.passwordResetTokens).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      });
      const link = `${this.appBaseUrl}/reset-password?token=${token}`;
      await this.mailer.send(
        email,
        "Reset your Ledvara password",
        `Use this link within 1 hour to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email. Your password has not changed.`,
      );
    } catch (error) {
      // The response must be identical whatever happens here.
      this.logger.error({ err: error }, "Failed to process password reset request");
    }
  }

  /** Returns the id of the user whose password was changed. */
  async resetPassword(token: string, newPassword: string): Promise<string> {
    const passwordHash = await this.passwords.hash(newPassword);
    const now = new Date();

    return this.deps.db.transaction(async (tx) => {
      // One atomic UPDATE makes the token single-use, even with concurrent requests.
      const [row] = await tx
        .update(schema.passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(schema.passwordResetTokens.tokenHash, hashToken(token)),
            isNull(schema.passwordResetTokens.usedAt),
            gt(schema.passwordResetTokens.expiresAt, now),
          ),
        )
        .returning({ userId: schema.passwordResetTokens.userId });

      if (!row) {
        throw new AppError(
          400,
          "invalid_or_expired_token",
          "This reset link is invalid or has expired.",
        );
      }

      await tx
        .update(schema.users)
        .set({
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          emailVerifiedAt: now,
        })
        .where(eq(schema.users.id, row.userId));

      // Any other unused reset links for this user are now void.
      await tx
        .update(schema.passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(schema.passwordResetTokens.userId, row.userId),
            isNull(schema.passwordResetTokens.usedAt),
          ),
        );

      // Log out every device: whoever knew the old password must lose access.
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: now })
        .where(
          and(eq(schema.refreshTokens.userId, row.userId), isNull(schema.refreshTokens.revokedAt)),
        );

      return row.userId;
    });
  }
}
