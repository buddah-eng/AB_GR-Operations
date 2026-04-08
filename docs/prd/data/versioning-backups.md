# Versioning, Backups & Rogue Actor Protection

> Row-level versioning on every ontology table (version chain, status swap for rollback).
> Nightly pg_dump snapshots per table to Cloud Storage, 90-day retention.
> Postgres audit triggers capture INSERT/UPDATE/DELETE with old/new JSONB — catches direct SQL bypass.
> RBAC + soft-delete + bulk limits + orphan-change alerts = rogue actor protection.

---

## Overview

Postgres is the system of record. Protecting it requires three complementary layers: **row-level versioning** for instant, surgical rollback of ontology changes; **nightly snapshots** for catastrophic recovery of domain data; and **audit triggers** that fire on every write regardless of whether it came through the API. Together these layers guarantee that every change is traceable, every state is recoverable, and no actor — authorized or not — can make an undetected modification.

The versioning columns already defined in the schema (`version`, `status`, `previous_version_id`, `changed_by`, `changed_at`, `change_reason`) form the backbone. This document specifies the operational rules, snapshot pipeline, rogue-actor defenses, and disaster-recovery playbook that build on top of that schema.

---

## 1. Row-Level Versioning

### Purpose

Provide instant, row-granularity rollback for any ontology table without restoring a full backup. Operators can undo a single bad property definition or relationship change while the rest of the system keeps running.

### Detail

Every ontology table row carries these versioning columns (defined in `postgres-schema.md`):

```
version             INTEGER NOT NULL DEFAULT 1
status              TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'pending_review', 'deprecated', 'rolled_back'))
owner_scope         TEXT NOT NULL DEFAULT 'org'
owner_department    TEXT
changed_by          UUID
changed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
change_reason       TEXT
previous_version_id UUID
```

**Current state** is always `WHERE status = 'active'`. Partial indexes (e.g., `idx_concepts_active`) enforce fast lookups.

**Update flow:**
1. Application reads the current active row (version N).
2. Application INSERTs a new row with `version = N + 1`, `status = 'active'`, `previous_version_id` pointing to the version-N row.
3. Application UPDATEs the version-N row to `status = 'deprecated'`.
4. Both writes happen in a single transaction. The audit trigger captures both.

**Rollback flow:**
1. Identify the target row to roll back (version N+1, status = 'active').
2. UPDATE version N+1 to `status = 'rolled_back'`.
3. UPDATE version N (found via `previous_version_id`) to `status = 'active'`.
4. Single transaction. `change_reason` records "Rollback of version N+1 by {actor}".

**Version chain traversal:**
```sql
-- Walk the full history of a concept
WITH RECURSIVE history AS (
  SELECT * FROM ontology_concepts WHERE id = :target_id
  UNION ALL
  SELECT c.* FROM ontology_concepts c
  JOIN history h ON h.previous_version_id = c.id
)
SELECT * FROM history ORDER BY version DESC;
```

### Acceptance Criteria

- [ ] Every UPDATE to an ontology table increments `version` by exactly 1
- [ ] After update, exactly one row per logical entity has `status = 'active'`
- [ ] Rollback swaps statuses: rolled-back row gets `rolled_back`, previous row gets `active`
- [ ] `previous_version_id` chain is unbroken — recursive CTE returns full history
- [ ] Concurrent updates on the same row fail with a clear conflict error (optimistic locking on version)

---

## 2. Nightly Snapshots

### Purpose

Provide table-level, last-night recovery for domain data (guests, staff, events, pairings) and a safety net for ontology data beyond row-level versioning.

### Detail

**Pipeline:**
1. A scheduled Cloud Function (or cron job) runs nightly at 03:00 UTC.
2. For each table in the schema, it executes: `pg_dump --table=<tablename> --format=plain --compress=9 <dbname>`.
3. The output is uploaded to a Cloud Storage bucket: `gs://gr-ops-backups/nightly/<tablename>_YYYY-MM-DD.sql.gz`.
4. Lifecycle policy deletes objects older than 90 days.

**Naming convention:** `<tablename>_YYYY-MM-DD.sql.gz`
- Example: `guests_2026-04-08.sql.gz`, `ontology_concepts_2026-04-08.sql.gz`

**Restore procedure (single table):**
1. Download: `gsutil cp gs://gr-ops-backups/nightly/guests_2026-04-07.sql.gz ./`
2. Decompress: `gunzip guests_2026-04-07.sql.gz`
3. Restore to a staging schema: `psql -c "CREATE SCHEMA restore_staging;" && psql -f guests_2026-04-07.sql` (with search_path set to `restore_staging`)
4. Diff staging vs production, cherry-pick rows, or swap tables.
5. Drop staging schema when done.

This procedure restores a single table without touching any other table in the database.

**Monitoring:**
- Alert if a nightly snapshot job fails or produces an empty file.
- Weekly verification: restore a random snapshot to a throwaway database and run a row-count check.

### Acceptance Criteria

- [ ] Snapshots run nightly and complete within the maintenance window
- [ ] Each table produces its own independent `.sql.gz` file
- [ ] Files older than 90 days are automatically deleted
- [ ] A single table can be restored without affecting other tables
- [ ] Restore from a 7-day-old snapshot produces a valid, queryable table
- [ ] Alert fires within 15 minutes if a snapshot job fails

---

## 3. Postgres Audit Triggers

### Purpose

Capture every INSERT, UPDATE, and DELETE on ontology tables — including changes made via direct SQL that bypass the application API — into `ontology_audit_log` with full old/new JSONB payloads.

### Detail

The trigger function and trigger bindings are defined in `postgres-schema.md` section 6. Key points:

```sql
CREATE OR REPLACE FUNCTION audit_ontology_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ontology_audit_log (
    action, table_name, record_id, old_value, new_value
  ) VALUES (
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' THEN to_jsonb(NEW)
         WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW)
         ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

**Trigger is bound to every ontology table:**
- `ontology_concepts`
- `ontology_properties`
- `ontology_relationships`
- `ontology_events`
- `ontology_constraints`

**UPDATE records capture both old and new values.** The application layer enriches the audit log entry with `actor_id`, `actor_role`, `actor_type`, `ip_address`, and `session_id` via a `SET LOCAL` session variable that the trigger reads, or via a separate application-level INSERT into the audit log that is correlated by `change_set` UUID.

**Domain data** uses the separate `domain_audit_log` table with the same schema. A parallel trigger function `audit_domain_change()` is bound to each domain table.

**Indexes** support forensic queries:
- `idx_ontology_audit_time` — time-range scans
- `idx_ontology_audit_table` — filter by table + record
- `idx_ontology_audit_actor` — "what did this person change?"
- `idx_ontology_audit_changeset` — group related changes

### Acceptance Criteria

- [ ] Trigger fires on INSERT, UPDATE, and DELETE for all five ontology tables
- [ ] Direct `psql` session making a raw UPDATE produces an audit row
- [ ] `old_value` is populated on UPDATE and DELETE; `new_value` is populated on INSERT and UPDATE
- [ ] Audit rows are immutable — no UPDATE or DELETE permissions on the audit tables for any application role
- [ ] Forensic query by actor + time range returns results in < 500ms for the most recent 30 days

---

## 4. Rogue Actor Protection

### Purpose

Prevent and detect unauthorized modifications — whether from a compromised API key, a disgruntled operator, or an accidental direct-SQL session.

### Detail

**Layer 1: RBAC prevents unauthorized API access.**
- The `permissions` table defines per-role, per-concept CRUD access.
- `data_scopes` restricts which rows a role can touch (by department, relation, or field value).
- API middleware enforces these before any write reaches the database.
- API clients (`api_clients` table) have allow-listed concepts and rate limits.

**Layer 2: Audit triggers catch API bypass.**
- Even if someone connects directly to Postgres (via `psql`, a compromised connection string, or a rogue migration), the AFTER trigger fires and logs the change.
- The application cannot disable triggers without `ALTER TABLE` permissions, which are restricted to the DBA role.

**Layer 3: Soft-delete only — no hard delete.**
- Domain tables use `archived BOOLEAN NOT NULL DEFAULT false`. "Delete" sets `archived = true`.
- Ontology tables use `status = 'deprecated'`. Nothing is physically removed.
- The `DELETE` action on audit triggers still fires if someone attempts a raw `DELETE`, providing forensic evidence.
- Application-layer permission: `can_delete` on the `permissions` table controls soft-delete access.

**Layer 4: Bulk operation limit.**
- Any API call affecting 5 or more records in a single request requires a confirmation step.
- The API returns a `202 Accepted` with a confirmation token. The client must re-submit with the token to proceed.
- Threshold is configurable per concept via ontology config.
- Direct SQL bypass of this limit is caught by the audit trigger (the burst of audit rows triggers an alert).

**Layer 5: Orphan change detection.**
- A scheduled job (every 5 minutes) compares `ontology_audit_log` entries against the application-level `event_log`.
- Any audit row without a corresponding `event_log` entry is flagged as an orphan change.
- Orphan changes trigger an alert to the admin channel with: table, record ID, action, timestamp, and (if available) database session info.

### Acceptance Criteria

- [ ] A user with `can_edit = false` receives a 403 on attempted write
- [ ] A direct SQL UPDATE (bypassing the API) produces an audit row and triggers an orphan-change alert
- [ ] No domain table row can be physically DELETEd via the API — only `archived = true`
- [ ] A bulk API call affecting 5+ records returns 202 and requires confirmation
- [ ] Orphan change detection runs within 5 minutes and alerts within 10 minutes of the rogue write

---

## 5. Disaster Recovery

### Purpose

Define the recovery playbook for three severity levels: single-row mistake, table-level corruption, and full-database loss.

### Detail

**Scenario 1: Single row mistake (operator changed the wrong ontology property).**
- Recovery method: Row-level versioning rollback.
- RTO: Immediate (single transaction).
- RPO: Zero data loss — the previous version is still in the table.
- Procedure: Identify the row via audit log, execute the rollback flow (section 1), verify via `WHERE status = 'active'`.

**Scenario 2: Table-level corruption (bad migration, bulk import gone wrong).**
- Recovery method: Nightly snapshot restore.
- RTO: 30 minutes (download, decompress, restore to staging, swap).
- RPO: Up to 24 hours (last nightly snapshot). For ontology tables, row-level versioning may provide more granular recovery.
- Procedure: Restore the specific table from the most recent good snapshot (section 2). Replay any valid changes from the audit log that occurred after the snapshot.

**Scenario 3: Full database loss (infrastructure failure).**
- Recovery method: Cloud provider point-in-time recovery (PITR) + snapshots as fallback.
- RTO: 1-2 hours.
- RPO: Minutes (PITR from WAL) or up to 24 hours (snapshots).
- Procedure: Invoke cloud provider PITR to the last known good timestamp. Validate with row counts and audit log integrity checks.

**Forensics:**
- All three scenarios use the audit log to understand what happened.
- The `change_set` UUID groups related changes, making it possible to identify the blast radius of a bad operation.
- Audit logs are in a separate table and survive most forms of corruption that affect domain/ontology tables.

### Acceptance Criteria

- [ ] Rollback of a single ontology row completes in < 2 seconds
- [ ] Table restore from a nightly snapshot completes in < 30 minutes for tables up to 1M rows
- [ ] Full database PITR can be initiated within 15 minutes of the decision to restore
- [ ] Post-recovery validation script confirms row counts, FK integrity, and active-version uniqueness
- [ ] Disaster recovery procedure is tested quarterly (restore a snapshot to a staging environment)

---

## 6. Test Plan

### 6.1 Version Increment on Update

**Purpose:** Confirm that every ontology table update produces a new row with `version = N + 1`.

**Detail:**
1. Insert a row into `ontology_concepts` with default version (1).
2. Update the concept via the API (change `name`).
3. Verify: the original row has `status = 'deprecated'`, a new row exists with `version = 2`, `status = 'active'`, and `previous_version_id` pointing to the original.
4. Repeat for `ontology_properties`, `ontology_relationships`, `ontology_events`, `ontology_constraints`.

**Acceptance Criteria:**
- [ ] New row has `version = old_version + 1`
- [ ] Old row has `status = 'deprecated'`
- [ ] `previous_version_id` links new to old
- [ ] Only one `active` row exists per logical entity

### 6.2 Rollback Swaps Statuses

**Purpose:** Confirm that rollback restores the prior version and marks the current as rolled back.

**Detail:**
1. Create a concept (v1 active).
2. Update it (v1 deprecated, v2 active).
3. Roll back v2.
4. Verify: v2 has `status = 'rolled_back'`, v1 has `status = 'active'`.
5. Verify: `change_reason` on v1 contains the rollback note.

**Acceptance Criteria:**
- [ ] After rollback, `status` values are exactly `rolled_back` and `active`
- [ ] The `change_reason` on the re-activated row documents the rollback
- [ ] Audit log contains two UPDATE entries (one for each status change)

### 6.3 Snapshot Restore

**Purpose:** Confirm a single table can be restored from a nightly snapshot without affecting other tables.

**Detail:**
1. Insert 100 test rows into `guests`.
2. Wait for (or manually trigger) the nightly snapshot.
3. Delete 50 rows from `guests` (soft-delete via API).
4. Restore `guests` from the snapshot into a staging schema.
5. Verify staging has all 100 rows; production `staff` table is untouched.
6. Cherry-pick 10 rows from staging back into production.

**Acceptance Criteria:**
- [ ] Snapshot file exists at the expected Cloud Storage path
- [ ] Restored table has the correct row count
- [ ] Other production tables are unaffected by the restore
- [ ] Cherry-picked rows are valid and pass FK constraint checks

### 6.4 Trigger Fires on Direct SQL

**Purpose:** Confirm the audit trigger catches writes that bypass the application API.

**Detail:**
1. Connect to Postgres via `psql` (not the application).
2. Execute `UPDATE ontology_concepts SET name = 'hacked' WHERE key = 'guest';` directly.
3. Query `ontology_audit_log` for the most recent entry.
4. Verify: `action = 'UPDATE'`, `table_name = 'ontology_concepts'`, `new_value->>'name' = 'hacked'`.
5. Verify: the orphan-change detection flags this within 5 minutes (no matching `event_log` entry).

**Acceptance Criteria:**
- [ ] Audit row exists with correct action, table, record_id, old_value, new_value
- [ ] `actor_id` is NULL (no application session context)
- [ ] Orphan-change alert fires within 10 minutes

### 6.5 Bulk Limit Enforcement

**Purpose:** Confirm that bulk operations exceeding the threshold require confirmation.

**Detail:**
1. Submit an API PATCH request updating 5 guest records in a single call.
2. Verify: response is `202 Accepted` with a `confirmation_token`.
3. Re-submit with the token; verify the updates succeed.
4. Submit a PATCH for 4 records; verify it succeeds immediately (below threshold).
5. Submit a bulk PATCH for 10 records without a token; verify it returns 202, not 200.

**Acceptance Criteria:**
- [ ] Requests at or above the threshold return 202 with a confirmation token
- [ ] Requests below the threshold execute immediately
- [ ] Confirmed requests execute fully and produce the expected audit log entries
- [ ] Unconfirmed requests do not modify any data
