# Template Infrastructure

> One template system, not six. Workflow record templates, notification templates, document templates,
> prep item templates, staffing templates, and form/view presets all share a common storage format,
> versioning model, scoping rules, and CRUD API. Templates are ontology concepts — they go through
> the same CI/QA pipeline, RBAC controls, and audit trail as everything else.

---

## Overview

The platform currently defines 6+ independent template systems across different PRDs, each with its own storage table and format. This creates fragmentation: a workflow template for "JP Guest Prep Checklist" and a document template for "Guest Contract" live in different tables, version differently, and have no shared management UI.

This PRD unifies template infrastructure. Templates become a first-class concept in the ontology, stored in Postgres with the same versioning, scoping, and RBAC as other ontology data. Individual template TYPES (workflow records, notifications, documents, etc.) are categories within the unified system, not separate tables.

**What this PRD covers:** The infrastructure — storage, versioning, scoping, CRUD API, import/export format.

**What this PRD does NOT cover:** Actual template content (the specific "JP Guest Prep Checklist" items). That's populated by convention operators, not built by the platform.

---

## 1. Templates as Ontology Concepts

**Purpose:** Define templates within the existing ontology framework rather than creating parallel systems.

**Detail:**

A template is an ontology concept with `is_config = true`. Template instances are rows in a `templates` table:

```sql
CREATE TABLE templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type   TEXT NOT NULL CHECK (template_type IN (
    'record_set',       -- batch-create records (prep checklists, default pairings)
    'notification',     -- email/in-app notification content
    'document',         -- contract, itinerary, briefing sheet
    'form_preset',      -- pre-configured form layout
    'view_preset',      -- pre-configured view layout
    'workflow'          -- pre-configured workflow config
  )),
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT,             -- grouping: "guest_relations", "operations", etc.
  content         JSONB NOT NULL,   -- template-type-specific payload
  concept_key     TEXT,             -- which concept this template applies to (nullable for cross-concept)
  pack_id         UUID,             -- groups templates into department packs (e.g., all GR templates share a pack_id)
  
  -- Ontology standard fields
  version         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',
  owner_scope     TEXT NOT NULL DEFAULT 'org',
  owner_department TEXT,
  changed_by      UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason   TEXT,
  previous_version_id UUID REFERENCES templates(id),
  
  UNIQUE (name, template_type, version)
);

CREATE INDEX idx_templates_type ON templates (template_type) WHERE status = 'active';
CREATE INDEX idx_templates_concept ON templates (concept_key) WHERE status = 'active';
CREATE INDEX idx_templates_category ON templates (category) WHERE status = 'active';
CREATE INDEX idx_templates_pack ON templates (pack_id) WHERE status = 'active';
```

**Template packs metadata table:**

Templates with the same `pack_id` belong to the same department pack. The `template_packs` table stores pack-level metadata (name, description, icon) referenced by `templates.pack_id`:

```sql
CREATE TABLE template_packs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,         -- e.g., "Guest Relations"
  key         TEXT NOT NULL UNIQUE,   -- e.g., "guest_relations"
  description TEXT,
  category    TEXT,                   -- e.g., "convention_operations"
  icon        TEXT,                   -- e.g., "mdi:account-star"
  color       TEXT,                   -- e.g., "#4A90D9"
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The `pack_id` on `templates` is a FK to `template_packs.id`. When the template library (see `platform/template-library.md`) displays department packs, it queries `template_packs` for metadata and `templates WHERE pack_id = $1` for pack contents.

**Why ontology concepts:** Templates get versioning, CI/QA review, RBAC scoping, and audit trails for free. No new infrastructure — they ride the existing systems.

**Acceptance Criteria:**
- [ ] `templates` table exists with all specified columns including `pack_id`
- [ ] `template_packs` table exists with pack metadata (name, key, description, icon, color)
- [ ] `templates.pack_id` references `template_packs.id`
- [ ] Templates use the same versioning pattern as other ontology tables
- [ ] RBAC controls template access (who can create, edit, use templates)
- [ ] Templates go through the CI/QA pipeline for changes

---

## 2. Template Types

**Purpose:** Define the content format for each template type.

### 2.1 Record Set (`record_set`)

Creates multiple records in a target concept. Used by the `create_records` workflow action.

```json
{
  "targetConcept": "prep_item",
  "items": [
    { "name": "Confirm interpreter availability", "status": "incomplete", "due_offset_days": -14 },
    { "name": "Book hotel room", "status": "incomplete", "due_offset_days": -30 },
    { "name": "Send cultural briefing", "status": "incomplete", "due_offset_days": -7 }
  ]
}
```

### 2.2 Notification (`notification`)

Content template for notifications. Supports `{{variable}}` placeholders.

```json
{
  "subject": "Guest {{guest.name}} confirmed for {{convention.name}}",
  "body": "{{guest.name}} from {{guest.company}} has been confirmed...",
  "channels": ["email", "in_app"]
}
```

### 2.3 Document (`document`)

Handlebars template for contracts, itineraries, etc.

```json
{
  "format": "handlebars",
  "content": "<h1>Guest Agreement</h1><p>This agreement is between {{convention.name}} and {{guest.name}}...</p>",
  "outputFormats": ["pdf", "html"],
  "clauses": [...]
}
```

### 2.4 Form Preset (`form_preset`)

Pre-configured FormConfig for a concept.

```json
{
  "layout": "wizard",
  "steps": [...],
  "fields": [...]
}
```

### 2.5 View Preset (`view_preset`)

Pre-configured ViewConfig.

```json
{
  "viewType": "kanban",
  "groupBy": "status",
  "columns": [...],
  "filters": [...]
}
```

### 2.6 Workflow (`workflow`)

Pre-configured WorkflowConfig.

```json
{
  "trigger": { "type": "domain_event", "event": "guest.confirmed" },
  "condition": { "type": "field", "field": "type", "operator": "eq", "value": "JP" },
  "actions": [...]
}
```

**Acceptance Criteria:**
- [ ] Each template type has a defined JSONB content format
- [ ] Template content is validated against the type-specific schema on write
- [ ] Existing PRDs that reference templates (`workflow-actions.md`, `contracts.md`, etc.) updated to reference the unified `templates` table

---

## 3. Template Scoping

**Purpose:** Define who can create, edit, and use templates.

| Scope | Who can create | Who can use | Example |
|-------|---------------|-------------|---------|
| `org` | Admin only | All departments | "Standard Guest Prep Checklist" |
| `department` | Department director | That department only | "Music Dept Volunteer Onboarding" |

Templates follow the same scoping model as other ontology data (`owner_scope` + `owner_department`). The ontology scoping enforcement (Phase 3) applies.

**Acceptance Criteria:**
- [ ] Template scoping uses the same `owner_scope`/`owner_department` pattern
- [ ] Department templates are invisible to other departments
- [ ] Org-wide templates are read-only for department directors

---

## 4. Template CRUD API

**Purpose:** Define the API for managing templates.

```
GET    /api/templates?type=...&concept=...&category=...  — list templates
GET    /api/templates/:id                                  — get single template
POST   /api/templates                                      — create template
PUT    /api/templates/:id                                  — update (creates new version)
DELETE /api/templates/:id                                  — deprecate
GET    /api/templates/:id/history                          — version history
POST   /api/templates/:id/apply                            — apply a template (type-specific)
```

The `/apply` endpoint is type-specific:
- `record_set`: creates the records in the target concept
- `form_preset`: sets the FormConfig for a concept
- `view_preset`: sets the ViewConfig for a concept
- `workflow`: creates a WorkflowConfig

**Acceptance Criteria:**
- [ ] All CRUD operations go through the full write pipeline (auth, RBAC, audit, events)
- [ ] Template updates create new versions (versioning service)
- [ ] Template application is audited and fires domain events

---

## 5. Import/Export

**Purpose:** Define how templates are packaged for sharing across forks.

**Export format:** JSON file containing template metadata + content:

```json
{
  "format": "gr-ops-template-v1",
  "exported_at": "2026-04-09T...",
  "templates": [
    {
      "template_type": "record_set",
      "name": "JP Guest Prep Checklist",
      "category": "guest_relations",
      "concept_key": "prep_item",
      "content": { ... }
    }
  ]
}
```

**Import:** `POST /api/templates/import` accepts the JSON file. Creates new template entries. Does NOT overwrite existing templates with the same name — creates a new version or a copy.

**OSS model integration:** Template export files can be included in the repo (in a `templates/` directory) for the fork-and-customize model described in `platform/oss-model.md`. These are seed data, not source code.

**Acceptance Criteria:**
- [ ] Templates can be exported as a standalone JSON file
- [ ] Exported templates can be imported into a different deployment
- [ ] Import does not overwrite existing templates
- [ ] Export format is versioned for forward compatibility

---

## 6. Migration from Existing Template Tables

**Purpose:** Define how the 6+ existing template consumers transition to the unified system.

The existing PRDs reference these separate storage systems:
- `workflow_templates` table → migrate to `templates` with `template_type = 'record_set'`
- `notification_templates` → `template_type = 'notification'`
- `doc_templates` → `template_type = 'document'`
- Form/view presets (inline in configs) → `template_type = 'form_preset'` / `'view_preset'`

**Important distinction — contract tables are domain tables, NOT template storage:**

The `contract_templates`, `contract_clauses`, and `guest_contracts` tables defined in `core/rbac-completion.md` Section 7 are **domain tables** for the contract assembly engine, not template storage. They serve a fundamentally different purpose:

- `contract_templates` defines the clause library and assembly rules, including conditional clause inclusion via `required` flags and guest-type filtering (`guest_type` column). This is a domain-specific assembly engine.
- `contract_clauses` defines individual clause bodies with sort ordering and template-level FK relationships. These are components of the assembly engine, not reusable presets.
- `guest_contracts` stores per-guest generated contracts (rendered output with status tracking: draft → sent → signed → countersigned → expired). This is clearly operational domain data.

The unified `templates` table stores reusable presets (record_set, notification, document, form_preset, view_preset, workflow) with simple storage and versioning. Contracts require conditional clause assembly via per-guest-type rules, which is fundamentally different from the template system's simple storage model. These systems coexist without overlap.

**Strategy:** The unified `templates` table replaces workflow_templates, notification_templates, doc_templates, and inline form/view presets. The contract domain tables (`contract_templates`, `contract_clauses`, `guest_contracts`) remain as separate domain tables managed by the contract assembly engine.

**Acceptance Criteria:**
- [ ] Workflow `create_records` action queries the unified `templates` table
- [ ] Notification `notify` action queries the unified `templates` table
- [ ] Document `generate_doc` action queries the unified `templates` table for simple document templates
- [ ] Contract assembly engine continues to use `contract_templates` and `contract_clauses` (domain tables, not migrated)
- [ ] `guest_contracts` remains a standalone domain table for per-guest contract instances

---

## 7. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Template CRUD | Unit | Create, read, update, delete template | All operations work, versioning correct |
| Template scoping | Unit | Org vs dept visibility | Dept template invisible to other depts |
| Template validation | Unit | Invalid content for type rejected | 400 error with clear message |
| Template application | Integration | Apply record_set template creates records | Records created in target concept |
| Import/export roundtrip | Integration | Export → import → verify identical | Content matches after roundtrip |
| Template versioning | Integration | Update → version chain | Previous version accessible via history |
| Write pipeline | Integration | All writes go through audit + events | Audit trail + domain events present |

**Coverage target:** ≥80% on template CRUD and application logic.
