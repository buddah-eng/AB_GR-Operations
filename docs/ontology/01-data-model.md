# GR-Ops Ontology Data Model

This document is the authoritative developer reference for the GR-Ops ontology type system. The ontology is the backbone of the platform: every domain concept, its fields, its relationships, its business rules, and its UI rendering are defined as rows in Postgres, not as application code. Adding a new domain means adding rows, not writing new endpoints.

**Source of truth:**

- TypeScript interfaces: `functions/src/ontology/types.ts`
- Schema DDL: `functions/src/db/migrations/001-foundation.sql`
- Config seeds: `functions/src/db/migrations/009-gr-config-seeds.sql`
- RBAC seeds: `functions/src/db/migrations/011-rbac-full-seeds.sql`
- Ontology loader: `functions/src/ontology/loader.ts`

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [The Five Ontology Structures](#the-five-ontology-structures)
   - [Concept](#concept)
   - [Property](#property)
   - [Relationship](#relationship)
   - [DomainEventDef](#domaineventdef)
   - [Constraint](#constraint)
3. [PropertyType Reference](#propertytype-reference)
4. [ConditionExpression System](#conditionexpression-system)
5. [Concept Inheritance](#concept-inheritance)
6. [Config Structures](#config-structures)
   - [FormConfig](#formconfig)
   - [ViewConfig](#viewconfig)
   - [PageConfig](#pageconfig)
   - [WorkflowConfig](#workflowconfig)
   - [WidgetConfig](#widgetconfig)
7. [RBAC Structures](#rbac-structures)
   - [Role](#role)
   - [Permission](#permission)
   - [DataScope](#datascope)
   - [ScreenAccess](#screenaccess)
8. [OntologyCache and Runtime Resolution](#ontologycache-and-runtime-resolution)
9. [Versioning and Status Lifecycle](#versioning-and-status-lifecycle)
10. [Seed Data Examples](#seed-data-examples)
11. [Domain Tables](#domain-tables)
12. [Audit System](#audit-system)

---

## Architecture Overview

The platform is **ontology-driven**. At startup (and on a 5-minute TTL cache), the backend reads five Postgres tables (`ontology_concepts`, `ontology_properties`, `ontology_relationships`, `ontology_events`, `ontology_constraints`) and assembles a typed `OntologyCache` in memory. Every API endpoint, form renderer, view renderer, and workflow engine consults this cache to understand what entities exist, what fields they have, how they relate to each other, and what business rules apply.

The config layer (`form_configs`, `view_configs`, `page_configs`, `workflow_configs`) controls how data is presented and automated. The RBAC layer (`roles`, `permissions`, `data_scopes`, `screen_access`) controls who can see and do what.

All ontology and config tables are audited via append-only audit triggers. All support a versioning lifecycle with statuses `active`, `pending_review`, `deprecated`, and `rolled_back`.

---

## The Five Ontology Structures

### Concept

A **Concept** is a domain entity type. It is the top-level container that everything else attaches to.

```typescript
interface Concept {
  readonly id: string
  readonly key: string           // unique machine identifier, e.g. "guest"
  readonly name: string          // singular human label, e.g. "Guest"
  readonly pluralName: string    // plural human label, e.g. "Guests"
  readonly extends?: string      // parent concept key for inheritance
  readonly icon?: string         // PrimeVue icon class, e.g. "pi pi-users"
  readonly description?: string
  readonly isRegistry?: boolean  // true for YoY registry concepts (e.g. guest_registry)
  readonly isConfig?: boolean    // true for config-type concepts (e.g. contract_template)
}
```

**Postgres table:** `ontology_concepts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, auto-generated |
| `key` | TEXT | Machine key. Unique per (key, version). |
| `name` | TEXT | Singular display name |
| `plural_name` | TEXT | Plural display name |
| `extends` | TEXT | Parent concept key (nullable) |
| `icon` | TEXT | Icon class (nullable) |
| `description` | TEXT | (nullable) |
| `is_registry` | BOOLEAN | Default false |
| `is_config` | BOOLEAN | Default false |
| `version` | INTEGER | Default 1 |
| `status` | TEXT | One of: `active`, `pending_review`, `deprecated`, `rolled_back` |
| `owner_scope` | TEXT | `org` or `department` |
| `owner_department` | TEXT | Only set when `owner_scope = 'department'` |
| `changed_by` | UUID | User who made the change |
| `changed_at` | TIMESTAMPTZ | Timestamp of change |
| `change_reason` | TEXT | Reason for modification |
| `previous_version_id` | UUID | Self-referencing FK for version chain |

**Flags explained:**

- `isRegistry`: Marks concepts that persist across convention years (e.g., `guest_registry`, `vendor_registry`). Registry concepts hold canonical data that year-specific records link back to.
- `isConfig`: Marks concepts that are configuration rather than operational data (e.g., `contract_template`, `contract_clause`). Config concepts are managed through builder UIs rather than operational workflows.

---

### Property

A **Property** is a field definition attached to a concept. Properties define what data a concept can hold, how it is validated, and how it is displayed.

```typescript
interface Property {
  readonly id: string
  readonly conceptKey: string        // FK to concept.key
  readonly key: string               // field machine name, e.g. "email"
  readonly label: string             // human label, e.g. "Email Address"
  readonly type: PropertyType        // one of 17 types (see reference below)
  readonly required: boolean
  readonly defaultValue?: unknown    // stored as JSONB
  readonly placeholder?: string
  readonly description?: string
  readonly postgresColumn?: string   // maps to a physical column (nullable)
  readonly options?: ReadonlyArray<SelectOption>  // for select/multi_select
  readonly validationRules?: ValidationRules
  readonly sortOrder: number         // controls display ordering
  readonly hidden?: boolean          // hidden from operators (admin-only)
  readonly readOnly?: boolean        // displayed but not editable
}

interface ValidationRules {
  readonly minLength?: number   // for text types
  readonly maxLength?: number   // for text types
  readonly min?: number         // for number types
  readonly max?: number         // for number types
  readonly pattern?: string     // regex pattern for validation
}

interface SelectOption {
  readonly value: string
  readonly label: string
  readonly color?: string       // optional color for status badges
}
```

**Postgres table:** `ontology_properties`

The table mirrors the interface with snake_case column names. `options` and `validation_rules` are stored as JSONB. The unique constraint is `(concept_key, key, version, owner_department)` to support department-scoped property overrides.

**Guardrail:** A property cannot be both `hidden: true` and `required: true`. Hidden fields are invisible to operators, so they cannot fill them in. The builder API enforces this at creation time.

**postgresColumn mapping:** Most property values are stored in the domain table's `properties` JSONB column. When `postgresColumn` is set, the value is stored in a physical column on the domain table (e.g., `guests.name`, `guests.status`). The generic CRUD layer uses this field to decide where to read/write.

---

### Relationship

A **Relationship** defines a typed link between two concepts. Relationships drive related-record tabs on detail pages, join queries, and workflow context.

```typescript
type Cardinality = 'has-one' | 'has-many' | 'many-to-many'

interface Relationship {
  readonly id: string
  readonly sourceConceptKey: string    // the concept that "owns" the relationship
  readonly targetConceptKey: string    // the concept being related to
  readonly key: string                 // machine name, e.g. "prep_items"
  readonly label: string               // human label, e.g. "Prep Items"
  readonly cardinality: Cardinality
  readonly inverseKey?: string         // key on the target concept that points back
  readonly description?: string
}
```

**Postgres table:** `ontology_relationships`

| Column | Type | Notes |
|--------|------|-------|
| `source_concept_key` | TEXT | The "from" side |
| `target_concept_key` | TEXT | The "to" side |
| `key` | TEXT | Unique per (source_concept_key, key, version) |
| `cardinality` | TEXT | `has-one`, `has-many`, or `many-to-many` |
| `inverse_key` | TEXT | Optional back-reference |

**Cardinality semantics:**

| Cardinality | Meaning | Example |
|-------------|---------|---------|
| `has-one` | Source has exactly one target | Guest has-one primary liaison |
| `has-many` | Source has zero-to-many targets via FK on target | Guest has-many prep items |
| `many-to-many` | Both sides have multiple, via junction table | Guests many-to-many schedule events |

---

### DomainEventDef

A **DomainEventDef** declares a business event that a concept can emit. These events are the triggers that workflows listen to.

```typescript
type TriggerType =
  | 'on_create'         // fires when a record is created
  | 'on_update'         // fires when a record is updated
  | 'on_delete'         // fires when a record is deleted
  | 'on_field_change'   // fires when a specific field changes
  | 'scheduled'         // fires on a cron schedule
  | 'manual'            // fires when a user explicitly triggers it

interface DomainEventDef {
  readonly id: string
  readonly conceptKey: string
  readonly eventKey: string           // e.g. "created", "status_changed"
  readonly fullEventName: string      // e.g. "guest.created", "guest.status_changed"
  readonly triggerType: TriggerType
  readonly description?: string
  readonly changedFields?: ReadonlyArray<string>  // for on_field_change triggers
  readonly schedule?: string          // cron expression for scheduled triggers
}
```

**Postgres table:** `ontology_events`

The `full_event_name` follows the convention `{concept_key}.{event_key}`. The `changed_fields` column (TEXT array) specifies which fields trigger the event when `trigger_type = 'on_field_change'`. The `schedule` column holds a cron expression when `trigger_type = 'scheduled'`.

---

### Constraint

A **Constraint** attaches conditional business rules to a concept. Constraints can enforce required fields, set default values, and define sub-type behavior through conditions.

```typescript
interface Constraint {
  readonly id: string
  readonly conceptKey: string
  readonly name: string                          // human-readable constraint name
  readonly extends?: string                      // parent constraint for nesting
  readonly condition: ConditionExpression         // when this constraint applies
  readonly defaults?: Readonly<Record<string, unknown>>  // field defaults to apply
  readonly requiredFields?: ReadonlyArray<string>         // fields required when active
  readonly description?: string
}
```

**Postgres table:** `ontology_constraints`

| Column | Type | Notes |
|--------|------|-------|
| `condition` | JSONB | A `ConditionExpression` (see below) |
| `defaults` | JSONB | Key-value pairs to set as defaults |
| `required_fields` | TEXT[] | Additional fields required when the condition matches |

Constraints are evaluated at record creation and update time. When a record matches a constraint's condition, the constraint's defaults are applied (unless the user has provided values) and the required fields are enforced in addition to the property-level `required` flag.

---

## PropertyType Reference

The ontology supports 17 property types. Each maps to specific form controls, validation logic, and storage behavior.

| Type | Description | Use Cases | Form Control | Storage |
|------|-------------|-----------|--------------|---------|
| `text` | Plain single-line text | Names, titles, short descriptions | Text input | TEXT or JSONB |
| `rich_text` | Multi-line formatted text | Bios, notes, detailed descriptions | Rich text editor | JSONB |
| `number` | Numeric value (integer or decimal) | Capacity, counts, amounts | Number input | NUMERIC or JSONB |
| `select` | Single choice from predefined options | Status, type, category | Dropdown | TEXT or JSONB |
| `multi_select` | Multiple choices from predefined options | Skills, tags, dietary restrictions | Multi-select chips | JSONB (array) |
| `date` | Calendar date without time | Due dates, event dates | Date picker | DATE or JSONB |
| `datetime` | Date with time and timezone | Scheduled times, arrival times | DateTime picker | TIMESTAMPTZ or JSONB |
| `checkbox` | Boolean true/false | Feature flags, completion status | Toggle/checkbox | BOOLEAN or JSONB |
| `url` | Web URL | Research links, social profiles | URL input with validation | JSONB |
| `email` | Email address | Contact email | Email input with validation | TEXT or JSONB |
| `phone` | Phone number | Contact phone | Phone input | TEXT or JSONB |
| `relation` | Foreign key reference to another record | Guest-to-staff pairings | Relation picker | UUID FK or JSONB |
| `formula` | Computed value from other fields | Calculated scores, derived status | Read-only display | Computed at read time |
| `rollup` | Aggregation over related records | Count of prep items, sum of bookings | Read-only display | Computed at read time |
| `files` | File attachments | Contracts, photos, documents | File upload | JSONB (URLs/metadata) |
| `people` | References to platform users | Assigned staff, coordinators | People picker | JSONB (user IDs) |
| `status` | Workflow status with defined transitions | Guest status, prep status | Status badge/dropdown | TEXT or JSONB |

**Type constraint in Postgres:**

```sql
CHECK (type IN (
  'text', 'rich_text', 'number', 'select', 'multi_select', 'date', 'datetime',
  'checkbox', 'url', 'email', 'phone', 'relation', 'formula', 'rollup',
  'files', 'people', 'status'
))
```

**Notes on `select` and `multi_select`:** These types require the `options` JSONB column to be populated with an array of `SelectOption` objects. Each option has a `value` (stored), a `label` (displayed), and an optional `color` (for badge rendering).

**Notes on `relation`:** This type represents a foreign key to another domain record. The form control renders a search/select picker that queries the target concept's records.

**Notes on `formula` and `rollup`:** These are read-only computed types. `formula` computes a value from the current record's fields. `rollup` aggregates over related records (e.g., count of prep items for a guest).

---

## ConditionExpression System

The `ConditionExpression` is a recursive discriminated union used throughout the platform: in constraints, workflow conditions, form field visibility (`showIf`), and contract clause conditions. It supports boolean composition and 10 comparison operators.

### Type Definition

```typescript
type ConditionExpression =
  | FieldCondition
  | AndCondition
  | OrCondition
  | NotCondition
```

### Discriminant: `type`

Every condition object has a `type` field that determines its shape.

### FieldCondition

The leaf node. Compares a record's field value against an expected value using an operator.

```typescript
interface FieldCondition {
  readonly type: 'field'
  readonly field: string          // property key to evaluate
  readonly operator: Operator     // one of 10 operators
  readonly value?: unknown        // comparison value (omitted for is_empty/is_not_empty)
}
```

### Logical Combinators

```typescript
interface AndCondition {
  readonly type: 'and'
  readonly conditions: ReadonlyArray<ConditionExpression>
}

interface OrCondition {
  readonly type: 'or'
  readonly conditions: ReadonlyArray<ConditionExpression>
}

interface NotCondition {
  readonly type: 'not'
  readonly condition: ConditionExpression  // note: singular, not array
}
```

### Operator Reference

| Operator | Meaning | Value Required | Example |
|----------|---------|----------------|---------|
| `eq` | Equals | Yes | `{"type":"field","field":"status","operator":"eq","value":"confirmed"}` |
| `neq` | Not equals | Yes | `{"type":"field","field":"status","operator":"neq","value":"complete"}` |
| `gt` | Greater than | Yes | `{"type":"field","field":"capacity","operator":"gt","value":100}` |
| `gte` | Greater than or equal | Yes | `{"type":"field","field":"priority","operator":"gte","value":1}` |
| `lt` | Less than | Yes | `{"type":"field","field":"due_date","operator":"lt","value":"{{now}}"}` |
| `lte` | Less than or equal | Yes | `{"type":"field","field":"count","operator":"lte","value":50}` |
| `contains` | String/array contains | Yes | `{"type":"field","field":"name","operator":"contains","value":"VIP"}` |
| `not_contains` | String/array does not contain | Yes | `{"type":"field","field":"tags","operator":"not_contains","value":"internal"}` |
| `is_empty` | Field is null/empty | No | `{"type":"field","field":"email","operator":"is_empty"}` |
| `is_not_empty` | Field is not null/empty | No | `{"type":"field","field":"email","operator":"is_not_empty"}` |

### Composition Example

From the seed data (overdue prep detection workflow):

```json
{
  "type": "and",
  "conditions": [
    { "type": "field", "field": "status", "operator": "neq", "value": "complete" },
    { "type": "field", "field": "due_date", "operator": "lt", "value": "{{now}}" }
  ]
}
```

This reads: "status is not 'complete' AND due_date is before now" -- i.e., an overdue incomplete prep item.

### Template Variables

Condition values support template variables enclosed in `{{}}`. The runtime substitutes these at evaluation time:

- `{{now}}` -- current timestamp
- `{{user.department}}` -- authenticated user's department
- `{{record.field_name}}` -- value of another field on the same record

---

## Concept Inheritance

Concepts support single-parent inheritance via the `extends` field. When concept B extends concept A, B inherits all of A's properties and constraints, with the ability to override inherited properties by key.

### How Inheritance Works

The inheritance resolution algorithm lives in `functions/src/ontology/loader.ts` and runs at ontology load time (not at query time). The resolver:

1. Iterates over all concepts.
2. For each concept with an `extends` value, recursively resolves the parent first (depth-first).
3. Merges properties: parent properties come first, child properties override by matching `key`. The merged list is sorted by `sortOrder`.
4. Concatenates constraints: parent constraints are prepended to child constraints. Both sets apply.

### Resolution Algorithm

```typescript
function resolveInheritance(
  concepts: ReadonlyMap<string, Concept>,
  propsByConceptKey: Map<string, Property[]>,
  constraintsByConceptKey: Map<string, Constraint[]>
): void {
  const visited = new Set<string>();
  const resolving = new Set<string>();

  function resolve(conceptKey: string): void {
    if (visited.has(conceptKey)) return;

    // Circular detection
    if (resolving.has(conceptKey)) {
      logger.error(`Circular inheritance detected for concept: ${conceptKey}`);
      visited.add(conceptKey);
      return;   // breaks the cycle, logs error, continues with partial data
    }

    const concept = concepts.get(conceptKey);
    if (!concept?.extends) {
      visited.add(conceptKey);
      return;
    }

    resolving.add(conceptKey);
    resolve(concept.extends);  // resolve parent first

    // Merge properties: parent first, child overrides by key
    const parentProps = propsByConceptKey.get(concept.extends) ?? [];
    const childProps = propsByConceptKey.get(conceptKey) ?? [];
    const childPropKeys = new Set(childProps.map(p => p.key));
    const mergedProps = [
      ...parentProps.filter(p => !childPropKeys.has(p.key)),
      ...childProps,
    ].sort((a, b) => a.sortOrder - b.sortOrder);

    propsByConceptKey.set(conceptKey, mergedProps);

    // Concatenate constraints (parent + child)
    const parentConstraints = constraintsByConceptKey.get(concept.extends) ?? [];
    const childConstraints = constraintsByConceptKey.get(conceptKey) ?? [];
    constraintsByConceptKey.set(conceptKey, [...parentConstraints, ...childConstraints]);

    resolving.delete(conceptKey);
    visited.add(conceptKey);
  }

  for (const key of concepts.keys()) {
    resolve(key);
  }
}
```

### Inheritance Rules Summary

| Aspect | Behavior |
|--------|----------|
| Properties | Child inherits parent's properties. Child can override by declaring a property with the same `key`. |
| Constraints | Child inherits all parent constraints. Both parent and child constraints are evaluated. |
| Relationships | **Not inherited.** Each concept defines its own relationships. |
| Events | **Not inherited.** Each concept defines its own event definitions. |
| Circular detection | If A extends B extends A, the cycle is detected via the `resolving` set. The offending concept logs an error and is marked as visited with whatever data it had. |

### Example

If concept `vip_guest` extends `guest`, and `guest` defines properties `[name, type, status, company]`, while `vip_guest` defines `[status, vip_tier]` (overriding status with different options), the resolved property list for `vip_guest` would be `[name, type, status (vip_guest version), company, vip_tier]`, sorted by `sortOrder`.

---

## Config Structures

Config structures control how ontology data is rendered and automated. They are stored in Postgres and loaded alongside the ontology.

### FormConfig

Defines how a form is rendered for creating or editing records of a concept.

```typescript
interface FormConfig {
  readonly id: string
  readonly conceptKey: string
  readonly name: string                    // e.g. "intake-wizard", "quick-edit"
  readonly fields: ReadonlyArray<FormFieldConfig>
  readonly layout?: 'single' | 'two-column' | 'wizard'
  readonly steps?: ReadonlyArray<FormStep>  // only for wizard layout
}

interface FormFieldConfig {
  readonly propertyKey: string             // references a Property.key
  readonly groupName?: string              // visual grouping
  readonly colSpan?: 1 | 2                 // column span in two-column layout
  readonly showIf?: ConditionExpression     // conditional visibility
  readonly autocompleteSource?: string     // data source for autocomplete
  readonly overrideLabel?: string
  readonly overridePlaceholder?: string
}

interface FormStep {
  readonly name: string                    // machine name, e.g. "basic"
  readonly label: string                   // human label, e.g. "Basic Info"
  readonly fields: ReadonlyArray<string>   // propertyKeys in this step
}
```

**Layout modes:**

| Layout | Description |
|--------|-------------|
| `single` | All fields stacked vertically in one column |
| `two-column` | Fields in a two-column grid. `colSpan: 2` spans both columns. |
| `wizard` | Multi-step form. Steps define which fields appear on each page. |

**Seed example -- guest intake wizard:**

```sql
INSERT INTO form_configs (concept_key, name, layout, steps, fields)
VALUES (
  'guest', 'intake-wizard', 'wizard',
  '[
    {"name": "basic", "label": "Basic Info", "fields": ["name", "type", "company", "bio"]},
    {"name": "contact", "label": "Contact", "fields": ["email", "phone", "preferred_language"]},
    {"name": "convention", "label": "Convention Details",
     "fields": ["department", "status", "special_requirements", "dietary_restrictions"]}
  ]',
  '[
    {"propertyKey": "name"}, {"propertyKey": "type"}, {"propertyKey": "company"},
    {"propertyKey": "bio"}, {"propertyKey": "email"}, {"propertyKey": "phone"},
    {"propertyKey": "preferred_language"}, {"propertyKey": "department"},
    {"propertyKey": "status"}, {"propertyKey": "special_requirements"},
    {"propertyKey": "dietary_restrictions"}
  ]'
);
```

---

### ViewConfig

Defines how records are displayed in list, kanban, timeline, detail, or dashboard views.

```typescript
interface ViewConfig {
  readonly id: string
  readonly conceptKey: string
  readonly name: string                    // e.g. "default-list", "kanban-tracker"
  readonly viewType: 'table' | 'kanban' | 'timeline' | 'detail' | 'dashboard'
  readonly columns?: ReadonlyArray<ViewColumn>
  readonly filters?: ReadonlyArray<ViewFilter>
  readonly sort?: ViewSort
  readonly groupBy?: string                // property key for kanban grouping
  readonly timelineStart?: string          // property key for timeline start
  readonly timelineEnd?: string            // property key for timeline end
  readonly rowAction?: 'navigate_to_detail' | 'inline_edit' | 'none'
  readonly presets?: ReadonlyArray<ViewPreset>
  readonly tabs?: ReadonlyArray<{
    readonly label: string
    readonly conceptKey: string
    readonly filter: Readonly<Record<string, string>>
    readonly viewName: string
  }>
}

interface ViewColumn {
  readonly propertyKey: string
  readonly label?: string
  readonly renderer?: string
  readonly section?: string
  readonly width?: number
  readonly sortable?: boolean
  readonly filterable?: boolean
  readonly editable?: boolean
}
```

**ViewColumn field reference:**

| Field | Type | Purpose |
|-------|------|---------|
| `propertyKey` | string | References a `Property.key` on the concept |
| `label` | string? | Display label override. When omitted, the renderer resolves from the ontology property's `label`. Added in migration 014. |
| `renderer` | string? | Renderer hint for the frontend (e.g., `status-badge`, `rich-text`, `relative-date`, `role-badge`). Added in migration 014. |
| `section` | string? | Groups columns into page regions on `detail` views (e.g., `header`, `details`). Added in migration 014. |
| `width` | number? | Column width in pixels (table view) |
| `sortable` | boolean? | Whether the column supports sorting (table view) |
| `filterable` | boolean? | Whether the column supports filtering |
| `editable` | boolean? | Whether the column supports inline editing |

```typescript
interface ViewFilter {
  readonly field: string
  readonly operator: string
  readonly options?: ReadonlyArray<string>  // predefined filter values
}

interface ViewSort {
  readonly field: string
  readonly direction: 'asc' | 'desc'
}

interface ViewPreset {
  readonly name: string                     // e.g. "Confirmed Only"
  readonly filter: Readonly<Record<string, unknown>>
}
```

**View types and their required fields:**

| View Type | Required Config | Key Fields |
|-----------|----------------|------------|
| `table` | `columns`, `sort` | `rowAction`, `filters`, `presets` |
| `kanban` | `columns`, `groupBy` | Groups records by the `groupBy` property's values |
| `timeline` | `columns`, `timelineStart`, `timelineEnd` | Renders records on a time axis |
| `detail` | `columns` | Columns may include a `section` field (`header`, `details`) |
| `dashboard` | N/A | Typically uses PageConfig widgets instead |

> **DDL gap -- `tabs`:** The `tabs` field exists in the TypeScript `ViewConfig` interface but has **no corresponding column** in the `view_configs` DDL (see `001-foundation.sql`). Detail-page tab configuration is currently stored inside the `columns` JSONB (via `section` grouping) rather than a dedicated column. A future migration should add `tabs JSONB` to `view_configs` if first-class tab support is needed.

**Seed example -- guest default list view:**

```sql
INSERT INTO view_configs (concept_key, name, view_type, columns, filters, sort, row_action, presets)
VALUES (
  'guest', 'default-list', 'table',
  '[
    {"propertyKey": "name", "sortable": true},
    {"propertyKey": "type", "sortable": true},
    {"propertyKey": "status", "sortable": true},
    {"propertyKey": "company", "sortable": true},
    {"propertyKey": "department", "sortable": true}
  ]',
  '[
    {"field": "status", "operator": "eq",
     "options": ["draft","invited","confirmed","travel_arranged","arrived","attending","departed"]},
    {"field": "type", "operator": "eq", "options": ["JP","NA","industry","special"]},
    {"field": "department", "operator": "eq"}
  ]',
  '{"field": "name", "direction": "asc"}',
  'navigate_to_detail',
  '[
    {"name": "Confirmed Only", "filter": {"status": "confirmed"}},
    {"name": "JP Guests", "filter": {"type": "JP"}}
  ]'
);
```

**Seed example -- prep item kanban (post-014 state):**

```sql
-- Initial insert (009-gr-config-seeds.sql), then updated by 014-data-denormalization.sql
-- Final state after migration 014:
INSERT INTO view_configs (concept_key, name, view_type, columns, group_by)
VALUES (
  'prep_item', 'kanban-tracker', 'kanban',
  '[
    {"propertyKey": "name", "label": "Task"},
    {"propertyKey": "guest_name", "label": "Guest"},
    {"propertyKey": "due_date", "label": "Due", "renderer": "relative-date"},
    {"propertyKey": "owner", "label": "Assigned To"}
  ]',
  'status'
);
```

**Seed example -- schedule timeline (post-014 state):**

```sql
-- Initial insert (009-gr-config-seeds.sql), then updated by 014-data-denormalization.sql
-- Final state after migration 014:
INSERT INTO view_configs (concept_key, name, view_type, columns, timeline_start, timeline_end)
VALUES (
  'schedule_event', 'timeline-view', 'timeline',
  '[
    {"propertyKey": "name", "label": "Event"},
    {"propertyKey": "event_type", "label": "Type", "renderer": "status-badge"},
    {"propertyKey": "venue_name", "label": "Venue"},
    {"propertyKey": "start_time", "label": "Start"},
    {"propertyKey": "end_time", "label": "End"}
  ]',
  'start_time',
  'end_time'
);
```

---

### PageConfig

Defines a full page layout composed of widgets. Pages are rendered by slug and support responsive breakpoints.

```typescript
interface PageConfig {
  readonly id: string
  readonly name: string                    // e.g. "GR Dashboard"
  readonly slug: string                    // URL path segment, e.g. "gr-dashboard"
  readonly widgets: ReadonlyArray<WidgetConfig>
  readonly breakpoints?: {
    readonly desktop: ReadonlyArray<WidgetLayout>
    readonly tablet?: ReadonlyArray<WidgetLayout>
    readonly mobile?: ReadonlyArray<WidgetLayout>
  }
}

interface WidgetLayout {
  readonly widgetId: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}
```

**Seed example -- GR Dashboard (assembled from migrations 009 + 013):**

> **Migration provenance:** The first 6 widgets are inserted by `009-gr-config-seeds.sql`. The `overdue-items` widget is appended by `013-final-seeds.sql` via `UPDATE ... SET widgets = widgets || '[...]'::jsonb`.

```sql
-- Combined final state after migrations 009 + 013:
INSERT INTO page_configs (name, slug, widgets)
VALUES (
  'GR Dashboard', 'gr-dashboard',
  '[
    {"widgetId":"total-guests","type":"stat_card","title":"Total Guests","conceptKey":"guest"},
    {"widgetId":"confirmed","type":"stat_card","title":"Confirmed","conceptKey":"guest",
     "filter":{"status":"confirmed"}},
    {"widgetId":"active-bookings","type":"stat_card","title":"Active Bookings",
     "conceptKey":"transport_booking","filter":{"status":["booked","driver_en_route","waiting"]}},
    {"widgetId":"action-required","type":"action_banner","title":"Action Required",
     "conceptKey":"guest","filter":{"needs_attention":true}},
    {"widgetId":"prep-progress","type":"prep_progress","title":"Prep Completion",
     "conceptKey":"prep_item"},
    {"widgetId":"activity","type":"activity_feed","title":"Recent Activity"},
    {"widgetId":"overdue-items","type":"stat_card","title":"Overdue Items",
     "conceptKey":"prep_item","filter":{"status":"overdue"}}
  ]'
);
```

---

### WidgetConfig

Defines a single widget within a page.

```typescript
interface WidgetConfig {
  readonly widgetId: string                // unique within the page
  readonly type: WidgetType
  readonly title?: string
  readonly conceptKey?: string             // which concept's data to show
  readonly filter?: Readonly<Record<string, unknown>>
  readonly displayOptions?: Readonly<Record<string, unknown>>
}
```

**Widget types:**

| Type | Description |
|------|-------------|
| `stat_card` | Single number with label (e.g., "Total Guests: 47") |
| `data_table` | Embedded table view of records |
| `chart` | Visual chart (bar, line, pie) |
| `timeline_preview` | Compact timeline of upcoming events |
| `prep_progress` | Progress bar or completion percentage |
| `action_banner` | Highlighted call-to-action for items needing attention |
| `quick_add` | Inline form for rapid record creation |
| `activity_feed` | Chronological list of recent domain events |

---

### WorkflowConfig

Defines an automated workflow triggered by domain events, schedules, or field changes.

```typescript
type WorkflowTriggerType = 'domain_event' | 'scheduled' | 'manual' | 'field_changed'

type WorkflowActionType =
  | 'create_record'
  | 'create_records'
  | 'update_record'
  | 'delete_record'
  | 'notify'
  | 'sync_calendar'
  | 'generate_doc'
  | 'call_api'
  | 'lookup_registry'

interface WorkflowConfig {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly trigger: WorkflowTrigger
  readonly condition?: ConditionExpression    // optional guard condition
  readonly actions: ReadonlyArray<WorkflowAction>
  readonly enabled: boolean
}

interface WorkflowTrigger {
  readonly type: WorkflowTriggerType
  readonly event?: string                     // domain event name for domain_event triggers
  readonly schedule?: string                  // cron expression for scheduled triggers
  readonly field?: string                     // field name for field_changed triggers
}

interface WorkflowAction {
  readonly type: WorkflowActionType
  readonly target?: string                    // target concept key
  readonly template?: string                  // template reference
  readonly defaults?: Readonly<Record<string, unknown>>
  readonly link?: string
  readonly source?: string                    // for lookup_registry
  readonly match?: string                     // for lookup_registry
  readonly copyFields?: ReadonlyArray<string>
  readonly recipients?: ReadonlyArray<string> // for notify
  readonly templateName?: string              // for notify/generate_doc
}
```

**Seed example -- Guest arrived notification:**

```sql
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES (
  'Guest Arrived -- Notify Coordinator',
  'When a guest arrives, notify the GR coordinator',
  '{"type": "field_changed", "event": "guest.updated", "field": "status"}',
  '{"type": "field", "field": "status", "operator": "eq", "value": "arrived"}',
  '[{"type": "notify", "recipients": ["coordinator"], "templateName": "guest-arrived"}]',
  true
);
```

**Seed example -- Overdue prep detection (scheduled):**

```sql
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES (
  'Overdue Prep Detection',
  'Daily check: flag incomplete prep items past due date',
  '{"type":"scheduled","schedule":"0 6 * * *"}',
  '{"type":"and","conditions":[
    {"type":"field","field":"status","operator":"neq","value":"complete"},
    {"type":"field","field":"due_date","operator":"lt","value":"{{now}}"}
  ]}',
  '[{"type":"update_record","target":"prep_item","defaults":{"status":"overdue"}}]',
  true
);
```

---

## RBAC Structures

The RBAC system controls access at four levels: role identity, concept-level permissions, row-level data scoping, and page-level screen access.

### Role

A role is the top-level identity. Every user and API key is assigned exactly one role.

```typescript
interface Role {
  readonly id: string
  readonly key: string            // machine key, e.g. "director", "coordinator"
  readonly name: string           // human name, e.g. "Director"
  readonly description?: string
  readonly priority: number       // lower number = higher authority
  readonly isOperational?: boolean
}
```

**Postgres table:** `roles`

**Priority system:** Priority is an integer where lower values mean higher authority. The director has priority 0. The builder API requires `priority <= 0` (i.e., director-level) for ontology mutations.

**Seeded roles and their access levels:**

| Role | Key | Priority | Operational | Access Summary |
|------|-----|----------|-------------|----------------|
| Director | `director` | 0 | No | Full CRUD on all concepts, all pages, builder access |
| Department Head | `department_head` | 80 | Yes | Same as coordinator (cloned permissions) |
| Coordinator | `coordinator` | 100 | Yes | Full CRUD on operational concepts, no delete, no builder |
| Liaison | `liaison` | 200 | Yes | View guests/pairings, edit guest status + prep items |
| Interpreter | `interpreter` | 300 | Yes | View-only on guests and schedule |
| Volunteer | `volunteer` | 400 | Yes | View guests/schedule/venues, edit prep item status |
| Viewer | `viewer` | 500 | No | Read-only on guests, schedule, prep items, pairings, transport, venues |

---

### Permission

A permission row defines what a role can do with a specific concept's records and which fields are visible/editable.

```typescript
interface Permission {
  readonly id: string
  readonly roleKey: string                         // FK to roles.key
  readonly conceptKey: string                      // which concept
  readonly canView: boolean
  readonly canEdit: boolean
  readonly canCreate: boolean
  readonly canDelete: boolean
  readonly visibleProperties: ReadonlyArray<string>    // which fields the role can see
  readonly editableProperties?: ReadonlyArray<string>  // which fields the role can edit
}
```

**Postgres table:** `permissions`

The unique constraint is `(role_key, concept_key)` -- one permission row per role per concept.

**Key design decisions:**

- `visibleProperties` acts as an allowlist. If a property key is not in this array, the role cannot see it in any view or API response.
- `editableProperties` is optional. When null, all visible properties are editable (subject to `canEdit`). When set, only the listed properties can be modified.
- The `id` field is automatically prepended to all `visibleProperties` arrays (via migration 011).

**Seed example -- coordinator permissions for guest concept:**

```sql
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES (
  'coordinator', 'guest', true, true, true, false,
  ARRAY['name','type','department','status','company','registry_id','convention_year',
        'email_hmac','interpreter_required','bio','dietary','pronouns','research_links']
);
```

**Seed example -- liaison permissions for guest concept (limited):**

```sql
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('liaison', 'guest', true, false, false, false,
        ARRAY['name','type','status','company','department']);

-- Later migration adds can_edit=true with editable_properties=['status']
UPDATE permissions SET can_edit = true WHERE role_key = 'liaison' AND concept_key = 'guest';
UPDATE permissions SET editable_properties = ARRAY['status']
  WHERE role_key = 'liaison' AND concept_key = 'guest';
```

This means a liaison can see 5 fields on a guest but can only change the `status` field.

---

### DataScope

A data scope row restricts which records a role can access. This is row-level security.

```typescript
interface DataScope {
  readonly id: string
  readonly roleKey: string
  readonly conceptKey: string
  readonly scopeType: 'relation' | 'field' | 'department' | 'all'
  readonly relationPath?: string    // for relation scope type
  readonly field?: string           // field to filter on
  readonly value?: string           // expected value (null = use caller's value)
}
```

**Postgres table:** `data_scopes`

| Scope Type | Behavior |
|------------|----------|
| `all` | No row-level restriction. The role sees all records. |
| `department` | Records filtered to the authenticated user's department. Uses the `field` column to know which record field to compare. |
| `field` | Records filtered by an arbitrary field match. |
| `relation` | Records filtered by a relationship path (e.g., "only guests assigned to me"). |

**Seed example -- coordinator department scoping:**

```sql
INSERT INTO data_scopes (role_key, concept_key, scope_type, field, value)
VALUES
  ('coordinator', 'guest', 'department', 'department', NULL),
  ('coordinator', 'staff', 'department', 'department', NULL),
  ('coordinator', 'prep_item', 'department', 'department', NULL);
```

When `value` is NULL, the runtime substitutes the authenticated user's department. So a coordinator in the "Animation" department only sees guests, staff, and prep items where `department = 'Animation'`.

---

### ScreenAccess

Controls which pages (by slug) are visible to each role.

```typescript
interface ScreenAccess {
  readonly id: string
  readonly roleKey: string
  readonly pageSlug: string    // matches PageConfig.slug
  readonly visible: boolean
}
```

**Postgres table:** `screen_access`

The unique constraint is `(role_key, page_slug)`.

**Seeded screen access matrix:**

| Page Slug | Director | Coordinator | Dept Head | Liaison | Interpreter | Volunteer | Viewer |
|-----------|----------|-------------|-----------|---------|-------------|-----------|--------|
| `dashboard` | Y | Y | Y | Y | Y | Y | Y |
| `guests` | Y | Y | Y | Y | Y | - | Y |
| `staff` | Y | Y | Y | - | - | - | - |
| `pairings` | Y | Y | Y | - | - | - | - |
| `schedule` | Y | Y | Y | Y | Y | Y | Y |
| `prep-tracker` | Y | Y | Y | Y | - | Y | - |
| `travel` | Y | Y | Y | Y | - | - | - |
| `venues` | Y | Y | Y | - | - | - | - |
| `workflows` | Y | - | - | - | - | - | - |
| `settings` | Y | - | - | - | - | - | - |
| `canvas` | Y | - | - | - | - | - | - |
| `form-builder` | Y | - | - | - | - | - | - |
| `view-builder` | Y | - | - | - | - | - | - |
| `workflow-builder` | Y | - | - | - | - | - | - |

---

## OntologyCache and Runtime Resolution

At runtime, the ontology is held in a typed in-memory cache with a 5-minute TTL.

```typescript
interface OntologyCache {
  readonly concepts: ReadonlyMap<string, Concept>
  readonly properties: ReadonlyMap<string, ReadonlyArray<Property>>
  readonly relationships: ReadonlyMap<string, ReadonlyArray<Relationship>>
  readonly events: ReadonlyMap<string, ReadonlyArray<DomainEventDef>>
  readonly constraints: ReadonlyMap<string, ReadonlyArray<Constraint>>
  readonly loadedAt: number    // Date.now() timestamp
}
```

All maps are keyed by concept `key`. Properties, relationships, events, and constraints are arrays per concept. Inheritance is resolved before the cache is populated, so consumers never need to walk the inheritance chain themselves.

**Cache lifecycle:**

1. First request calls `getOntology()`, which calls `cache.getOrLoad()`.
2. If the cache is empty or expired (> 5 minutes), `loadOntology()` runs.
3. `loadOntology()` fires 5 parallel SQL queries for the 5 ontology tables.
4. Rows are parsed into typed objects via `parseConcept()`, `parseProperty()`, etc.
5. `resolveInheritance()` merges parent properties and constraints into children.
6. The cache is stored and returned.
7. Any ontology mutation (via the builder API) calls `reloadOntology()`, which invalidates the cache and forces a fresh load.

**Public API (from `functions/src/ontology/loader.ts`):**

```typescript
async function getOntology(): Promise<OntologyCache>
async function reloadOntology(): Promise<OntologyCache>
async function getConceptByKey(key: string): Promise<Concept | undefined>
async function getPropertiesForConcept(conceptKey: string): Promise<ReadonlyArray<Property>>
async function getRelationshipsForConcept(conceptKey: string): Promise<ReadonlyArray<Relationship>>
async function getEventsForConcept(conceptKey: string): Promise<ReadonlyArray<DomainEventDef>>
async function getConstraintsForConcept(conceptKey: string): Promise<ReadonlyArray<Constraint>>
async function getFormConfig(conceptKey: string): Promise<FormConfig | undefined>
async function getFormConfigByName(conceptKey: string, name: string): Promise<FormConfig | undefined>
async function getViewConfigs(conceptKey: string): Promise<ReadonlyArray<ViewConfig>>
async function getViewConfigByName(conceptKey: string, name: string): Promise<ViewConfig | undefined>
async function getPageConfigs(): Promise<ReadonlyArray<PageConfig>>
async function getPageConfigBySlug(slug: string): Promise<PageConfig | undefined>
```

---

## Versioning and Status Lifecycle

Every ontology table, config table, and RBAC table supports a versioning lifecycle. The lifecycle is tracked via two columns present on all ontology and config tables:

| Column | Type | Purpose |
|--------|------|---------|
| `version` | INTEGER | Monotonically increasing version number (default 1) |
| `status` | TEXT | Current lifecycle state |

**Status values:**

| Status | Meaning |
|--------|---------|
| `active` | Currently in use. Only `active` rows are loaded into the OntologyCache. |
| `pending_review` | Proposed change awaiting approval. Not loaded at runtime. |
| `deprecated` | Superseded by a newer version. Preserved for history. Not loaded at runtime. |
| `rolled_back` | Was active but has been reverted. Not loaded at runtime. |

**Version lifecycle:**

```
v1 (active)
    |
    v-- Update requested
    |
v1 (deprecated) + v2 (active)
    |
    v-- Rollback requested
    |
v1 (active) + v2 (rolled_back)
```

The `previous_version_id` column (a self-referencing FK) links version chains for audit tracing.

**Key invariant:** At most one version of a given key should be `active` at any time. The loader query `WHERE status = 'active'` enforces this at read time.

---

## Seed Data Examples

### Guest Concept (assembled from seed migrations)

The `guest` concept is the primary domain entity. Its properties, view configs, form configs, and permissions are spread across multiple migrations.

**Concept registration (via builder API or direct insert):**

```
key:         "guest"
name:        "Guest"
pluralName:  "Guests"
icon:        "pi pi-users"
isRegistry:  false
isConfig:    false
```

**Guest properties (from validation rules seed in migration 009):**

| Property Key | Type | Required | Validation | Notes |
|-------------|------|----------|------------|-------|
| `name` | text | yes | minLength: 1, maxLength: 200 | Physical column: `guests.name` |
| `type` | select | no | Options: JP, NA, industry, special | Physical column: `guests.type` |
| `status` | status | yes | Options: draft, invited, confirmed, travel_arranged, arrived, attending, departed | Physical column: `guests.status` |
| `company` | text | no | maxLength: 200 | Physical column: `guests.company` |
| `department` | text | no | -- | Physical column: `guests.department` |
| `bio` | rich_text | no | maxLength: 2000 | JSONB property |
| `pronouns` | text | no | maxLength: 50 | JSONB property |
| `email` | email | no | -- | Encrypted; stored as `email_hmac` for search |
| `phone` | phone | no | -- | JSONB property |
| `preferred_language` | select | no | -- | JSONB property |
| `special_requirements` | rich_text | no | -- | JSONB property |
| `dietary_restrictions` | multi_select | no | -- | JSONB property |

**Guest view configs (from migration 009):**

1. **`default-list`** (table): Columns name, type, status, company, department. Sorted by name ASC. Row action: navigate to detail. Filters on status (7 options), type (4 options), department. Presets: "Confirmed Only", "JP Guests".
2. **`detail-view`** (detail): Sections for header (name, type with status-badge, status with status-badge) and details (company, department, bio with rich-text renderer).

**Guest form configs (from migration 009):**

1. **`intake-wizard`** (wizard): Three steps -- Basic Info (name, type, company, bio), Contact (email, phone, preferred_language), Convention Details (department, status, special_requirements, dietary_restrictions).
2. **`quick-edit`** (two-column): Fields name, type, status, company, department, bio (colSpan: 2).

**Guest permissions by role (assembled from migrations 010, 011, 013):**

| Role | View | Create | Edit | Delete | Visible Properties | Editable Properties |
|------|------|--------|------|--------|--------------------|---------------------|
| director | Y | Y | Y | Y | all | all |
| coordinator | Y | Y | Y | N | name, type, department, status, company, registry_id, convention_year, email_hmac, interpreter_required, bio, dietary, pronouns, research_links | all visible |
| department_head | Y | Y | Y | N | (same as coordinator) | (same as coordinator) |
| liaison | Y | N | Y | N | name, type, status, company, department | status only |
| interpreter | Y | N | N | N | name, type, status, department | -- |
| volunteer | Y | N | N | N | name, type, status | -- |
| viewer | Y | N | N | N | name, type, status | -- |

### Supporting Types

**DomainRecord -- the generic record shape returned by the CRUD API:**

```typescript
interface DomainRecord {
  readonly id: string
  readonly conceptKey: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly relations: Readonly<Record<string, ReadonlyArray<string>>>
  readonly createdAt: string
  readonly updatedAt: string
}
```

**ApiResponse -- the standard API envelope:**

```typescript
interface ApiResponse<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: string
  readonly meta?: {
    readonly total: number
    readonly page: number
    readonly limit: number
    readonly hasMore: boolean
  }
}
```

**StaffingTemplate -- conditional staffing requirements:**

> **DDL gap:** `StaffingTemplate` is defined in `functions/src/ontology/types.ts` but has **no backing table** in any migration. No `CREATE TABLE staffing_templates` exists. This type is referenced by the pairings-staffing PRD (`docs/prd/modules/guest-relations/pairings-staffing.md`) but is not yet persisted. A future migration must create the `staffing_templates` table before this type is usable at runtime.

```typescript
interface StaffingTemplate {
  readonly id: string
  readonly condition: ConditionExpression
  readonly requiredRole: string
  readonly designation: 'primary' | 'backup'
  readonly count: number
}
```

---

## Domain Tables

The ontology defines concepts abstractly; the domain tables store the actual records. Each domain table has a fixed set of physical columns plus a `properties` JSONB column for ontology-defined fields.

| Table | Concept Key | Physical Columns | Notes |
|-------|-------------|-----------------|-------|
| `guests` | `guest` | name, type, department, status, company, registry_id, convention_year, email_hmac | GIN index on properties |
| `staff` | `staff` | name, email, role_key, department, phone | GIN index on properties |
| `schedule_events` | `schedule_event` | name, event_type, venue_id, start_time, end_time, status | Time-range index |
| `prep_items` | `prep_item` | name, guest_id (FK), status, due_date | FK to guests |
| `pairings` | `pairing` | guest_id (FK), staff_id (FK), role | Junction table |
| `guest_registry` | `guest_registry` | canonical_name, email, company, type, department, dietary, travel_prefs, first_attended, last_attended | YoY registry |
| `vendor_registry` | `vendor_registry` | company_name, contact_name, contact_email, category, region | YoY registry |
| `contract_templates` | `contract_template` | name, description, header_html, footer_html | Config concept |
| `contract_clauses` | `contract_clause` | template_id (FK), sort_order, title, body_html, condition (JSONB) | Conditional inclusion |
| `guest_contracts` | `guest_contract` | guest_id, template_id (FK), html, status, signed_at | Generated output |

All domain tables include `created_at`, `updated_at`, `created_by`, and `archived` columns. All are covered by audit triggers that write to `domain_audit_log`.

---

## Audit System

Every ontology and domain table has an `AFTER INSERT OR UPDATE OR DELETE` trigger. Ontology tables write to `ontology_audit_log`; domain tables write to `domain_audit_log`. Both audit tables are append-only (UPDATE and DELETE rules are `DO INSTEAD NOTHING`).

The audit trigger reads actor context from PostgreSQL session variables set by the application layer:

| Session Variable | Purpose |
|-----------------|---------|
| `app.actor_id` | User ID or API key identifier |
| `app.actor_type` | One of: `human`, `api_client`, `external_token`, `ai_agent`, `system` |
| `app.change_set` | UUID grouping all changes in a single transaction |
| `app.session_id` | Optional session identifier |
| `app.ip_address` | Client IP address |

If session variables are not set (e.g., direct SQL execution), the trigger falls back to `actor_id = 'pg_trigger_fallback'` and `actor_type = 'system'`.

### Event Log

The `event_log` table records every domain event fired by the workflow engine. It links events to the workflows they triggered and the actions those workflows executed.

**Postgres table:** `event_log`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, auto-generated |
| `event_id` | TEXT | Unique event identifier |
| `event_name` | TEXT | Domain event name (e.g., `guest.status_changed`) |
| `record_id` | TEXT | ID of the record that emitted the event |
| `triggered_by` | TEXT | Actor who caused the event |
| `change_set` | UUID | Groups related events in a single transaction |
| `timestamp` | TIMESTAMPTZ | When the event occurred |
| `workflows_triggered` | TEXT[] | Array of workflow names that fired |
| `actions_executed` | JSONB | Details of each workflow action executed |
| `created_at` | TIMESTAMPTZ | Row insertion time |

**Indexes:** `event_name`, `timestamp`, `record_id`, `change_set`.

### Admin Alerts

The `admin_alerts` table stores platform-level alerts for administrators. Alerts are created by the workflow engine, constraint violations, or system health checks.

**Postgres table:** `admin_alerts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK, auto-generated |
| `severity` | TEXT | One of: `info`, `warning`, `critical` |
| `category` | TEXT | Alert category for grouping |
| `title` | TEXT | Human-readable alert title |
| `details` | JSONB | Structured alert details |
| `resolved` | BOOLEAN | Default false. Set to true when an admin acknowledges/resolves. |
| `created_at` | TIMESTAMPTZ | Row insertion time |

**Indexes:** Partial index on `(category) WHERE NOT resolved` for efficient unresolved alert queries.
