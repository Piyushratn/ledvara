import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { Dependencies } from "../health/dependencies.js";
import { MailerService } from "../mail/mailer.service.js";
import type { LoginInput, SignUpInput } from "./auth.schemas.js";
import { signAccessToken } from "./jwt.js";
import { PasswordService } from "./password.service.js";
import { generateToken, hashToken } from "./tokens.js";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RequestMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: { id: string; email: string; fullName: string | null };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly env = loadEnv();
  // Verified against when the email is unknown, so timing does not reveal which emails exist.
  private readonly dummyHash: Promise<string>;

  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(MailerService) private readonly mailer: MailerService,
  ) {
    this.dummyHash = this.passwords.hash("dummy-password-used-only-for-timing");
  }

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
        const link = `${this.env.APP_BASE_URL}/verify-email?token=${token}`;
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

  async login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
    const [user] = await this.deps.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);

    const passwordOk = await this.passwords.verify(
      user?.passwordHash ?? (await this.dummyHash),
      input.password,
    );

    if (!user || !passwordOk) {
      throw new AppError(401, "invalid_credentials", "Incorrect email or password.");
    }
    if (!user.emailVerifiedAt) {
      throw new AppError(403, "email_not_verified", "Please verify your email before logging in.");
    }

    // A login starts a new session family. Rotation (next step) keeps the same family id.
    const familyId = randomUUID();
    const refreshToken = generateToken();
    await this.deps.db.insert(schema.refreshTokens).values({
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ipAddress: meta.ip,
    });

    const accessToken = await signAccessToken(
      this.env.JWT_SECRET,
      { userId: user.id, sessionId: familyId },
      this.env.ACCESS_TOKEN_TTL_SECONDS,
    );

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.env.ACCESS_TOKEN_TTL_SECONDS,
      user: { id: user.id, email: user.email, fullName: user.fullName },
    };
  }
}
