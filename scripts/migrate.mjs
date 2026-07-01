// ============================================================================
// One-shot schema migration. Applies db/1_init_schema.sql to the database in
// DATABASE_URL, so you don't need psql installed. Idempotent (the SQL is all
// CREATE/ALTER … IF NOT EXISTS), so it's safe to re-run.
//
//   DATABASE_URL="postgres://…" npm run migrate
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ DATABASE_URL is not set. Set it and re-run (see .env.example / DEPLOY.md).");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, "..", "db", "1_init_schema.sql");
const sql = readFileSync(schemaPath, "utf8");

// Match the SSL behaviour of the runtime store (src/lib/db/postgres.ts).
const ssl =
  process.env.PGSSL === "disable"
    ? false
    : /sslmode=require|neon|supabase|render|railway|amazonaws/i.test(url)
      ? { rejectUnauthorized: false }
      : undefined;

const client = new pg.Client({ connectionString: url, ssl });

try {
  await client.connect();
  await client.query(sql);
  const redacted = url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@");
  console.log(`✓ Schema applied to ${redacted}`);
} catch (err) {
  console.error("✗ Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
