/**
 * PostgreSQL Connection Pool
 *
 * Single shared pool for the entire application.
 * Reads connection config from environment variables.
 * Provides query helpers and transaction support.
 */

import { Pool, type PoolClient, type QueryResult } from "pg";
import * as logger from "firebase-functions/logger";

// --- Connection pool ---

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST ?? "localhost",
      port: parseInt(process.env.DB_PORT ?? "5432", 10),
      database: process.env.DB_NAME ?? "gr_ops",
      user: process.env.DB_USER ?? "gr_ops",
      password: process.env.DB_PASSWORD ?? "",
      ssl: process.env.NODE_ENV === "test"
        ? false
        : process.env.DB_SSL === "false"
          ? false
          : { rejectUnauthorized: false },
      max: parseInt(process.env.DB_POOL_MAX ?? "10", 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on("error", (err) => {
      logger.error("Unexpected Postgres pool error", { error: err.message });
    });
  }

  return pool;
}

// --- Query helpers ---

/**
 * Execute a parameterized query against the pool.
 */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await getPool().query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 200) {
    logger.warn("Slow query detected", { text: text.slice(0, 100), duration, rows: result.rowCount });
  }

  return result;
}

/**
 * Execute a callback within a Postgres transaction.
 * Automatically commits on success, rolls back on error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the pool. Call on process exit.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Replace the pool instance (for testing).
 */
export function setPool(newPool: Pool): void {
  pool = newPool;
}
