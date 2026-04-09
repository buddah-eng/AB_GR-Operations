# Integration Testing Infrastructure

> Testcontainers-based integration test framework that runs every SQL migration against a real Postgres instance,
> verifies triggers fire, constraints enforce, indexes are used, and the full application stack (API → RBAC →
> Postgres → audit trigger → event log) works end-to-end. Unit tests mock the database; integration tests prove
> the database works. Both run in CI. Developers need only Docker installed to run integration tests locally.

---

## Overview

The platform's correctness depends on Postgres features that cannot be verified with mocked queries: triggers that read session-level variables (`current_setting`), `CREATE RULE` for append-only audit tables, GIN indexes on JSONB columns, FK constraints across tables, CHECK constraints on enum columns, and the `previous_version_id` chain for ontology versioning.

Unit tests (Vitest with mocked `query()`) verify application logic in isolation — they run in <1s with no dependencies. Integration tests (Vitest with Testcontainers) verify that the application and database work together correctly — they run in ~10-30s and require Docker.

**Testcontainers** (`@testcontainers/postgresql`) programmatically starts a disposable Postgres container per test suite, runs migrations, executes tests against the real database, and tears everything down. Each suite gets a clean database — no shared state, no flaky tests from leftover data.

**Phase:** 1 — Foundation. This is test infrastructure that all other phases depend on for verification. It must exist before any PRD's integration test plan can be executed.

---

## Full Specification

### 1. Technology Choice

**Purpose:** Define the integration test stack and justify the choice.

**Detail:**

| Component | Choice | Why |
|-----------|--------|-----|
| Container runtime | Docker | Industry standard. Required for Testcontainers. Available on all CI platforms. |
| Test container library | `@testcontainers/postgresql` | Programmatic Postgres lifecycle from Node.js. Auto-pulls image, assigns random port, auto-cleanup. |
| Postgres version | 16 (matching production target) | Version parity prevents "works on my machine" SQL issues. |
| Test runner | Vitest (existing) | Same runner for unit and integration tests. Separate config file for isolation. |
| Migration runner | Custom (sequential SQL file execution) | Migrations are plain `.sql` files. Run them in order via `pg` client. No ORM dependency. |

**Alternatives considered:**

| Alternative | Why rejected |
|-------------|-------------|
| `pg-mem` / `PGlite` | Cannot emulate triggers (`current_setting`, `CREATE RULE`, `AFTER INSERT OR UPDATE OR DELETE`), GIN indexes, or `INET` types. Would miss the exact bugs integration tests exist to catch. |
| Shared cloud-hosted test DB | Network latency in tests. Shared state between developers. Cost. Secrets management overhead. |
| SQLite in-memory | Different SQL dialect. No JSONB, no triggers, no GIN indexes. Not Postgres. |

**Acceptance Criteria:**
- [ ] `@testcontainers/postgresql` and `pg` are the only additional dependencies
- [ ] Postgres 16 container starts and is reachable within 10 seconds
- [ ] No cloud credentials or external services required to run integration tests

---

### 2. Test Infrastructure

**Purpose:** Define the shared setup that all integration test suites use.

**Dependencies:** `data/postgres-schema.md` (migration files)

**Detail:**

#### 2.1 Test Helper Module

File: `functions/src/__tests__/helpers/test-db.ts`

```typescript
interface TestDatabase {
  connectionString: string;
  pool: Pool;
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
  teardown: () => Promise<void>;
}

async function createTestDatabase(): Promise<TestDatabase>
```

Lifecycle:
1. Start a `PostgreSqlContainer` via Testcontainers (Postgres 16)
2. Create a `Pool` connected to the container
3. Run all migration files in order (`001-foundation.sql`, `002-core-services.sql`, ...)
4. Return the `TestDatabase` handle
5. On `teardown()`: close the pool, stop the container

#### 2.2 Migration Runner

File: `functions/src/__tests__/helpers/migrate.ts`

```typescript
async function runMigrations(pool: Pool): Promise<void>
```

- Reads all `.sql` files from `src/db/migrations/` in lexicographic order
- Executes each file as a single SQL statement against the pool
- Throws on any SQL error with the file name and error message
- Logs elapsed time per migration

#### 2.3 Seed Helpers

File: `functions/src/__tests__/helpers/seed.ts`

Reusable functions for inserting test data:

```typescript
async function seedRole(pool: Pool, key: string, name: string, priority: number): Promise<string>
async function seedUser(pool: Pool, email: string, roleKey: string): Promise<string>
async function seedConcept(pool: Pool, key: string, name: string): Promise<string>
async function seedProperty(pool: Pool, conceptKey: string, key: string, type: string): Promise<string>
async function seedGuest(pool: Pool, name: string, overrides?: Record<string, unknown>): Promise<string>
// ... etc for each domain table
```

Each returns the inserted row's UUID. All use parameterized queries.

#### 2.4 Vitest Configuration

File: `functions/vitest.integration.config.ts`

```typescript
export default defineConfig({
  test: {
    globals: true,
    root: ".",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,  // containers take time to start
    hookTimeout: 60_000,  // beforeAll with container startup
    pool: "forks",        // isolate suites (each gets own container)
  },
});
```

#### 2.5 npm Scripts

```json
{
  "test": "vitest run",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "test:all": "vitest run && vitest run --config vitest.integration.config.ts"
}
```

**Acceptance Criteria:**
- [ ] `createTestDatabase()` returns a working pool connected to a fresh Postgres 16 container
- [ ] All migrations run without error on a clean database
- [ ] Each integration test suite starts with an empty (post-migration) database
- [ ] `npm run test:integration` runs all integration tests
- [ ] `npm test` (unit tests) does NOT require Docker
- [ ] Test database is fully cleaned up after suite completes (container stopped)

---

### 3. Schema Verification Tests

**Purpose:** Prove that the migration SQL is valid and the schema matches the PRD specifications.

**Dependencies:** `data/postgres-schema.md`, Section 2 (test infrastructure)

**File:** `functions/src/__tests__/schema.integration.test.ts`

**Detail:**

| Test | What | Acceptance |
|------|------|------------|
| All tables exist | Query `information_schema.tables` for every expected table | Count matches expected (30+ tables) |
| Column types match | Query `information_schema.columns` for each table | Type, nullable, default all match migration SQL |
| FK constraints enforce | INSERT with invalid FK → catch constraint violation error | Error code `23503` (foreign_key_violation) |
| CHECK constraints enforce | INSERT with invalid `actor_type` → catch check violation | Error code `23514` (check_violation) |
| UNIQUE constraints enforce | INSERT duplicate `(key, version)` on ontology_concepts → violation | Error code `23505` (unique_violation) |
| GIN index exists | Query `pg_indexes` for GIN indexes on properties columns | All domain tables have GIN index |
| Partial indexes exist | Query `pg_indexes` for `WHERE NOT archived` conditions | All domain tables have partial index |
| Audit triggers exist | Query `information_schema.triggers` for each table | All ontology + domain tables have `trg_audit` |
| `updated_at` triggers exist | Query triggers for `set_updated_at` | All tables with `updated_at` column have the trigger |
| Append-only rules exist | Query `pg_rules` for audit tables | `no_update_*` and `no_delete_*` rules present |

**Acceptance Criteria:**
- [ ] All 10 schema verification tests pass against a fresh database
- [ ] Tests fail if a migration is broken or incomplete
- [ ] No hardcoded UUIDs or timestamps — all test data generated dynamically

---

### 4. Trigger Verification Tests

**Purpose:** Prove that Postgres triggers fire correctly with and without application-layer session variables.

**Dependencies:** `core/audit-system.md`, Section 2 (test infrastructure)

**File:** `functions/src/__tests__/triggers.integration.test.ts`

**Detail:**

#### 4.1 Ontology Audit Trigger

| Test | Setup | Action | Expected |
|------|-------|--------|----------|
| INSERT fires trigger | Seed a concept | INSERT into `ontology_concepts` | Row in `ontology_audit_log` with `action='INSERT'`, `new_data` populated, `old_data` NULL |
| UPDATE fires trigger | Seed a concept | UPDATE its name | Row with `action='UPDATE'`, both `old_data` and `new_data` populated |
| DELETE fires trigger | Seed a concept | DELETE it | Row with `action='DELETE'`, `old_data` populated, `new_data` NULL |
| Session vars populated | Set `app.actor_id`, `app.actor_type`, `app.change_set` via `SET LOCAL` within a transaction, then INSERT | Audit row has correct `actor_id`, `actor_type`, `change_set` (not `pg_trigger_fallback`) |
| No session vars → fallback | INSERT without setting session vars | Audit row has `actor_id = 'pg_trigger_fallback'`, `actor_type = 'system'` |

#### 4.2 Domain Audit Trigger

| Test | Setup | Action | Expected |
|------|-------|--------|----------|
| Guest INSERT | Seed required FKs | INSERT into `guests` | Row in `domain_audit_log` |
| Guest UPDATE | Seed a guest | UPDATE status | Audit row with old and new status |
| Guest soft-delete | Seed a guest | SET `archived = true` | Audit row captures the archival |

#### 4.3 Append-Only Rules

| Test | Action | Expected |
|------|--------|----------|
| UPDATE on ontology_audit_log | Attempt UPDATE | No rows modified (rule blocks it silently) |
| DELETE on ontology_audit_log | Attempt DELETE | No rows deleted |
| UPDATE on domain_audit_log | Attempt UPDATE | No rows modified |
| DELETE on domain_audit_log | Attempt DELETE | No rows deleted |

**Acceptance Criteria:**
- [ ] All trigger tests pass with a real Postgres instance
- [ ] Session variable propagation verified (actor context flows from application to trigger)
- [ ] Fallback to `pg_trigger_fallback` / `system` verified when no session vars set
- [ ] Append-only rules verified — audit rows cannot be mutated

---

### 5. Constraint & Data Integrity Tests

**Purpose:** Prove that the database rejects invalid data and enforces referential integrity.

**Dependencies:** `data/postgres-schema.md`, `core/rbac-engine.md`, Section 2

**File:** `functions/src/__tests__/constraints.integration.test.ts`

**Detail:**

| Test | Action | Expected |
|------|--------|----------|
| FK: guest with invalid created_by | INSERT guest with non-existent `created_by` UUID | FK violation error |
| FK: pairing with invalid guest_id | INSERT pairing with non-existent `guest_id` | FK violation error |
| FK: permission with invalid role_key | INSERT permission with non-existent `role_key` | FK violation error |
| CHECK: invalid actor_type | INSERT audit row with `actor_type = 'hacker'` | Check violation error |
| CHECK: invalid action | INSERT audit row with `action = 'TRUNCATE'` | Check violation error |
| CHECK: invalid ontology status | INSERT concept with `status = 'invalid'` | Check violation error |
| UNIQUE: duplicate concept key+version | INSERT two concepts with same `(key, version)` | Unique violation error |
| UNIQUE: duplicate permission role+concept | INSERT two permissions with same `(role_key, concept_key)` | Unique violation error |
| NOT NULL: audit change_set | INSERT audit row with NULL `change_set` | Not null violation error |
| Soft delete: archived excluded | INSERT 3 guests, archive 1, SELECT WHERE NOT archived | Returns 2 rows |

**Acceptance Criteria:**
- [ ] All constraint tests pass
- [ ] Each violation produces the correct Postgres error code
- [ ] No silent data corruption — every invalid state is rejected

---

### 6. End-to-End Data Flow Tests

**Purpose:** Prove that the full stack — from Express handler through RBAC, Postgres write, audit trigger, and event logging — works as an integrated system.

**Dependencies:** All Phase 1 and Phase 2 PRDs, Section 2

**File:** `functions/src/__tests__/e2e-flow.integration.test.ts`

**Detail:**

#### 6.1 Create → Audit → Event Chain

1. Seed roles, users, permissions, and a concept
2. Call the domain CRUD create handler (mock Express req/res, real Postgres)
3. Verify: row exists in domain table
4. Verify: audit row exists in `domain_audit_log` with correct actor context
5. Verify: event row exists in `event_log`
6. Verify: `change_set` links audit row and event row

#### 6.2 RBAC Field Filtering with Real Data

1. Seed a guest with 5 properties
2. Seed permissions for role "liaison" with `visible_properties = ['name', 'status']`
3. Query as liaison → verify only `name` and `status` returned
4. Query as director (full access) → verify all 5 properties returned

#### 6.3 Versioning Roundtrip

1. Seed a concept (version 1, active)
2. Update it via versioning service → version 2 active, version 1 deprecated
3. Rollback → version 2 rolled_back, version 1 active
4. Query version history → returns both versions in DESC order
5. Verify: `WHERE status = 'active'` returns exactly one row

#### 6.4 Encryption Roundtrip with Real Storage

1. Seed a guest with encrypted `email` field (via `encryptPiiFields`)
2. SELECT from Postgres → `properties->'email'` is an `EncryptedField` object (not plaintext)
3. Decrypt via `decryptPiiFields` → original email recovered
4. Verify: direct SQL access returns encrypted JSONB, not plaintext

**Acceptance Criteria:**
- [ ] Full create → audit → event chain verified with real Postgres
- [ ] RBAC filtering produces correct results against real data
- [ ] Versioning version chain is queryable and correct
- [ ] Encrypted fields are unreadable via direct SQL

---

### 7. CI Configuration

**Purpose:** Define how integration tests run in CI alongside unit tests.

**Detail:**

#### 7.1 GitHub Actions Workflow

```yaml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd functions && npm ci
      - run: cd functions && npm test

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd functions && npm ci
      - run: cd functions && npm run test:integration
```

No Docker Compose needed — Testcontainers manages the container lifecycle.

#### 7.2 Local Developer Experience

```bash
# Fast feedback (no Docker needed)
npm test

# Full verification (requires Docker)
npm run test:integration

# Everything
npm run test:all
```

**Acceptance Criteria:**
- [ ] CI runs unit and integration tests in separate jobs
- [ ] Integration test failures block merge (same as unit test failures)
- [ ] Local developers can run `npm test` without Docker installed
- [ ] Local developers can run `npm run test:integration` with only Docker as a prerequisite

---

### 8. Test Plan

**Purpose:** Verify the test infrastructure itself works correctly.

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Container starts | Infrastructure | `createTestDatabase()` returns a working connection | `SELECT 1` returns `1` |
| Migrations run | Infrastructure | All `.sql` files execute without error | No SQL errors thrown |
| Seed helpers work | Infrastructure | Each `seed*` function returns a valid UUID | UUID matches format, row exists in table |
| Teardown cleans up | Infrastructure | After `teardown()`, container port is closed | Connection attempt fails |
| Schema tests pass | Integration | All 10 schema verification tests | All pass |
| Trigger tests pass | Integration | All trigger and append-only tests | All pass |
| Constraint tests pass | Integration | All FK/CHECK/UNIQUE/NOT NULL tests | All pass |
| E2E flow tests pass | Integration | Full create→audit→event chain | All pass |
| CI workflow runs | CI | GitHub Actions completes both jobs | Green check |

**Coverage target:** Integration tests cover every Postgres-specific feature referenced in the PRD set: triggers, constraints, indexes, rules, session variables, JSONB operations, versioning chains.

---

### 9. Decisions and Rationale

| Decision | Rationale |
|----------|-----------|
| Testcontainers over Docker Compose | Programmatic lifecycle = no manual `docker-compose up`. Auto-cleanup. Random ports = no conflicts. |
| Separate vitest config | Unit tests stay fast (<1s). Integration tests run separately (~30s). Developers choose what to run. |
| Postgres 16 | Matches production target. Version-specific features (e.g., `gen_random_uuid()` without extension) verified. |
| `pool: "forks"` in vitest config | Each test file gets its own process. Prevents shared state between suites. Each suite can start its own container. |
| Seed helpers over fixtures | Generated data avoids UUID collisions. Parameterized inserts = no SQL injection in tests. |
| No ORM for migrations | Migrations are plain SQL files. Running them directly proves they work as-is. No Knex/Prisma dependency. |
