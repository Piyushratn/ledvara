import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema } from "@ledvara/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { Dependencies } from "../health/dependencies.js";

export interface AuditInput {
  orgId: string | null;
  actorType: "user" | "api_key" | "system";
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export interface AuditEventView {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(Dependencies) private readonly deps: Dependencies) {}

  /** Never throws: a failed audit write must not break the user's action. */
  async record(event: AuditInput): Promise<void> {
    try {
      await this.deps.db.insert(schema.auditEvents).values({
        orgId: event.orgId,
        actorType: event.actorType,
        actorId: event.actorId,
        action: event.action,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        metadata: event.metadata ?? {},
        ipAddress: event.ip ?? null,
      });
    } catch (error) {
      this.logger.error({ err: error, action: event.action }, "Failed to write audit event");
    }
  }

  /** Newest first. The cursor is "<iso timestamp>|<id>" encoded as base64url. */
  async list(
    orgId: string,
    limit: number,
    cursor: string | null,
  ): Promise<{ data: AuditEventView[]; nextCursor: string | null }> {
    const conditions = [eq(schema.auditEvents.orgId, orgId)];
    if (cursor) {
      const [ts, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
      const at = new Date(ts ?? "");
      if (ts && id && !Number.isNaN(at.getTime())) {
        const older = or(
          lt(schema.auditEvents.createdAt, at),
          and(eq(schema.auditEvents.createdAt, at), lt(schema.auditEvents.id, id)),
        );
        if (older) conditions.push(older);
      }
    }

    const rows = await this.deps.db
      .select()
      .from(schema.auditEvents)
      .where(and(...conditions))
      .orderBy(desc(schema.auditEvents.createdAt), desc(schema.auditEvents.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString("base64url")
        : null;

    return {
      data: page.map((row) => ({
        id: row.id,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata,
        createdAt: row.createdAt,
      })),
      nextCursor,
    };
  }
}
