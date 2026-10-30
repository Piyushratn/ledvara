import { Inject, Injectable } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "../errors/app-error.js";
import { ErrorCodes } from "../errors/error-codes.js";
import { Dependencies } from "../health/dependencies.js";
import { generateApiKey } from "./api-key-token.js";
import type { CreateApiKeyInput } from "./api-keys.schemas.js";

export interface ApiKeyView {
  id: string;
  name: string;
  environment: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const MAX_ACTIVE_KEYS_PER_ORG = 25;

@Injectable()
export class ApiKeysService {
  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  /** The full key is returned here and never again. */
  async create(
    orgId: string,
    actorId: string,
    input: CreateApiKeyInput,
  ): Promise<ApiKeyView & { key: string }> {
    const active = await this.deps.db
      .select({ id: schema.apiKeys.id })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt)));
    if (active.length >= MAX_ACTIVE_KEYS_PER_ORG) {
      throw new AppError(409, ErrorCodes.Conflict, "Too many active API keys. Revoke one first.");
    }

    const generated = generateApiKey();
    const [row] = await this.deps.db
      .insert(schema.apiKeys)
      .values({
        orgId,
        name: input.name,
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        scopes: [...new Set(input.scopes)],
        createdBy: actorId,
      })
      .returning();
    if (!row) {
      throw new AppError(500, ErrorCodes.InternalError, "Could not create the API key.");
    }
    return { ...this.toView(row), key: generated.key };
  }

  async list(orgId: string): Promise<ApiKeyView[]> {
    const rows = await this.deps.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.orgId, orgId))
      .orderBy(schema.apiKeys.createdAt);
    return rows.map((row) => this.toView(row));
  }

  async revoke(orgId: string, keyId: string): Promise<void> {
    const [row] = await this.deps.db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiKeys.id, keyId),
          eq(schema.apiKeys.orgId, orgId),
          isNull(schema.apiKeys.revokedAt),
        ),
      )
      .returning({ id: schema.apiKeys.id });
    if (!row) {
      throw new AppError(404, ErrorCodes.NotFound, "API key not found.");
    }
  }

  /** Replaces a key: same name and scopes, new secret. The old key stops working immediately. */
  async rotate(
    orgId: string,
    keyId: string,
    actorId: string,
  ): Promise<ApiKeyView & { key: string }> {
    return this.deps.db.transaction(async (tx) => {
      const [old] = await tx
        .update(schema.apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.apiKeys.id, keyId),
            eq(schema.apiKeys.orgId, orgId),
            isNull(schema.apiKeys.revokedAt),
          ),
        )
        .returning();
      if (!old) {
        throw new AppError(404, ErrorCodes.NotFound, "API key not found.");
      }

      const generated = generateApiKey();
      const [row] = await tx
        .insert(schema.apiKeys)
        .values({
          orgId,
          name: old.name,
          keyPrefix: generated.prefix,
          keyHash: generated.hash,
          scopes: old.scopes,
          createdBy: actorId,
        })
        .returning();
      if (!row) {
        throw new AppError(500, ErrorCodes.InternalError, "Could not rotate the API key.");
      }
      return { ...this.toView(row), key: generated.key };
    });
  }

  private toView(row: typeof schema.apiKeys.$inferSelect): ApiKeyView {
    return {
      id: row.id,
      name: row.name,
      environment: row.environment,
      prefix: row.keyPrefix,
      scopes: row.scopes,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    };
  }
}
