import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error("Usage: pnpm --filter @ledvara/db migrate:create <snake_case_name>");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "migrations");
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[-:T.Z]/g, "")
  .slice(0, 14);
const file = path.join(dir, `${stamp}_${name}.sql`);
fs.writeFileSync(file, "-- Up Migration\n\n-- Down Migration\n");
console.log(`Created ${file}`);
