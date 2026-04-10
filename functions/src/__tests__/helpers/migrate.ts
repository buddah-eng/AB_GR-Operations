/**
 * Migration Runner
 *
 * Reads all .sql files from src/db/migrations/ in lexicographic order
 * and executes each against the provided pool.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { Pool } from "pg";

const MIGRATIONS_DIR = join(__dirname, "../../db/migrations");

/**
 * Runs all migrations in order against the provided pool.
 * Throws on any SQL error with the file name and message.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await pool.query(sql);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${file} failed: ${message}`);
    }
  }
}
