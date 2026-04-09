/**
 * Test Database Helper
 *
 * Spins up a disposable Postgres 16 container via Testcontainers,
 * runs all migrations, and provides a clean database for each test suite.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type QueryResult } from "pg";
import { runMigrations } from "./migrate";

export interface TestDatabase {
  readonly connectionString: string;
  readonly pool: Pool;
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ) => Promise<QueryResult<T>>;
  teardown: () => Promise<void>;
}

let container: StartedPostgreSqlContainer | null = null;

/**
 * Creates a fresh Postgres 16 database in a Docker container,
 * runs all migrations, and returns a connected pool.
 *
 * Call teardown() when done to stop the container.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("gr_ops_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const connectionString = container.getConnectionUri();

  const pool = new Pool({ connectionString });

  // Run all migrations
  await runMigrations(pool);

  return {
    connectionString,
    pool,
    query: <T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: unknown[]
    ) => pool.query<T>(text, params),
    teardown: async () => {
      await pool.end();
      if (container) {
        await container.stop();
        container = null;
      }
    },
  };
}
