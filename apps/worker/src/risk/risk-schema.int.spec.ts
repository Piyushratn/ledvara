import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../../packages/db/migrations");

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let orgId: string;

function upPart(file: string): string {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const up = sql.search(/--\s*Up Migration/iu);
  const down = sql.search(/--\s*Down Migration/iu);
  if (up === -1) return sql;
  return sql.slice(up, down === -1 ? undefined : down);
}

async function newTransaction(): Promise<string> {
  const rows = await pool.query<{ id: string }>(
    "INSERT INTO transactions (org_id, kind) VALUES ($1, 'transfer') RETURNING id",
    [orgId],
  );
  return rows.rows[0]?.id ?? "";
}

async function assess(transactionId: string, score = 70): Promise<string> {
  const rows = await pool.query<{ id: string }>(
    `INSERT INTO risk_assessments
       (org_id, transaction_id, rules_version, score, level, flagged, reasons, inputs)
     VALUES ($1, $2, 'test', $3, 'high', true, '[]'::jsonb, '{}'::jsonb) RETURNING id`,
    [orgId, transactionId, score],
  );
  return rows.rows[0]?.id ?? "";
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 3 });
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) await pool.query(upPart(file));
  const org = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ('Acme', $1) RETURNING id",
    [`acme-${randomUUID()}`],
  );
  orgId = org.rows[0]?.id ?? "";
});

afterAll(async () => {
  await pool.end();
  await container.stop();
});

describe("risk_assessments", () => {
  it("stores one assessment per transaction", async () => {
    const txn = await newTransaction();
    await assess(txn);
    await expect(assess(txn)).rejects.toThrow(/duplicate key|unique/i);
  });

  it("rejects scores outside 0-100", async () => {
    await expect(assess(await newTransaction(), 101)).rejects.toThrow(/check constraint/i);
    await expect(assess(await newTransaction(), -1)).rejects.toThrow(/check constraint/i);
  });

  it("is append-only: UPDATE and DELETE are rejected and the row is unchanged", async () => {
    const id = await assess(await newTransaction(), 80);
    await expect(
      pool.query("UPDATE risk_assessments SET score = 1 WHERE id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM risk_assessments WHERE id = $1", [id])).rejects.toThrow(
      /append-only/,
    );
    const rows = await pool.query<{ score: number }>(
      "SELECT score FROM risk_assessments WHERE id = $1",
      [id],
    );
    expect(rows.rows[0]?.score).toBe(80);
  });
});

describe("review_items", () => {
  async function review(): Promise<{ id: string; txn: string }> {
    const txn = await newTransaction();
    const assessmentId = await assess(txn);
    const rows = await pool.query<{ id: string }>(
      "INSERT INTO review_items (org_id, transaction_id, assessment_id) VALUES ($1, $2, $3) RETURNING id",
      [orgId, txn, assessmentId],
    );
    return { id: rows.rows[0]?.id ?? "", txn };
  }

  it("starts pending with no decision time", async () => {
    const { id } = await review();
    const rows = await pool.query<{ status: string; decided_at: Date | null }>(
      "SELECT status, decided_at FROM review_items WHERE id = $1",
      [id],
    );
    expect(rows.rows[0]).toMatchObject({ status: "pending", decided_at: null });
  });

  it("cannot be half-decided", async () => {
    const { id } = await review();
    await expect(
      pool.query("UPDATE review_items SET status = 'approved' WHERE id = $1", [id]),
    ).rejects.toThrow(/review_items_decision_consistent/);
    await expect(
      pool.query("UPDATE review_items SET decided_at = now() WHERE id = $1", [id]),
    ).rejects.toThrow(/review_items_decision_consistent/);
  });

  it("accepts a complete decision and rejects unknown statuses", async () => {
    const { id } = await review();
    await pool.query(
      "UPDATE review_items SET status = 'rejected', decided_at = now(), reviewer_note = 'looks wrong' WHERE id = $1",
      [id],
    );
    await expect(
      pool.query("UPDATE review_items SET status = 'maybe', decided_at = now() WHERE id = $1", [
        id,
      ]),
    ).rejects.toThrow(/check constraint/i);
  });

  it("allows only one review item per transaction", async () => {
    const { txn } = await review();
    const assessmentId = (
      await pool.query<{ id: string }>(
        "SELECT id FROM risk_assessments WHERE transaction_id = $1",
        [txn],
      )
    ).rows[0]?.id;
    await expect(
      pool.query(
        "INSERT INTO review_items (org_id, transaction_id, assessment_id) VALUES ($1, $2, $3)",
        [orgId, txn, assessmentId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
