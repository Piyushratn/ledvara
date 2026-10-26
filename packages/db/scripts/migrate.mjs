import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const direction = process.argv[2] === "down" ? "down" : "up";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Copy .env.example to packages/db/.env first.");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));

const applied = await runner({
  databaseUrl,
  dir: path.join(here, "..", "migrations"),
  direction,
  count: direction === "down" ? 1 : Infinity,
  migrationsTable: "schema_migrations",
  log: (message) => console.log(message),
});

console.log(
  applied.length === 0
    ? "No migrations to run."
    : `Ran ${applied.length} migration(s): ${applied.map((m) => m.name).join(", ")}`,
);
