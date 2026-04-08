# Audit System

> Every mutation in the platform --- API-level or raw SQL --- is captured in one of two audit tables, tagged with actor type and grouped by change set UUID. Postgres triggers guarantee coverage even when someone bypasses the API. Forensic queries and rogue-actor detection close the loop.

---

## Overview

The audit system is the accountability layer for the convention operations platform. It answers three questions: **who changed what?**, **when and why?**, and **did anyone sneak around the API to do it?**

Two recording paths run in parallel. The **application path** writes audit rows from API handlers with full actor context (user ID, session, IP, actor type). The **database path** fires Postgres triggers on every INSERT/UPDATE/DELETE, catching anything the application layer missed --- direct `psql` sessions, migration scripts, runaway cron jobs.

Both paths write to the same pair of tables (`ontology_audit_log` for config/schema changes, `domain_audit_log` for data changes). Both paths stamp every row with a `change_set` UUID so related mutations group together. When the two paths agree, everything is clean. When they disagree, someone bypassed the API, and the platform alerts an admin.

Postgres is the system of record. The audit tables are append-only; no UPDATE or DELETE is permitted on them outside of retention-policy maintenance windows.

The actor types align exactly with the auth system's four methods (`human`, `api_client`, `external_token`, `ai_agent`) plus the implicit `system` actor for cron jobs and migrations. See `auth-system.md` for how each method resolves to an `AuthenticatedUser` + `UserRole` pair; the audit system consumes the result, never the credentials.

**Phase:** 1 --- Foundation (see `_orchestration.md`). Depends on auth system (actor types). Blocks event-log traceability and compliance reporting.

---

## 1. Actor Types

### Purpose

Tag every audited action with a machine-readable actor classification so forensic queries can filter by _how_ the change was made, not just _who_ made it.

### Detail

| Actor Type | Source | Example |
|---|---|---|
| `human` | Firebase OAuth, UI session | Ops manager edits a concept in the admin panel |
| `api_client` | API key header (`x-api-key`) | Warehouse app pushes inventory counts |
| `external_token` | Scoped token in URL or header | Driver confirms pickup via guest link |
| `ai_agent` | MCP delegation token | Personal AI assistant creates a workflow on behalf of a user |
| `system` | Internal --- no auth context | Nightly cron job recalculates rollups; migration script adds a column |

The actor type is set by `authMiddleware()` during request resolution and passed to every service method as part of the `AuditContext` object:

```ts
interface AuditContext {
  actor_id:    string;       // UUID of the user, api key, token, or 'system'
  actor_type:  'human' | 'api_client' | 'external_token' | 'ai_agent' | 'system';
  session_id:  string | null;
  ip_address:  string | null;
  change_set:  string;       // UUID, generated per logical operation
}
```

For Postgres triggers that fire outside an API context (direct SQL), the actor type defaults to `system` and `actor_id` is set to `'pg_trigger_fallback'`. This is the signal used by rogue-actor detection (section 7).

### Acceptance Criteria

- [ ] Every API handler passes a populated `AuditContext` to service methods
- [ ] Actor type is one of the five enum values; Postgres CHECK constraint enforces this
- [ ] Trigger-generated rows default to `system` / `pg_trigger_fallback`
- [ ] Auth-system actor type mapping matches the table above exactly

---

## 2. Audit Log Tables

### Purpose

Store the immutable record of every change to platform configuration (ontology) and domain data in two append-only tables.

### Detail

Two tables, identical structure, separated by concern:

- **`ontology_audit_log`** --- changes to ontology_concepts, ontology_properties, ontology_relationships, page_configs, workflow_configs, roles, permissions, department_access. Anything that defines _how the platform behaves_.
- **`domain_audit_log`** --- changes to runtime/domain data: event records, attendee records, inventory, scheduling, etc. Anything that represents _what happened at a convention_.

```sql
CREATE TABLE ontology_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set    UUID NOT NULL,                        -- groups related changes
  actor_id      TEXT NOT NULL,                         -- user UUID or 'pg_trigger_fallback'
  actor_type    TEXT NOT NULL CHECK (actor_type IN (
                  'human','api_client','external_token','ai_agent','system'
                )),
  action        TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  table_name    TEXT NOT NULL,
  record_id     UUID NOT NULL,
  old_data      JSONB,                                 -- NULL on INSERT
  new_data      JSONB,                                 -- NULL on DELETE
  ip_address    INET,
  session_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ontology_audit_actor   ON ontology_audit_log (actor_id, created_at);
CREATE INDEX idx_ontology_audit_table   ON ontology_audit_log (table_name, created_at);
CREATE INDEX idx_ontology_audit_changeset ON ontology_audit_log (change_set);

CREATE TABLE domain_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set    UUID NOT NULL,
  actor_id      TEXT NOT NULL,
  actor_type    TEXT NOT NULL CHECK (actor_type IN (
                  'human','api_client','external_token','ai_agent','system'
                )),
  action        TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  table_name    TEXT NOT NULL,
  record_id     UUID NOT NULL,
  old_data      JSONB,
  new_data      JSONB,
  ip_address    INET,
  session_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_domain_audit_actor     ON domain_audit_log (actor_id, created_at);
CREATE INDEX idx_domain_audit_table     ON domain_audit_log (table_name, created_at);
CREATE INDEX idx_domain_audit_changeset ON domain_audit_log (change_set);
```

Both tables are protected by a Postgres rule that blocks UPDATE and DELETE:

```sql
CREATE RULE no_update_ontology_audit AS ON UPDATE TO ontology_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_ontology_audit AS ON DELETE TO ontology_audit_log DO INSTEAD NOTHING;
CREATE RULE no_update_domain_audit   AS ON UPDATE TO domain_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_domain_audit   AS ON DELETE TO domain_audit_log DO INSTEAD NOTHING;
```

### Acceptance Criteria

- [ ] Both tables exist with all columns and constraints
- [ ] CHECK constraints reject invalid actor_type or action values
- [ ] UPDATE/DELETE rules prevent mutation of audit rows
- [ ] Indexes support the forensic query patterns in section 6
- [ ] JSONB old_data/new_data correctly capture full row state before/after

---

## 3. Postgres Audit Triggers

### Purpose

Guarantee that every mutation to an ontology table is recorded, even if it bypasses the application layer entirely (direct `psql`, migrations, pg_cron).

### Detail

A single trigger function handles all ontology tables. It reads actor context from session-level variables set by the application layer (via `SET LOCAL`). If those variables are absent, it falls back to `system` / `pg_trigger_fallback`.

```sql
CREATE OR REPLACE FUNCTION audit_ontology_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_actor_id    TEXT;
  v_actor_type  TEXT;
  v_change_set  UUID;
  v_session_id  UUID;
  v_ip          INET;
  v_old_data    JSONB := NULL;
  v_new_data    JSONB := NULL;
BEGIN
  -- Read session-level context set by the application layer
  v_actor_id   := coalesce(current_setting('app.actor_id',   true), 'pg_trigger_fallback');
  v_actor_type := coalesce(current_setting('app.actor_type', true), 'system');
  v_change_set := coalesce(current_setting('app.change_set', true)::UUID, gen_random_uuid());
  v_session_id := current_setting('app.session_id', true)::UUID;
  v_ip         := current_setting('app.ip_address', true)::INET;

  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD);
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'INSERT' THEN
    v_new_data := to_jsonb(NEW);
  END IF;

  INSERT INTO ontology_audit_log (
    change_set, actor_id, actor_type, action,
    table_name, record_id, old_data, new_data,
    ip_address, session_id
  ) VALUES (
    v_change_set, v_actor_id, v_actor_type, TG_OP,
    TG_TABLE_NAME,
    coalesce(NEW.id, OLD.id),
    v_old_data, v_new_data,
    v_ip, v_session_id
  );

  RETURN coalesce(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

The trigger is attached to every ontology table:

```sql
CREATE TRIGGER trg_audit_ontology_concepts
  AFTER INSERT OR UPDATE OR DELETE ON ontology_concepts
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_ontology_properties
  AFTER INSERT OR UPDATE OR DELETE ON ontology_properties
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_ontology_relationships
  AFTER INSERT OR UPDATE OR DELETE ON ontology_relationships
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_page_configs
  AFTER INSERT OR UPDATE OR DELETE ON page_configs
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_workflow_configs
  AFTER INSERT OR UPDATE OR DELETE ON workflow_configs
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_roles
  AFTER INSERT OR UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();

CREATE TRIGGER trg_audit_permissions
  AFTER INSERT OR UPDATE OR DELETE ON permissions
  FOR EACH ROW EXECUTE FUNCTION audit_ontology_trigger();
```

The application layer sets session variables before any write:

```ts
async function withAuditContext(pool: Pool, ctx: AuditContext, fn: (client: PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.actor_id   = '${ctx.actor_id}'`);
    await client.query(`SET LOCAL app.actor_type = '${ctx.actor_type}'`);
    await client.query(`SET LOCAL app.change_set = '${ctx.change_set}'`);
    if (ctx.session_id) await client.query(`SET LOCAL app.session_id = '${ctx.session_id}'`);
    if (ctx.ip_address) await client.query(`SET LOCAL app.ip_address = '${ctx.ip_address}'`);

    await fn(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

An equivalent `audit_domain_trigger()` function and corresponding triggers are created for all domain tables, writing to `domain_audit_log` instead.

### Acceptance Criteria

- [ ] Trigger function compiles and installs without errors
- [ ] Trigger fires on INSERT, UPDATE, and DELETE for every ontology table
- [ ] When session variables are set (API path), audit row contains correct actor context
- [ ] When session variables are absent (direct SQL), audit row defaults to `system` / `pg_trigger_fallback`
- [ ] `old_data` is NULL on INSERT; `new_data` is NULL on DELETE; both populated on UPDATE
- [ ] `withAuditContext` wrapper sets and clears session variables within the transaction

---

## 4. Change Set Grouping

### Purpose

Group related mutations under a single UUID so they can be reviewed, displayed, and rolled back as a logical unit.

### Detail

A change set represents one logical operation from the user's perspective. The application layer generates a single `change_set` UUID at the start of an operation and passes it through `AuditContext` to every write within that operation.

**Examples:**

| User Action | Mutations | Change Set |
|---|---|---|
| "Add concept Vendor with 5 properties and 3 relationships" | 1 INSERT on ontology_concepts + 5 INSERTs on ontology_properties + 3 INSERTs on ontology_relationships | 1 UUID, 9 audit rows |
| "Update page layout" | 1 UPDATE on page_configs | 1 UUID, 1 audit row |
| "Delete role and reassign users" | 1 DELETE on roles + N UPDATEs on user_roles | 1 UUID, N+1 audit rows |

Querying a full change set:

```sql
SELECT action, table_name, record_id, old_data, new_data, created_at
FROM ontology_audit_log
WHERE change_set = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at;
```

**Grouped rollback** uses the change set to reconstruct the inverse operations. The rollback service reads the change set rows in reverse order and applies the inverse: INSERT becomes DELETE, DELETE becomes INSERT (using `old_data`), UPDATE restores `old_data`. Rollback itself creates a new change set, so the rollback is also audited.

```ts
interface ChangeSetSummary {
  change_set:   string;
  actor_id:     string;
  actor_type:   string;
  started_at:   string;   // earliest created_at in set
  ended_at:     string;   // latest created_at in set
  mutation_count: number;
  tables_affected: string[];
}
```

### Acceptance Criteria

- [ ] Every API write operation generates exactly one change_set UUID shared across all audit rows for that operation
- [ ] Change set query returns all related mutations in chronological order
- [ ] Rollback service can reconstruct and apply inverse operations from a change set
- [ ] Rollback creates its own change set (auditing the rollback itself)
- [ ] Change set summary accurately reflects mutation count and affected tables

---

## 5. Event Log Integration

### Purpose

Connect the audit trail (who changed what) to the event bus (what happened next) so the full chain --- mutation to event to workflow execution --- is traceable.

### Detail

The event bus already writes to an `event_log` table on every event publish. The key linkage fields:

```sql
CREATE TABLE event_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,          -- e.g. 'ontology.concept.created'
  source_table    TEXT,                    -- table that triggered the event
  source_record   UUID,                   -- record ID that triggered the event
  change_set      UUID,                   -- matches audit log change_set
  payload         JSONB NOT NULL,
  workflows_triggered UUID[],             -- workflow_config IDs that ran
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_log_source   ON event_log (source_table, source_record);
CREATE INDEX idx_event_log_changeset ON event_log (change_set);
```

The traceability chain:

```
audit_log row (who changed what, when)
  └── change_set UUID
        └── event_log row (which event fired)
              └── workflows_triggered[] (which workflows ran)
                    └── domain_audit_log rows (what the workflows changed)
```

Full-chain query --- from a single audit entry, find everything downstream:

```sql
-- 1. Start from an audit row
WITH audit AS (
  SELECT change_set, table_name, record_id
  FROM ontology_audit_log
  WHERE id = :audit_row_id
),
-- 2. Find events triggered by that change set
events AS (
  SELECT e.id, e.event_type, e.workflows_triggered
  FROM event_log e
  JOIN audit a ON e.change_set = a.change_set
),
-- 3. Find workflow-generated changes
downstream AS (
  SELECT d.*
  FROM domain_audit_log d
  JOIN event_log e ON d.change_set = ANY(
    SELECT unnest(workflows_triggered) FROM events
  )
)
SELECT * FROM downstream ORDER BY created_at;
```

### Acceptance Criteria

- [ ] event_log table includes `change_set` and `source_record` columns
- [ ] Event bus writes matching `change_set` UUID when publishing events caused by audited mutations
- [ ] Full-chain query returns correct downstream workflow effects for a given audit entry
- [ ] Workflow-generated mutations carry their own change_set that links back to the triggering event

---

## 6. Forensics Queries

### Purpose

Provide ready-made queries for incident investigation, compliance audits, and operational debugging.

### Detail

**Query 1: What did user X change between 2am and 4am?**

```sql
SELECT action, table_name, record_id, old_data, new_data, created_at
FROM ontology_audit_log
WHERE actor_id = :user_id
  AND created_at BETWEEN '2026-04-08 02:00:00Z' AND '2026-04-08 04:00:00Z'
ORDER BY created_at;
```

**Query 2: All changes to ontology_concepts in the last 7 days**

```sql
SELECT actor_id, actor_type, action, record_id,
       old_data, new_data, change_set, created_at
FROM ontology_audit_log
WHERE table_name = 'ontology_concepts'
  AND created_at > now() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

**Query 3: Direct DB access detection --- audit rows without matching API-level entries**

This query finds trigger-generated audit rows that were never claimed by an API request. These are mutations that bypassed the application layer.

```sql
SELECT id, actor_id, actor_type, action, table_name, record_id, created_at
FROM ontology_audit_log
WHERE actor_id = 'pg_trigger_fallback'
  AND created_at > now() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

**Query 4: Change set drill-down --- expand a single logical operation**

```sql
SELECT action, table_name, record_id,
       jsonb_pretty(old_data) AS before,
       jsonb_pretty(new_data) AS after,
       created_at
FROM ontology_audit_log
WHERE change_set = :change_set_id
ORDER BY created_at;
```

**Query 5: Most active actors in the last 24 hours**

```sql
SELECT actor_id, actor_type, count(*) AS mutations
FROM ontology_audit_log
WHERE created_at > now() - INTERVAL '24 hours'
GROUP BY actor_id, actor_type
ORDER BY mutations DESC
LIMIT 20;
```

**Query 6: Deleted records recovery**

```sql
SELECT record_id, old_data, actor_id, created_at
FROM ontology_audit_log
WHERE action = 'DELETE'
  AND table_name = :table_name
  AND created_at > now() - INTERVAL '30 days'
ORDER BY created_at DESC;
```

These queries are exposed through an admin API endpoint (`GET /api/admin/audit/query`) that accepts a query type enum and parameters. Only users with the `audit:read` permission can execute them.

### Acceptance Criteria

- [ ] All six queries execute correctly against populated audit tables
- [ ] Query 3 correctly identifies rows where actor_id is `pg_trigger_fallback` (bypass indicator)
- [ ] Admin API endpoint requires `audit:read` permission
- [ ] Query results are paginated (default 100, max 1000 rows per request)
- [ ] Indexes support sub-second response times for all queries on tables with >1M audit rows

---

## 7. Rogue Actor Detection

### Purpose

Detect and alert when someone mutates the database outside the application layer, indicating either unauthorized direct access or a misconfigured service.

### Detail

The detection logic compares two signals:

1. **API-level signal:** Every API write handler logs its `change_set` UUID to a lightweight `api_audit_claims` table before committing.
2. **Trigger-level signal:** The Postgres trigger writes audit rows with actor context from session variables (or falls back to `pg_trigger_fallback`).

A mismatch occurs when:
- An audit row has `actor_id = 'pg_trigger_fallback'` --- the trigger fired but no API handler set the session variables. Someone ran SQL directly.
- An `api_audit_claims` row has no matching audit rows --- the API handler claimed a change but the trigger didn't fire. Indicates the trigger was disabled or the write targeted a table without a trigger.

```sql
CREATE TABLE api_audit_claims (
  change_set    UUID PRIMARY KEY,
  actor_id      TEXT NOT NULL,
  actor_type    TEXT NOT NULL,
  endpoint      TEXT NOT NULL,       -- e.g. 'POST /api/ontology/concepts'
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Detection query (runs every 5 minutes via pg_cron):**

```sql
-- Unclaimed trigger rows: someone bypassed the API
SELECT a.id, a.table_name, a.record_id, a.action, a.created_at
FROM ontology_audit_log a
LEFT JOIN api_audit_claims c ON a.change_set = c.change_set
WHERE a.actor_id = 'pg_trigger_fallback'
  AND c.change_set IS NULL
  AND a.created_at > now() - INTERVAL '10 minutes';

-- Unmatched API claims: trigger may be disabled
SELECT c.change_set, c.endpoint, c.claimed_at
FROM api_audit_claims c
LEFT JOIN ontology_audit_log a ON a.change_set = c.change_set
WHERE a.change_set IS NULL
  AND c.claimed_at > now() - INTERVAL '10 minutes';
```

When either query returns rows, the system:

1. Inserts a row into `admin_alerts` with severity `critical` and category `rogue_actor`
2. Fires an `admin.alert.rogue_actor` event on the event bus
3. The alert workflow sends a notification to all users with the `admin:security` permission

**Exclusions:** Rows with `actor_type = 'system'` and a known migration or cron actor_id (maintained in a `known_system_actors` config) are excluded from rogue detection. Migrations and scheduled jobs are expected to write directly.

### Acceptance Criteria

- [ ] `api_audit_claims` table exists and is populated by every API write handler
- [ ] Detection query runs every 5 minutes via pg_cron
- [ ] Unclaimed trigger rows (direct SQL bypass) generate a `critical` admin alert
- [ ] Unmatched API claims (missing trigger) generate a `critical` admin alert
- [ ] Known system actors (migrations, cron) are excluded from rogue detection
- [ ] Alert fires within 10 minutes of the rogue access occurring
- [ ] Alert includes table name, record ID, action, and timestamp of the rogue mutation

---

## 8. Test Plan

### Purpose

Verify that every component of the audit system works correctly in isolation and in combination.

### Detail

**8.1 Trigger fires on direct SQL**

| Step | Action | Expected |
|---|---|---|
| 1 | INSERT a row into `ontology_concepts` via `psql` (no session variables) | `ontology_audit_log` row created with `actor_id = 'pg_trigger_fallback'`, `actor_type = 'system'` |
| 2 | UPDATE the same row via `psql` | Audit row with `action = 'UPDATE'`, `old_data` and `new_data` both populated |
| 3 | DELETE the row via `psql` | Audit row with `action = 'DELETE'`, `old_data` populated, `new_data` NULL |
| 4 | INSERT via application (`withAuditContext`) | Audit row with correct `actor_id`, `actor_type`, `session_id`, `ip_address` |

**8.2 Change sets group correctly**

| Step | Action | Expected |
|---|---|---|
| 1 | Create a concept with 3 properties in one API call | 4 audit rows (1 concept + 3 properties) sharing the same `change_set` UUID |
| 2 | Query by `change_set` | Returns all 4 rows in chronological order |
| 3 | Roll back the change set | 4 inverse audit rows under a new `change_set`; original rows unchanged |

**8.3 Forensics queries return correct results**

| Step | Action | Expected |
|---|---|---|
| 1 | Seed 100 audit rows across 3 actors and 5 tables | Rows inserted |
| 2 | Run Query 1 (actor + time range) | Returns only rows matching the actor and time window |
| 3 | Run Query 2 (table + 7 days) | Returns only `ontology_concepts` rows from last 7 days |
| 4 | Run Query 3 (bypass detection) | Returns only `pg_trigger_fallback` rows from last 24 hours |
| 5 | Run Query 5 (most active actors) | Returns actors sorted by mutation count descending |

**8.4 Rogue actor detection works**

| Step | Action | Expected |
|---|---|---|
| 1 | Insert a row via `psql` (no API claim) | Detection query finds unclaimed trigger row |
| 2 | Wait for pg_cron cycle (or trigger manually) | `admin_alerts` row created with severity `critical`, category `rogue_actor` |
| 3 | `admin.alert.rogue_actor` event fires | Verified in `event_log` |
| 4 | Insert a row via API with `withAuditContext` | Detection query returns no unclaimed rows for this change set |
| 5 | Add a known system actor, run a migration | Detection query excludes the migration actor |

**8.5 Event log integration**

| Step | Action | Expected |
|---|---|---|
| 1 | Create a concept via API | Audit row created; event_log row created with matching `change_set` |
| 2 | Workflow triggers from the event | Workflow mutations carry their own `change_set` linked to the event |
| 3 | Run full-chain query from section 5 | Returns downstream workflow-generated mutations |

**8.6 Append-only protection**

| Step | Action | Expected |
|---|---|---|
| 1 | Attempt UPDATE on `ontology_audit_log` | No rows modified (rule blocks it) |
| 2 | Attempt DELETE on `ontology_audit_log` | No rows deleted (rule blocks it) |
| 3 | Attempt UPDATE on `domain_audit_log` | No rows modified |
| 4 | Attempt DELETE on `domain_audit_log` | No rows deleted |

### Acceptance Criteria

- [ ] All test cases in 8.1--8.6 pass
- [ ] Tests run in CI against a real Postgres instance (not mocked)
- [ ] Test database is seeded and torn down per test suite
- [ ] No test depends on execution order within a suite
