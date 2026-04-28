import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { runScript, queryJson, execute } from "./client.js";
import { ensureConfigDir } from "../lib/config.js";
import { log } from "../lib/logging.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function columnExists(table: string, column: string): boolean {
  const rows = queryJson<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  if (!columnExists(table, column)) {
    execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function migrate(): void {
  ensureConfigDir();
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");
  runScript(schema);
  // Column migrations for tables that may already exist
  addColumnIfMissing("activities", "equivalent_distance_m", "REAL");
  addColumnIfMissing("athlete", "lthr", "INTEGER");
  addColumnIfMissing("athlete", "threshold_pace_sec_per_km", "REAL");
  addColumnIfMissing("athlete", "profile_source", "TEXT");
  log.success("Database schema initialized");
}
