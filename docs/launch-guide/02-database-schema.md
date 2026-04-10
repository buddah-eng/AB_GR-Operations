# Database Schema Setup

> Run 11 migration files in order to create 40+ tables across 5 families.
> Migrations are idempotent SQL scripts -- safe to re-run if one fails partway through.
> The schema creates the empty structure; data is populated in later steps.

---

## Running Migrations

All migration files are located in `functions/src/db/migrations/`. Run them in numeric order against your Postgres database.

### Using psql

```bash
cd functions/src/db/migrations

# Set your connection string
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=gr_ops
export PGUSER=gr_ops
export PGPASSWORD=dev

# Run each migration in order
psql -f 001-foundation.sql
psql -f 002-core-services.sql
psql -f 003a-ci-qa.sql
psql -f 003b-scope-check-constraints.sql
psql -f 003c-integration.sql
psql -f 003d-external.sql
psql -f 004-templates.sql
psql -f 005-data-infrastructure.sql
psql -f 006a-data-quality-security.sql
psql -f 006b-notifications.sql
psql -f 007-pipelines-observability.sql
psql -f 008a-shared-services.sql
psql -f 008b-staff-volunteers-scheduling.sql
```

### Using the Test Helper (Alternative)

The project includes a migration helper used by integration tests:

```bash
cd functions
DB_HOST=localhost DB_PASSWORD=dev npx ts-node src/__tests__/helpers/migrate.ts
```

### Using a Connection String

If your Postgres provider gives you a connection string (e.g., Neon, Supabase):

```bash
psql "postgresql://user:password@host:5432/gr_ops?sslmode=require" \
  -f functions/src/db/migrations/001-foundation.sql
# ... repeat for each file
```

---

## Migration Files and What They Create

### 001-foundation.sql -- Foundation Schema

The core of the platform. Creates all five table families.

| Table Family | Tables Created | Purpose |
|-------------|----------------|---------|
| **RBAC** | `roles`, `users`, `permissions`, `data_scopes`, `screen_access`, `api_keys`, `scoped_tokens` | Authentication, authorization, field-level access control |
| **Ontology** | `ontology_concepts`, `ontology_properties`, `ontology_relationships`, `ontology_events`, `ontology_constraints` | Self-describing domain model |
| **Config** | `form_configs`, `view_configs`, `page_configs`, `workflow_configs` | UI and automation configuration |
| **Domain** | `guests`, `staff`, `schedule_events`, `prep_items`, `pairings` | Operational data |
| **Audit** | `ontology_audit_log`, `domain_audit_log`, `event_log`, `admin_alerts` | Change tracking and event history |

Also creates:
- Audit trigger functions (`audit_ontology_trigger()`, `audit_domain_trigger()`)
- Audit triggers on all ontology, config, RBAC, and domain tables
- `update_updated_at()` trigger function and triggers on mutable tables
- Append-only rules on audit tables (prevents UPDATE/DELETE)
- GIN indexes on JSONB `properties` columns

### 002-core-services.sql -- Core Platform Services

| Tables Created | Purpose |
|----------------|---------|
| `api_audit_claims` | Rogue-actor detection -- links change sets to claimed actors |
| `guest_registry` | Year-over-year guest history (multi-convention) |
| `vendor_registry` | Year-over-year vendor history |

Also adds columns to `guests`:
- `registry_id` (FK to `guest_registry`)
- `convention_year` (default: current year)
- `email_hmac` (blind index for encrypted email search)

### 003a-ci-qa.sql -- Config Change Request Pipeline

| Tables Created | Purpose |
|----------------|---------|
| `config_change_requests` | Stores change requests with status lifecycle: draft -> validating -> review -> staged -> applied -> rolled_back/rejected |

### 003b-scope-check-constraints.sql -- Ontology Scope Constraints

No new tables. Adds `CHECK` constraints to all ontology and config tables enforcing:
- `owner_scope = 'org'` requires `owner_department IS NULL`
- `owner_scope = 'department'` requires `owner_department IS NOT NULL`

### 003c-integration.sql -- Integration Patterns

| Tables Created | Purpose |
|----------------|---------|
| `webhook_subscriptions` | Webhook endpoints registered by API clients |
| `webhook_delivery_log` | Delivery attempts and responses |
| `rate_limit_counters` | Sliding-window rate limiting |

Also adds `rate_limit_per_min` column to `api_keys`.

### 003d-external.sql -- External Surfaces

| Tables Created | Purpose |
|----------------|---------|
| `guest_form_sessions` | Guest self-service form tokens and state |
| `driver_sessions` | Driver view tokens for transport |
| `transport_bookings` | Guest transport (arrival, departure, inter-venue) |

### 004-templates.sql -- Template Infrastructure

| Tables Created | Purpose |
|----------------|---------|
| `templates` | Unified templates: record_set, form_preset, view_preset, workflow, notification, document |

### 005-data-infrastructure.sql -- Data Routing

| Tables Created | Purpose |
|----------------|---------|
| `data_routes` | Source-to-destination data routing with field mappings and PII handling |
| `data_transforms` | Reusable transform chains for data routes |

### 006a-data-quality-security.sql -- Data Quality and Security

| Tables Created | Purpose |
|----------------|---------|
| `quality_rules` | Data quality rule definitions (completeness, consistency, referential, staleness, uniqueness) |
| `quality_violations` | Detected violations with resolution tracking |
| `data_access_log` | PII/sensitive field access logging |

### 006b-notifications.sql -- Notifications

| Tables Created | Purpose |
|----------------|---------|
| `notification_log` | Notification delivery tracking (email, in-app, push) |
| `notification_preferences` | Per-user notification channel preferences |

### 007-pipelines-observability.sql -- Pipelines and Observability

| Tables Created | Purpose |
|----------------|---------|
| `data_pipelines` | Multi-stage data pipeline definitions |
| `pipeline_executions` | Pipeline execution tracking |
| `external_connections` | Third-party integration connection configs |
| `sync_state` | Sync watermarks for external connections |
| `observability_metrics` | Platform health metrics |

### 008a-shared-services.sql -- Shared Services

| Tables Created | Purpose |
|----------------|---------|
| `venues` | Physical spaces with capacity, type, floor, equipment |
| `equipment` | Equipment tracking with checkout/return |
| `calendar_sync_state` | Google Calendar sync state per department |
| `guidebook_sync_log` | Guidebook app sync tracking |

Also adds a foreign key from `schedule_events.venue_id` to `venues.id`.

### 008b-staff-volunteers-scheduling.sql -- Staff and Scheduling

| Tables Created | Purpose |
|----------------|---------|
| `shifts` | Volunteer shift definitions with time, venue, required skills |
| `shift_assignments` | Volunteer-to-shift mapping with status tracking |
| `guest_schedule_events` | Guest-to-event linkage (junction table) |

Also adds columns to `staff`:
- `staff_type` (staff vs volunteer)
- `skills`, `languages` (text arrays)
- `training_status`, `availability`, `emergency_contact`

---

## Table Family Summary

| Family | Table Count | Purpose |
|--------|-------------|---------|
| RBAC | 7 | Roles, permissions, data scopes, screen access, API keys, tokens |
| Ontology | 5 | Concepts, properties, relationships, events, constraints |
| Config | 5 | Forms, views, pages, workflows, templates |
| Domain | 12 | Guests, staff, schedule, prep, pairings, venues, equipment, transport, shifts, registries |
| Audit | 4 | Ontology audit, domain audit, event log, admin alerts |
| Infrastructure | 11 | Change requests, webhooks, rate limits, data routes, quality rules, notifications, pipelines, connections, sync, observability |

---

## Verification

After running all migrations, verify the schema is correct:

```sql
-- Count tables (should be 40+)
SELECT count(*)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- List all tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Verify audit triggers exist
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;

-- Verify key tables exist with correct columns
\d roles
\d ontology_concepts
\d guests
\d permissions
\d workflow_configs
```

Expected table count: approximately 44 tables (exact count depends on migration version).

---

## Troubleshooting

**"relation already exists" error:** The migration was partially applied. Most migrations use `BEGIN`/`COMMIT` transactions, so a failure should roll back cleanly. If not, drop and recreate the database:

```bash
psql -c "DROP DATABASE IF EXISTS gr_ops;"
psql -c "CREATE DATABASE gr_ops;"
# Then re-run all migrations
```

**"function update_updated_at() does not exist" error:** Migrations must be run in order. `001-foundation.sql` creates this function, and later migrations reference it.

**Permission errors:** Ensure your database user has `CREATE TABLE`, `CREATE FUNCTION`, and `CREATE TRIGGER` privileges.

---

## Next Step

[03-seed-ontology.md -- Seeding the Ontology](03-seed-ontology.md)
