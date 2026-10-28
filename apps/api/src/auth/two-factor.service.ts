import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { loadEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { Dependencies } from "../health/dependencies.js";
import { PasswordService } from "./password.service.js";
import { hashToken } from "./tokens.js";
import { base32Decode, base32Encode, buildOtpauthUrl, verifyTotp } from "./totp.js";
import {
  CHALLENGE_TTL_SECONDS,
  signChallenge,
  verifyChallenge,
  type ChallengeData,
} from "./two-factor-challenge.js";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "./two-factor-crypto.js";

const ISSUER = "Ledvara";
const BACKUP_CODE_COUNT = 10;

export type TwoFactorChallengeData = ChallengeData;

function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    // 10 random bytes = 80 bits = exactly 16 base32 characters.
    const raw = base32Encode(randomBytes(10)).toLowerCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/gu, "");
}

@Injectable()
export class TwoFactorService {
  private readonly env = loadEnv();

  constructor(
    @Inject(Dependencies) private readonly deps: Dependencies,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  createChallenge(userId: string, email: string): { challengeToken: string; expiresIn: number } {
    return {
      challengeToken: signChallenge(this.env.JWT_SECRET, { userId, email }, Date.now()),
      expiresIn: CHALLENGE_TTL_SECONDS,
    };
  }

  readChallenge(token: string): TwoFactorChallengeData {
    const data = verifyChallenge(this.env.JWT_SECRET, token, Date.now());
    if (!data) {
      throw new AppError(
        401,
        "invalid_challenge",
        "This login attempt has expired. Please log in again.",
      );
    }
    return data;
  }

  async setup(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const [user] = await this.deps.db
      .select({ email: schema.users.email, enabledAt: schema.users.twoFactorEnabledAt })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) {
      throw new AppError(401, "unauthorized", "Account no longer exists.");
    }
    if (user.enabledAt) {
      throw new AppError(
        409,
        "two_factor_already_enabled",
        "Two-factor authentication is already on.",
      );
    }

    const secret = base32Encode(randomBytes(20));
    // Stored but inactive until the first code is confirmed in enable().
    await this.deps.db
      .update(schema.users)
      .set({
        twoFactorSecretEnc: encryptSecret(secret, this.key(), userId),
        twoFactorLastStep: null,
      })
      .where(and(eq(schema.users.id, userId), isNull(schema.users.twoFactorEnabledAt)));

    return {
      secret,
      otpauthUrl: buildOtpauthUrl({ issuer: ISSUER, account: user.email, secret }),
    };
  }

  async enable(userId: string, code: string): Promise<string[]> {
    const [user] = await this.deps.db
      .select({
        secretEnc: schema.users.twoFactorSecretEnc,
        enabledAt: schema.users.twoFactorEnabledAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) {
      throw new AppError(401, "unauthorized", "Account no longer exists.");
    }
    if (user.enabledAt) {
      throw new AppError(
        409,
        "two_factor_already_enabled",
        "Two-factor authentication is already on.",
      );
    }
    if (!user.secretEnc) {
      throw new AppError(409, "two_factor_not_started", "Start setup before enabling.");
    }

    const secret = decryptSecret(user.secretEnc, this.key(), userId);
    const step = verifyTotp(base32Decode(secret), code, Date.now());
    if (step === null) {
      throw new AppError(400, "invalid_two_factor_code", "That code is not correct.");
    }

    const backupCodes = generateBackupCodes();
    const now = new Date();
    await this.deps.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.users)
        .set({ twoFactorEnabledAt: now, twoFactorLastStep: step })
        .where(and(eq(schema.users.id, userId), isNull(schema.users.twoFactorEnabledAt)))
        .returning({ id: schema.users.id });
      if (!updated) {
        throw new AppError(
          409,
          "two_factor_already_enabled",
          "Two-factor authentication is already on.",
        );
      }
      await tx
        .delete(schema.twoFactorBackupCodes)
        .where(eq(schema.twoFactorBackupCodes.userId, userId));
      await tx.insert(schema.twoFactorBackupCodes).values(
        backupCodes.map((backupCode) => ({
          userId,
          codeHash: hashToken(normalizeBackupCode(backupCode)),
        })),
      );
    });

    return backupCodes;
  }

  /** Accepts a TOTP code (once per time step) or an unused backup code. */
  async verifySecondFactor(userId: string, rawCode: string): Promise<boolean> {
    const code = rawCode.trim();
    const [user] = await this.deps.db
      .select({
        secretEnc: schema.users.twoFactorSecretEnc,
        enabledAt: schema.users.twoFactorEnabledAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user?.enabledAt || !user.secretEnc) return false;

    if (/^\d{6}$/u.test(code)) {
      const secret = decryptSecret(user.secretEnc, this.key(), userId);
      const step = verifyTotp(base32Decode(secret), code, Date.now());
      if (step === null) return false;
      // Atomic: a given time step can be accepted only once (no replay).
      const [claimed] = await this.deps.db
        .update(schema.users)
        .set({ twoFactorLastStep: step })
        .where(
          and(
            eq(schema.users.id, userId),
            or(isNull(schema.users.twoFactorLastStep), lt(schema.users.twoFactorLastStep, step)),
          ),
        )
        .returning({ id: schema.users.id });
      return Boolean(claimed);
    }

    return this.useBackupCode(userId, code);
  }

  async disable(userId: string, password: string, code: string): Promise<void> {
    const [user] = await this.deps.db
      .select({
        passwordHash: schema.users.passwordHash,
        enabledAt: schema.users.twoFactorEnabledAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) {
      throw new AppError(401, "unauthorized", "Account no longer exists.");
    }
    if (!user.enabledAt) {
      throw new AppError(409, "two_factor_not_enabled", "Two-factor authentication is not on.");
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new AppError(403, "invalid_password", "Incorrect password.");
    }
    if (!(await this.verifySecondFactor(userId, code))) {
      throw new AppError(403, "invalid_two_factor_code", "That code is not correct.");
    }

    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ twoFactorSecretEnc: null, twoFactorEnabledAt: null, twoFactorLastStep: null })
        .where(eq(schema.users.id, userId));
      await tx
        .delete(schema.twoFactorBackupCodes)
        .where(eq(schema.twoFactorBackupCodes.userId, userId));
    });
  }

  private async useBackupCode(userId: string, code: string): Promise<boolean> {
    const normalized = normalizeBackupCode(code);
    if (normalized.length !== 16) return false;
    const [row] = await this.deps.db
      .update(schema.twoFactorBackupCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.twoFactorBackupCodes.userId, userId),
          eq(schema.twoFactorBackupCodes.codeHash, hashToken(normalized)),
          isNull(schema.twoFactorBackupCodes.usedAt),
        ),
      )
      .returning({ id: schema.twoFactorBackupCodes.id });
    return Boolean(row);
  }

  private key(): Buffer {
    return parseEncryptionKey(process.env.TWO_FACTOR_ENCRYPTION_KEY);
  }
}
