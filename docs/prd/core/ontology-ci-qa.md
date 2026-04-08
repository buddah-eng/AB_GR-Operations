# Platform Config CI/QA Pipeline

> Every config change — ontology, workflows, forms, views, RBAC — goes through Draft → Validate → Review →
> Stage → Apply → Monitor → Rollback. Cross-system validation ensures a property deletion doesn't break forms,
> a workflow change doesn't create infinite loops, and a permission change doesn't lock users out.

---

## Overview

The platform's application lives in the database: ontology definitions, workflow configs, form layouts, view configs, and RBAC permissions. These are all config-as-code — changes to any of them directly affect platform behavior. A bad workflow can spam notifications. A deleted property can break every form that references it. A permission change can leak data to the wrong role.

This pipeline applies the same discipline to config changes that a CI/CD pipeline applies to code changes: automated validation, human review for risky changes, staging/preview, monitored rollout, and one-click rollback.

The pipeline covers **all six config families**: ontology tables (concepts, properties, relationships, events, constraints), workflow configs, form configs, view configs, page configs, and RBAC tables (roles, permissions, data scopes).

---

## Full Specification

### 1. Change Request Flow

**Purpose:** Define the lifecycle of every config change.

**Detail:**

```
DRAFT
  │  User creates/edits config in the web builder
  │  Change saved with status='pending_review'
  │  No effect on production
  │
  ▼
VALIDATE (automated, immediate)
  │  Cross-system validation checks run
  │  ✗ Fail → back to DRAFT with error messages
  │  ✓ Pass → proceed to REVIEW
  │
  ▼
REVIEW (human approval)
  │  Based on change scope and risk level
  │  Department-only + non-destructive → director self-approve
  │  Org-wide or destructive → admin required
  │  Impact report shown to reviewer
  │
  ▼
STAGE (optional preview)
  │  Change applied to preview context
  │  Reviewer can test: forms render? views work? workflows fire correctly?
  │  Preview uses read-only copy of affected data
  │
  ▼
APPLY
  │  Change status set to 'active'
  │  Previous version status set to 'superseded'
  │  Version incremented
  │  All caches invalidated (Redis pub/sub to all instances)
  │  Event fired: config.applied with change_set UUID
  │  Changelog entry written to audit log
  │
  ▼
MONITOR (24hr window)
  │  If issues detected: one-click rollback available
  │  After 24hrs: previous version eligible for cleanup
  │
  ▼
ROLLBACK (if needed)
     Current version status → 'rolled_back'
     Previous version status → 'active'
     Caches invalidated
     Event fired: config.rolled_back
```

**Fast-track for low-risk changes:** Adding a non-required property to a department-owned concept skips REVIEW and STAGE — validation passes, applied immediately. The risk assessment determines which steps are required.

**Acceptance Criteria:**
- [ ] Every config change goes through at least DRAFT → VALIDATE → APPLY
- [ ] High-risk changes require human review
- [ ] Rollback restores exact previous state within seconds

---

### 2. Automated Validation Checks

**Purpose:** Catch errors before they reach production.

**Detail:**

#### 2.1 Structural Checks (all config types)

| Check | What | Applies To |
|-------|------|------------|
| Unique keys | No duplicate key within scope | Concepts, properties, roles |
| Valid references | Referenced concept/property/role exists | All config types |
| No circular references | Concept A extends B extends A detected | Concepts, relationships |
| Valid enum values | Type, cardinality, layout, view_type within allowed values | Properties, relationships, forms, views |
| Required fields present | Config record has all mandatory fields | All config types |

#### 2.2 Cross-System Checks (the critical ones)

| Change | Validation | Error If |
|--------|-----------|----------|
| **Delete/deprecate a property** | Scan form_configs, view_configs, workflow_configs for references | Any form field, view column, workflow condition, or workflow action references this property |
| **Delete/deprecate a concept** | Scan relationships, workflows, forms, views, permissions | Any config references this concept |
| **Change a property type** | Check if records exist with values in the old type | Records exist (type change on populated field forbidden) |
| **Add required field to concept** | Check existing records for missing values | Existing records lack default value |
| **Remove a select option** | Check if any records use the option value | Records reference the removed option |
| **Change workflow trigger** | Validate event pattern matches existing concept events | Pattern matches no known events (likely typo) |
| **Add workflow action** | Validate target concept exists, action type is valid, recipients resolve | Target concept missing, invalid action, unresolvable recipients |
| **Change RBAC permission** | Check if active users with this role lose access they currently use | Active users would lose access to their current views |
| **Delete a role** | Check if any users or api_clients have this role | Users or clients assigned to this role |
| **Change data scope** | Simulate scope filter against current data | Would hide records a user is actively assigned to |

#### 2.3 Workflow-Specific Checks

| Check | What |
|-------|------|
| **Loop detection** | Workflow A's action triggers event that fires Workflow B, which triggers event that fires Workflow A |
| **Rate estimation** | Scheduled workflow: estimate how many times it fires per day. Alert if >100. |
| **Action chain validation** | Each action's target concept exists, required fields have values or defaults |
| **Notification flood** | Workflow would notify >10 recipients per trigger — require confirmation |

#### 2.4 Form/View-Specific Checks

| Check | What |
|-------|------|
| **Property existence** | Every field in form_config.fields references an existing property on the concept |
| **Type compatibility** | Form field type matches property type (can't put a datepicker on a text field) |
| **showIf validity** | ConditionExpression in showIf references valid fields with valid operators |
| **View column existence** | Every column in view_config.columns references an existing property |
| **groupBy validity** | Kanban groupBy field exists and is a select/status type |
| **Timeline field types** | Timeline start/end fields exist and are date/datetime type |

**Acceptance Criteria:**
- [ ] Each check type has unit tests with passing and failing cases
- [ ] Cross-system checks scan all related config tables
- [ ] Validation runs in <2 seconds for typical changes
- [ ] Error messages identify the specific conflicting config (e.g., "Property 'status' is referenced by form 'Guest Wizard' field 3")

---

### 3. Impact Analysis

**Purpose:** Show the reviewer exactly what a change affects before they approve it.

**Detail:**

Before any change is applied, the system generates an impact report:

```
Impact Report for: Deprecate property "specialHandling" on concept "guest"
═══════════════════════════════════════════════════════════════════════════

Records affected:     47 guest records have a value for this property
Forms affected:       1  — "Guest Wizard" (step 4, field 6)
Views affected:       2  — "Guest Detail View" (column 8), "VIP Guests Table" (filter)
Workflows affected:   1  — "VIP Auto-Assign" (condition references specialHandling)
Permissions affected: 3  — director/liaison/coordinator have it in visibleProperties
Downstream concepts:  0

Risk level: HIGH (affects active workflows + permissions)
Review required: ADMIN
```

**Acceptance Criteria:**
- [ ] Impact report generated for every change before review
- [ ] Report lists specific config records by name, not just counts
- [ ] Risk level computed from affected record count + config type + scope

---

### 4. Review Gates

**Purpose:** Define who approves what.

| Change Scope | Risk Level | Reviewer |
|---|---|---|
| Department-only, additive (new property, new form) | Low | Director self-approve |
| Department-only, modification (edit property, edit workflow) | Medium | Director self-approve + impact report shown |
| Department-only, destructive (deprecate property, disable workflow) | High | Director + confirmation dialog with impact report |
| Org-wide, any change | High | Admin required |
| RBAC changes (roles, permissions, data scopes) | High | Admin required |
| Cross-department (affects concepts used by multiple depts) | High | Admin required |

**All reviews logged:** reviewer identity, timestamp, impact report snapshot, approval/rejection with reason.

**Acceptance Criteria:**
- [ ] Low-risk changes apply immediately after validation
- [ ] High-risk changes blocked until admin approves
- [ ] Review log queryable for audit purposes

---

### 5. Staging / Preview

**Purpose:** Let reviewers test changes before they go live.

**Detail:**

For high-risk changes, the reviewer can activate a preview:

1. Change applied to a shadow copy of the affected config
2. Reviewer gets a preview URL/mode that loads the shadow config
3. Reviewer can test: "does the form still render? does the view show correct data? does the workflow fire correctly?"
4. Preview reads production data (read-only) with the modified config
5. Preview expires after 1 hour or on explicit close

**Implementation:** Preview config stored with `status='staged'`. A preview mode flag in the request context tells the ontology loader to include staged records. Production requests (no flag) only see `status='active'`.

**Acceptance Criteria:**
- [ ] Preview shows the change's effect without affecting production
- [ ] Preview auto-expires
- [ ] No writes possible through preview mode

---

### 6. Apply and Monitor

**Purpose:** Define the application process and monitoring window.

**Apply:**
1. Current active version: `status='active'` → `status='superseded'`
2. New version: `status='pending_review'` → `status='active'`
3. Version number incremented
4. All Redis caches invalidated via pub/sub
5. Domain event emitted: `config.applied` with change_set UUID, config type, affected concept
6. Audit log entry with full old/new values

**Monitor (24hr window):**
- Admin dashboard shows recent config changes with rollback buttons
- If a form breaks or a workflow misfires, one-click rollback available
- After 24hrs, the rollback button remains but gets a confirmation ("This change has been live for 3 days, are you sure?")

**Acceptance Criteria:**
- [ ] Config change takes effect within 5 seconds (cache invalidation)
- [ ] Rollback available immediately after apply
- [ ] All applied changes visible in admin dashboard with timestamps

---

### 7. Rollback

**Purpose:** Define one-click rollback mechanics.

**Detail:**

Rollback leverages row-level versioning (see `data/versioning-backups.md`):

1. Current version: `status='active'` → `status='rolled_back'`
2. Previous version: `status='superseded'` → `status='active'`
3. Caches invalidated
4. Event emitted: `config.rolled_back`
5. Audit log entry

**Multi-record rollback:** If a change_set includes multiple records (e.g., "added concept + 5 properties + 3 relationships"), rollback reverts the entire change_set atomically in a single Postgres transaction.

**Rollback chain:** If version 3 is rolled back to version 2, and then version 2 is rolled back to version 1, the version history is preserved. No data lost.

**Acceptance Criteria:**
- [ ] Rollback restores exact previous state
- [ ] Multi-record change sets roll back atomically
- [ ] Rollback chain works through multiple versions
- [ ] Rollback completes in <5 seconds

---

### 8. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Structural validation | Unit | Each check passes/fails correctly | Invalid configs rejected with specific error |
| Cross-system: property delete | Integration | Delete property → form/view/workflow references detected | Validation blocks deletion |
| Cross-system: concept delete | Integration | Delete concept → all references detected | Validation blocks deletion |
| Cross-system: RBAC change | Integration | Remove permission → affected users identified | Impact report shows affected users |
| Workflow loop detection | Unit | Create A→B→A cycle → detected | Validation blocks save |
| Workflow rate estimation | Unit | Cron "every second" → flagged | Warning shown |
| Impact report | Integration | Modify property → report shows affected configs | Correct counts and names |
| Review gates | Integration | Org-wide change by director → requires admin | 403 without admin approval |
| Preview mode | Integration | Staged config visible in preview, invisible in production | Correct isolation |
| Apply + cache | Integration | Apply change → all instances see new config | <5 second propagation |
| Rollback | Integration | Apply → rollback → verify previous state restored | Exact restoration |
| Change set rollback | Integration | Multi-record change → rollback all atomically | All or nothing |
| Fast-track | Integration | Low-risk additive change → skips review | Applied immediately after validation |

**Coverage target:** ≥80% on validation engine, 100% on cross-system checks (these are safety-critical).
