# Data Security & PII Governance

> Security for data in motion, not just data at rest. Auto-classify fields as PII/sensitive/internal/public via
> ontology metadata. Track where PII flows across routes, pipelines, and exports. Audit every data access (reads
> AND writes). Detect anomalous access patterns. Enforce retention policies with automated anonymization. Support
> right-to-deletion requests with verification and deletion certificates.

---

## Overview

The encryption PRD (`data/encryption.md`) handles data at rest -- AES-256-GCM column-level encryption for PII fields. The RBAC engine controls who can access data through the API. This PRD covers the gaps between those two systems: classifying which data IS sensitive, tracking where it GOES, auditing who READS it (not just who changes it), detecting when access patterns look WRONG, enforcing how long data is KEPT, and supporting the right to have data DELETED.

Together, these three systems form a defense-in-depth model:
- **RBAC** controls access (who CAN see data)
- **Encryption** protects storage (what happens if the DB is compromised)
- **Data Security** governs flow and lifecycle (where data goes, who looked at it, when it expires)

This PRD is about governance -- policies, tracking, detection, and enforcement. It does not re-implement encryption or access control. It builds on top of them.

**Phase:** Depends on ontology engine (property metadata), encryption (PII field identification), RBAC engine (access control), audit system (mutation tracking), event bus (alerting). Blocks data routing (PII flow enforcement), data observability (security metrics).

---

## Full Specification

### 1. Data Classification

#### Purpose

Auto-classify every field in the platform as PII, sensitive, internal, or public based on ontology property metadata, so that downstream security policies can be applied automatically.

#### Detail

A new `classification` field on the `ontology_properties` table:

```sql
ALTER TABLE ontology_properties
  ADD COLUMN classification TEXT NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('pii', 'sensitive', 'internal', 'public'));
```

**Classification levels:**

| Level | Definition | Examples | Security Implications |
|-------|-----------|----------|----------------------|
| `pii` | Personally identifiable information -- data that identifies a specific individual | email, phone, passport_number, home_address | Encrypted at rest, access-audited on read, retention-limited, right-to-deletion scope |
| `sensitive` | Business-sensitive data not tied to an individual but requiring restricted access | compensation amounts, contract terms, internal notes, API keys | Access-audited on read, restricted by RBAC, not subject to GDPR deletion |
| `internal` | Operational data for internal use, no special handling | status, type, department, schedule dates | Standard RBAC, no additional auditing |
| `public` | Data intended for external visibility | event name, convention dates, public schedule | No access restrictions beyond authentication |

**Auto-classification rules:**

The system provides default classification based on property type and key patterns:

| Pattern | Default Classification | Override Allowed |
|---------|----------------------|------------------|
| Property type `email` | `pii` | Yes, but only to a stricter level |
| Property type `phone` | `pii` | Yes, but only to a stricter level |
| Property key matching `/passport\|visa\|ssn\|tax_id/i` | `pii` | No -- always PII |
| Property key matching `/address\|home_/i` | `pii` | Yes |
| Property key matching `/compensation\|salary\|payment/i` | `sensitive` | Yes |
| Property with `encrypted: true` flag (from encryption.md) | `pii` | No -- encrypted fields are always PII |
| All other properties | `internal` | Yes |

Auto-classification runs when a property is created or modified. Admins can override the classification upward (internal -> sensitive -> pii) but not downward (pii -> internal) without explicit justification stored in the audit log.

**Integration with encryption.md:** The `encrypted` flag on ontology properties already identifies PII fields for encryption. The `classification` field provides a richer taxonomy. All `encrypted: true` properties are automatically `classification: 'pii'`. The classification system can also flag fields as PII that are NOT currently encrypted, serving as an input to the encryption system for coverage expansion.

#### Acceptance Criteria

- [ ] `classification` column exists on `ontology_properties` with CHECK constraint
- [ ] Auto-classification rules assign correct defaults based on property type and key patterns
- [ ] Admins can override classification upward but not downward without justification
- [ ] All `encrypted: true` properties are automatically classified as `pii`
- [ ] Classification changes are audited in `ontology_audit_log`

---

### 2. PII Flow Tracking

#### Purpose

Map where PII data travels across routes, pipelines, exports, and notifications, and alert when PII reaches an unexpected destination.

#### Detail

The PII flow tracker maintains a map of every pathway through which PII-classified fields travel:

```ts
interface PiiFlowMap {
  readonly fieldKey: string
  readonly conceptKey: string
  readonly classification: 'pii' | 'sensitive'
  readonly destinations: ReadonlyArray<PiiDestination>
}

interface PiiDestination {
  readonly type: 'route' | 'workflow' | 'export' | 'notification' | 'external_api' | 'contract_template'
  readonly destinationId: string
  readonly destinationName: string
  readonly targetConceptKey: string | null  // null for exports and external APIs
  readonly targetFieldKey: string | null
  readonly transformApplied: string | null  // e.g. 'masked', 'hashed', 'redacted', null (plaintext)
}
```

**Flow detection:** The PII flow map is built by scanning platform configuration across all six destination types: data routes (source field mappings), workflows (field mappings in create/update actions), notification templates (interpolated fields like `{{guest.email}}`), export configurations (exported columns), contract templates (clause interpolations), and external API calls (`call_api` action request bodies).

**PII flow alerts:** When routes, workflows, or exports are created or modified, the tracker evaluates whether PII reaches uncontrolled destinations. Alert conditions: PII routed without transform (warning), PII sent to HTTP (not HTTPS) endpoint (error), PII in unrestricted bulk export (error), new PII destination added to existing flow (info). Alerts are written to `admin_alerts` and fire `security.pii_flow.alert` on the event bus.

#### Acceptance Criteria

- [ ] PII flow map covers all six destination types (routes, workflows, exports, notifications, contracts, external APIs)
- [ ] Flow map is rebuilt when routes, workflows, or export configs change
- [ ] PII flow alerts fire when PII is sent to an uncontrolled destination
- [ ] Alerts are written to `admin_alerts` with correct severity
- [ ] `security.pii_flow.alert` event fires on the event bus

---

### 3. Access Audit (Read + Write)

#### Purpose

Log every data access -- reads AND writes -- for PII and sensitive fields, going beyond the audit system which tracks mutations only.

#### Detail

The existing audit system (`audit-system.md`) records every INSERT, UPDATE, and DELETE. It does NOT record SELECT/read operations. For PII governance, knowing who READ sensitive data is equally important.

**Read access log table:**

```sql
CREATE TABLE data_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        TEXT NOT NULL,
  actor_type      TEXT NOT NULL CHECK (actor_type IN (
                    'human', 'api_client', 'external_token', 'ai_agent', 'system'
                  )),
  access_type     TEXT NOT NULL CHECK (access_type IN ('read', 'export', 'decrypt')),
  concept_key     TEXT NOT NULL,
  record_id       UUID,                       -- null for bulk reads (list endpoints)
  record_count    INTEGER NOT NULL DEFAULT 1,  -- number of records accessed
  fields_accessed TEXT[] NOT NULL,             -- which fields were returned to the caller
  pii_fields_accessed TEXT[],                  -- subset of fields_accessed that are PII-classified
  classification_max TEXT NOT NULL,            -- highest classification of any accessed field
  ip_address      INET,
  session_id      UUID,
  endpoint        TEXT,                        -- API endpoint that served the request
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_access_log_actor ON data_access_log (actor_id, created_at);
CREATE INDEX idx_access_log_pii ON data_access_log (classification_max, created_at)
  WHERE classification_max IN ('pii', 'sensitive');
CREATE INDEX idx_access_log_concept ON data_access_log (concept_key, created_at);
```

**What gets logged:** Three access types: `read` (API GET returning PII/sensitive fields), `export` (CSV/PDF/external format), and `decrypt` (encryption layer decryption). Logging is asynchronous (fire-and-forget) and selective -- only reads containing at least one `pii` or `sensitive` classified field are logged. `internal` and `public` reads are NOT logged.

#### Acceptance Criteria

- [ ] `data_access_log` table exists with all columns and constraints
- [ ] Every API read that returns PII or sensitive fields creates an access log entry
- [ ] Access logging is asynchronous and does not add latency to read requests
- [ ] `internal` and `public` field reads are NOT logged
- [ ] Export operations are logged with the export format
- [ ] Decryption operations are logged (integration with encryption.md)

---

### 4. Breach Detection

#### Purpose

Detect anomalous data access patterns that may indicate unauthorized access, data exfiltration, or account compromise.

#### Detail

The breach detection engine runs periodic analysis on the `data_access_log` and `domain_audit_log` tables, looking for patterns that deviate from normal access:

**Detection rules:** Six rule types with configurable thresholds: bulk read anomaly (100 PII records in 5 min, critical), bulk export anomaly (50 PII records in 1 export, critical), off-hours access (configurable per role, warning), new actor pattern (first-time PII access, info), field escalation (first access to a new PII field type, warning), rate anomaly (3x rolling 7-day average, warning).

**Threshold configuration:** Stored in `breach_detection_rules` table with columns: `id`, `rule_key` (unique), `name`, `rule_type`, `threshold` (JSONB, type-specific), `severity`, `enabled`, `cooldown_minutes` (default 60, suppresses repeat alerts).

**Detection execution:** Rules run every 5 minutes via scheduled job. Each rule queries `data_access_log` for its time window. Exceeded thresholds create `admin_alerts` rows with category `breach_detection` and fire `security.breach_detection.alert` on the event bus. Cooldown prevents alert fatigue per actor.

#### Acceptance Criteria

- [ ] All six detection rule types are implemented
- [ ] Thresholds are configurable per rule via `breach_detection_rules` table
- [ ] Detection runs every 5 minutes via scheduled job
- [ ] Alerts are created in `admin_alerts` with correct severity
- [ ] `security.breach_detection.alert` event fires on the event bus
- [ ] Cooldown prevents duplicate alerts for the same actor within the cooldown window
- [ ] Detection queries execute in < 5 seconds on 30 days of access log data

---

### 5. Data Retention Policies

#### Purpose

Define per-concept retention periods and enforce them with automated anonymization.

#### Detail

**Retention policy table:**

```sql
CREATE TABLE retention_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concept_key       TEXT NOT NULL UNIQUE,
  retention_days    INTEGER NOT NULL,            -- days after reference_date to retain PII
  reference_field   TEXT NOT NULL DEFAULT 'created_at',  -- which field determines the retention clock
  reference_event   TEXT,                        -- optional: e.g. 'convention_end_date' -- retention starts after this
  anonymize_fields  TEXT[] NOT NULL,             -- which fields to anonymize (must be PII-classified)
  anonymization_method TEXT NOT NULL DEFAULT 'redact' CHECK (
    anonymization_method IN ('redact', 'hash', 'generalize', 'delete_record')
  ),
  enabled           BOOLEAN NOT NULL DEFAULT true,
  last_run_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Anonymization methods:** `redact` (replace with `'[REDACTED]'`, default), `hash` (SHA-256 of value + salt, for dedup detection), `generalize` (category-level replacement, e.g., "john@gmail.com" -> "[email]"), `delete_record` (soft-delete entire record).

**Retention enforcement job:** Runs nightly at 04:00 UTC (after backups). For each enabled policy: query records past retention period, verify `reference_event` has occurred if configured, apply anonymization method, audit in `domain_audit_log` with `actor_type = 'system'` and `change_reason = 'retention_policy:{policy_id}'`, emit `security.retention.completed` event.

#### Acceptance Criteria

- [ ] `retention_policies` table exists with all columns and constraints
- [ ] Retention job runs nightly and processes all enabled policies
- [ ] Anonymization replaces field values without deleting records (for `redact`, `hash`, `generalize`)
- [ ] `delete_record` method soft-deletes the record
- [ ] Anonymization is audited in `domain_audit_log` with system actor
- [ ] `reference_event` check prevents premature anonymization (e.g., convention not yet ended)
- [ ] `security.retention.completed` event fires after job completion

---

### 6. Right-to-Deletion

#### Purpose

Support GDPR-style deletion requests: find all records containing a person's data, anonymize or delete, verify completeness, and generate a deletion certificate.

#### Detail

**Deletion request workflow:**

```
Request received → Search all concepts for matching PII → Generate deletion plan →
  Admin review → Execute anonymization → Verify completeness → Generate certificate
```

**Step 1: Receive request.** Stores subject identifiers (email, phone, name, externalId), requesting actor, GDPR 30-day deadline, and status (`pending` -> `searching` -> `plan_ready` -> `approved` -> `executing` -> `completed` | `rejected`).

**Step 2: Search all concepts.** The deletion engine searches every concept with PII-classified fields for records matching subject identifiers. For encrypted fields, uses blind index (HMAC) from encryption.md.

**Step 3: Generate deletion plan.** Lists all matching records with fields to anonymize and dependent records (via relationships). Includes estimated impact summary.

**Step 4: Admin review.** Plan presented to admin with `security:deletion` permission. Admin can approve, modify (exclude records with justification), or reject.

**Step 5: Execute anonymization.** Apply anonymization method to each record and its dependents. Audit each change in `domain_audit_log`. Clear application-memory caches.

**Step 6: Verify completeness.** Re-run the search from Step 2. Flag any remaining PII for manual review.

**Step 7: Generate deletion certificate.** Certificate contains: hashed subject identifier, records anonymized count, concepts searched, verification result (`complete` | `partial`), verifier identity. Stored in `deletion_certificates` table, exportable as PDF.

**Deletion request storage:**

```sql
CREATE TABLE deletion_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by      UUID NOT NULL,
  subject_identifiers JSONB NOT NULL,     -- encrypted at rest
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending', 'searching', 'plan_ready', 'approved', 'executing', 'completed', 'rejected'
                    )),
  deletion_plan     JSONB,                -- generated plan
  approved_by       UUID,
  approved_at       TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  certificate       JSONB,               -- deletion certificate
  deadline          TIMESTAMPTZ NOT NULL,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deletion_requests_status ON deletion_requests (status) WHERE status != 'completed';
```

#### Acceptance Criteria

- [ ] Deletion request workflow follows all seven steps
- [ ] Subject search covers all concepts with PII-classified fields
- [ ] Search uses blind index (HMAC) for encrypted email fields
- [ ] Deletion plan includes dependent records (via relationships)
- [ ] Admin review is required before execution (`security:deletion` permission)
- [ ] Verification re-search confirms no remaining PII for the subject
- [ ] Deletion certificate is generated and stored
- [ ] GDPR 30-day deadline is tracked and alertable
- [ ] Subject identifiers in the deletion_requests table are encrypted at rest

---

### 7. Integration with RBAC

#### Purpose

Data classification restricts access beyond standard field-level permissions.

#### Detail

The classification level adds a secondary access check on top of RBAC:

```
Request → Auth → RBAC (can this role see this field?) →
  Classification Check (does this role have clearance for this classification level?) →
  Access Log (if PII/sensitive) → Decrypt (if encrypted) → Response
```

A new `classification_access` table maps roles to maximum classification levels:

```sql
CREATE TABLE classification_access (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key        TEXT NOT NULL REFERENCES roles(key),
  max_classification TEXT NOT NULL CHECK (max_classification IN ('pii', 'sensitive', 'internal', 'public')),
  UNIQUE (role_key)
);
```

Classification hierarchy: `pii > sensitive > internal > public`. A role with `max_classification = 'sensitive'` can access `sensitive`, `internal`, and `public` fields but NOT `pii` fields, even if those fields are in the role's `visibleProperties` list.

This provides defense-in-depth: even if an admin accidentally adds a PII field to a volunteer's visible properties, the classification check blocks access.

#### Acceptance Criteria

- [ ] Classification access check runs after RBAC field filtering
- [ ] Roles cannot access fields above their `max_classification` level
- [ ] Classification check is transparent to the caller (fields are simply omitted, same as RBAC filtering)
- [ ] `classification_access` entries are audited in `ontology_audit_log`

---

### 8. Integration with Data Routing

#### Purpose

PII classification enforces transform requirements on data routes.

#### Detail

When a data route propagates PII-classified fields:

1. If the route does not specify a transform for the PII field, the routing engine blocks the route and creates an alert.
2. Acceptable transforms: `mask` (e.g., "j***@gmail.com"), `hash`, `redact`, `encrypt` (re-encrypt for destination), `passthrough` (explicit acknowledgment that plaintext PII is intended).
3. The `passthrough` transform requires the destination concept to also have PII-level access controls.

This prevents accidental PII leakage through routing misconfiguration.

#### Acceptance Criteria

- [ ] Routes with untransformed PII fields are blocked by default
- [ ] `passthrough` transform requires explicit configuration and PII controls on the destination
- [ ] Route configuration UI surfaces PII warnings when PII fields are included in source mappings
- [ ] Route execution log records which PII fields were propagated and which transforms were applied

---

## 9. Test Plan

### 9.1 Classification Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-01 | Unit | Auto-classify email property type | Classification = `pii` |
| T-02 | Unit | Auto-classify text property with key 'notes' | Classification = `internal` |
| T-03 | Unit | Auto-classify property with `encrypted: true` | Classification = `pii` |
| T-04 | Integration | Admin upgrades classification internal -> sensitive | Change audited, succeeds |
| T-05 | Integration | Admin downgrades classification pii -> internal without justification | Rejected |
| T-06 | Integration | Admin downgrades classification pii -> internal with justification | Change audited with justification |

### 9.2 PII Flow Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-07 | Integration | Create route mapping PII field without transform | Alert created, route blocked |
| T-08 | Integration | Create route mapping PII field with mask transform | Route allowed, flow map updated |
| T-09 | Integration | Workflow action copies PII field to non-PII concept | Info alert created |
| T-10 | Integration | PII flow map includes all six destination types | Flow map complete |

### 9.3 Access Audit Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-11 | Integration | API GET returns records with PII fields | `data_access_log` entry created |
| T-12 | Integration | API GET returns records with only internal fields | No access log entry |
| T-13 | Integration | Export containing PII fields | Access log entry with `access_type = 'export'` |
| T-14 | Integration | Decryption of PII field | Access log entry with `access_type = 'decrypt'` |
| T-15 | Integration | Access logging latency | Read request latency not increased by > 5ms |

### 9.4 Breach Detection Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-16 | Integration | Actor reads 200 PII records in 5 minutes (threshold: 100) | Critical alert created |
| T-17 | Integration | Actor reads 50 PII records in 5 minutes (threshold: 100) | No alert |
| T-18 | Integration | Cooldown: same actor exceeds threshold twice in 30 minutes (cooldown: 60) | Only one alert |
| T-19 | Integration | Off-hours PII access | Warning alert created |
| T-20 | Integration | Detection query performance on 30-day data | Completes in < 5 seconds |

### 9.5 Retention Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-21 | Integration | Record past retention period, redact method | PII fields replaced with '[REDACTED]' |
| T-22 | Integration | Record past retention period, hash method | PII fields replaced with SHA-256 hash |
| T-23 | Integration | Record within retention period | No anonymization |
| T-24 | Integration | Record past retention period but reference_event not occurred | No anonymization |
| T-25 | Integration | Retention job audited | `domain_audit_log` entries for each anonymized record |

### 9.6 Right-to-Deletion Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-26 | Integration | Deletion request finds records across 3 concepts | Plan includes all 3 concepts |
| T-27 | Integration | Deletion request with encrypted email uses HMAC lookup | Correct records found |
| T-28 | Integration | Execute deletion plan, verify re-search | Re-search returns zero results |
| T-29 | Integration | Deletion certificate generated | Certificate contains correct metadata |
| T-30 | Integration | Deletion request without admin approval | Execution blocked |
| T-31 | Integration | Deletion request approaching GDPR deadline | Warning alert created at 25 days |

### 9.7 Classification Access Tests

| Test | Type | What | Expected |
|------|------|------|----------|
| T-32 | Integration | Role with max_classification='sensitive' reads PII field | Field omitted from response |
| T-33 | Integration | Role with max_classification='pii' reads PII field | Field included |
| T-34 | Integration | Role with PII in visibleProperties but classification blocks | Field omitted (classification overrides) |

### Coverage Target

80% minimum across classification engine, PII flow tracker, access audit, breach detection, and retention enforcement. 100% on right-to-deletion workflow (compliance-critical).

---

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Classification on ontology_properties, not on records | Properties define the field type; records store values. Classification is a schema-level concern, not a per-record concern. |
| Read access logging is selective (PII/sensitive only) | Logging every read would generate enormous volume with minimal security value. PII and sensitive reads are the governance-relevant subset. |
| Asynchronous access logging | Read latency is user-facing. Governance logging must not degrade UX. Fire-and-forget matches the event bus pattern. |
| Classification hierarchy with defense-in-depth | Even if RBAC is misconfigured, classification blocks PII access for roles without clearance. Belt-and-suspenders. |
| Anonymization over hard delete for retention | Preserves record structure for analytics and referential integrity. Hard delete cascades are dangerous and unnecessary for GDPR compliance. |
| Admin review required for deletion requests | Automated deletion of real data is irreversible. Human-in-the-loop prevents accidents and satisfies compliance audit requirements. |
