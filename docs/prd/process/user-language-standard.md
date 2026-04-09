# User Language Standard

> Every user-facing label, message, and term in the platform derives from one source: the ontology
> Property.label field. No jargon. No internal key names shown to users. No inconsistent terminology
> across forms, views, and notifications. This document is the reference for every UI PRD.

---

## Overview

The platform has three systems that independently define user-facing text: ontology `Property.label`, form `FormFieldConfig.overrideLabel`, and view column headers. This creates inconsistency — the same field might be labeled "Guest Name" in a form, "Name" in a table, and "canonical_name" in an error message.

This standard establishes one rule: **Property.label is the single source of truth for all user-facing text.** Overrides exist for layout reasons (e.g., shortening "Dietary Restrictions" to "Dietary" in a narrow column) but the base label comes from the ontology.

---

## 1. Label Hierarchy

**Purpose:** Define which label wins when multiple sources exist.

| Priority | Source | When used | Example |
|----------|--------|-----------|---------|
| 1 (highest) | `FormFieldConfig.overrideLabel` | Only when explicitly set by admin in form builder | "Dietary" (shortened for space) |
| 2 | `Property.label` | Default for all forms, views, notifications, errors | "Dietary Restrictions" |
| 3 (never) | `Property.key` | Never shown to users — internal only | "dietary_restrictions" |

**Rule:** If no override exists, `Property.label` is used everywhere. The `key` field is NEVER shown in any user-facing context — not in error messages, not in API responses, not in logs visible to operators.

**Acceptance Criteria:**
- [ ] Every form field label derives from Property.label or an explicit override
- [ ] Every view column header derives from Property.label or an explicit override
- [ ] No API error message exposes property keys or concept keys to end users
- [ ] Search/filter UIs use Property.label for field names

---

## 2. Terminology Translation Table

**Purpose:** Map internal/technical terms to user-facing language.

| Internal Term | User-Facing Term | Context |
|---------------|-----------------|---------|
| Concept | Category (or the concept's own name, e.g., "Guests") | Ontology builder |
| Property | Field | Form builder, settings |
| Relationship | Connection | Ontology builder |
| Constraint | Rule | Ontology builder |
| Ontology | Platform setup / Configuration | Admin settings |
| ConditionExpression | Rule / Condition | Workflow builder, form visibility |
| RBAC | Permissions | Admin settings |
| Data Scope | Access level | Admin settings |
| Workflow | Automation | Admin settings |
| Domain Event | Activity / Change | Audit log, notifications |
| Actor Type | Access method | Audit log |
| Registry | Returning guest/vendor database | Admin settings |
| Archived | Completed / Past | Domain data |
| JSONB properties | (invisible — merged into field display) | Never shown |

**Acceptance Criteria:**
- [ ] This table is referenced by every UI PRD
- [ ] No UI uses a term from the "Internal Term" column in user-facing text
- [ ] Admin-facing screens may use slightly more technical terms but never internal key names

---

## 3. Error Message Standards

**Purpose:** Define how system errors are translated to user-facing messages.

**Rules:**
- Never show stack traces, SQL errors, or internal field names
- Every error has: a plain-language description, what the user can do about it, and who to contact if they can't fix it
- Validation errors reference the field's Property.label, not its key

**Pattern:**
```
BAD:  "column 'dietary_restrictions' violates not-null constraint"
GOOD: "Dietary Restrictions is required. Please fill in this field."

BAD:  "RBAC check failed: canEdit=false for role=volunteer, concept=guest"
GOOD: "You don't have permission to edit guest records. Contact your department director."

BAD:  "FK violation: guests.created_by references users.id"
GOOD: "Something went wrong saving this record. Please try again or contact support."
```

**Acceptance Criteria:**
- [ ] Every API error response has a user-friendly `error` string
- [ ] No error message contains column names, table names, or SQL fragments
- [ ] Validation errors reference Property.label

---

## 4. Role-Specific Language

**Purpose:** Define when different roles see different terminology.

| Role Level | Language Style | Example |
|------------|---------------|---------|
| Operator / Volunteer | Plain language, task-focused | "Mark as arrived", "Add a note" |
| Coordinator / Director | Operational language | "Change status to Arrived", "Update guest record" |
| Admin | Configuration language (still no jargon) | "Add a field to the Guest category", "Create an automation" |

**Rule:** The underlying ontology key is the same. The UI renders different labels based on context, not role. A form for operators says "Guest Name" not "concept:guest property:name."

**Acceptance Criteria:**
- [ ] UI text is appropriate for the expected audience of each screen
- [ ] Builder screens (admin) use configuration language, not database terminology
- [ ] Operator screens use task-focused language

---

## 5. Verification

**When:** During the acceptance gate (process/acceptance-gate.md), for any PRD that defines UI text.

**How:** Grep all user-facing strings in the codebase. Verify none use internal terms from the translation table column 1.

**Gate:** Any user-facing text using internal terminology is a FAIL in the acceptance gate.
