import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { Dependencies } from "../health/dependencies.js";
import { MailerService } from "../mail/mailer.service.js";
import type { SignUpInput } from "./auth.schemas.js";
import { PasswordService } from "./password.service.js";
import { generateToken, hashToken } from "./tokens.js";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly appBaseUrl = loadEnv().APP_BASE_URL;

  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(MailerService) private readonly mailer: MailerService,
  ) {}

  async signUp(input: SignUpInput): Promise<void> {
    // Hash even when the email exists, so both cases take about the same time.
    const passwordHash = await this.passwords.hash(input.password);

    const [created] = await this.deps.db
      .insert(schema.users)
      .values({ email: input.email, passwordHash, fullName: input.fullName ?? null })
      .onConflictDoNothing({ target: schema.users.email })
      .returning({ id: schema.users.id });

    try {
      if (created) {
        const token = generateToken();
        await this.deps.db.insert(schema.emailVerificationTokens).values({
          userId: created.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
        });
        const link = `${this.appBaseUrl}/verify-email?token=${token}`;
        await this.mailer.send(
          input.email,
          "Verify your Ledvara email",
          `Welcome to Ledvara (sandbox, simulated money only).\n\nVerify your email within 24 hours:\n${link}\n\nIf you did not sign up, ignore this email.`,
        );
      } else {
        await this.mailer.send(
          input.email,
          "Someone tried to sign up with your email",
          "Someone tried to create a Ledvara account with this email, but an account already exists.\n\nIf this was you, log in or reset your password. If not, you can ignore this email.",
        );
      }
    } catch (error) {
      // The API response must not depend on mail success (and must not leak it).
      this.logger.error({ err: error }, "Failed to send sign-up email");
    }
  }

  async verifyEmail(token: string): Promise<void> {
    const now = new Date();
    await this.deps.db.transaction(async (tx) => {
      // One atomic UPDATE makes the token single-use, even with concurrent clicks.
      const [row] = await tx
        .update(schema.emailVerificationTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(schema.emailVerificationTokens.tokenHash, hashToken(token)),
            isNull(schema.emailVerificationTokens.usedAt),
            gt(schema.emailVerificationTokens.expiresAt, now),
          ),
        )
        .returning({ userId: schema.emailVerificationTokens.userId });

      if (!row) {
        throw new AppError(
          400,
          "invalid_or_expired_token",
          "This verification link is invalid or has expired.",
        );
      }

      await tx
        .update(schema.users)
        .set({ emailVerifiedAt: now })
        .where(eq(schema.users.id, row.userId));
    });
  }
}
