# Write Pipeline Completeness

> Every API write endpoint must pass through the full pipeline: auth → RBAC → audit context →
> input validation → encryption → database write → domain event → audit claim. No shortcuts,
> no partial pipelines. If a step exists in the architecture, every write path uses it.

---

## Overview

The platform has a defined write pipeline described across multiple PRDs (auth-system, rbac-engine, audit-system, encryption, event-bus, domain-crud). Each step is implemented as a module. The failure mode is write endpoints that skip steps — calling `query()` directly instead of going through `withAuditContext`, writing JSONB without encrypting PII fields, emitting events without `change_set` linkage.

This PRD defines the canonical write pipeline and a verification procedure that ensures every write endpoint follows it completely.

---

## 1. Canonical Write Pipeline

Every API endpoint that modifies data must execute these steps in order:

```
1. Authentication     → authMiddleware() resolves req.user, req.role, req.actorType
2. RBAC Gate          → roleEngine.canPerformAction(roleKey, conceptKey, action)
3. Payload Filter     → roleEngine.filterWritePayload(roleKey, conceptKey, payload)
4. Input Validation   → validateCondition() for ConditionExpression fields
                      → schema validation for required fields
5. PII Encryption     → encryptPiiFields(jsonbProperties) for write path
                      → computeHmac() for searchable encrypted fields (email_hmac)
6. Audit Context      → auditContextFromRequest(req) creates change_set UUID
                      → withAuditContext(ctx, client => ...) wraps DB write in transaction
                      → setAuditSessionVars() so triggers get actor context
7. Database Write     → parameterized SQL via PoolClient (within audit transaction)
8. Audit Claim        → logAuditClaim(ctx, endpoint) for rogue-actor detection
9. Domain Event       → createDomainEvent() with change_set UUID
                      → emit() fires event and logs to event_log WITH change_set
10. Response          → filtered output (RBAC field filter → decrypt only visible PII)
```

---

## 2. Verification Procedure

For every file in `src/api/` that handles write requests (POST, PUT, DELETE):

### Step-by-step check:

| Step | What to grep for | Where |
|------|-----------------|-------|
| Auth | `requireAuth` in router middleware chain | Router definition |
| RBAC | `canPerformAction` called before any DB write | Handler body |
| Payload filter | `filterWritePayload` called on `req.body` | Handler body |
| Validation | `validateCondition` called for JSONB condition fields | Handler body (where applicable) |
| Encryption | `encryptPiiFields` or `isEncryptionConfigured` | Before DB write |
| HMAC | `computeHmac` for email fields | Before DB write (where applicable) |
| Audit context | `auditContextFromRequest` + `withAuditContext` | Wrapping the DB write |
| DB write | `client.query` (PoolClient, not pool-level `query()`) | Inside `withAuditContext` callback |
| Audit claim | `logAuditClaim` | After DB write |
| Event | `createDomainEvent` + `emit` | After DB write |
| Event change_set | `change_set` included in event or event_log | In logEventToPostgres |
| Response filter | `filterRecord` + `decryptPiiFields` | Before `res.json()` |

### Files to check:
- `src/api/domains.ts` — all 3 write handlers (POST, PUT, DELETE)
- `src/api/actions.ts` — all write action handlers
- `src/api/config.ts` — POST config handler
- Any future write endpoints added in Phase 3+

---

## 3. Common Failures This Catches

| Failure | Symptom | Fix |
|---------|---------|-----|
| `query()` used instead of `client.query()` | Audit triggers get NULL actor context | Use `withAuditContext` wrapper |
| `encryptPiiFields` not called | PII stored as plaintext in JSONB | Add encryption before write |
| `computeHmac` not called for email | `email_hmac` column stays NULL, blind index broken | Compute and store HMAC on write |
| `validateCondition` not called | Invalid ConditionExpression stored in JSONB | Validate before INSERT/UPDATE |
| Event emitted without `change_set` | Audit → event traceability chain broken | Pass `change_set` from AuditContext to event |
| `decryptPiiFields` called without audit context | No decryption audit trail | Pass `{ recordId, actorId }` to decryptPiiFields |
| `logAuditClaim` not called | Rogue detection can't distinguish API writes from direct SQL | Add logAuditClaim after every write |

---

## 4. Acceptance Criteria

- [ ] Every write endpoint in the codebase follows all 10 pipeline steps
- [ ] No write endpoint uses pool-level `query()` for mutations (must use `withAuditContext` → `client.query()`)
- [ ] Verification procedure runs after every PRD implementation
- [ ] Any missing step is a blocking issue — cannot proceed to next PRD

---

## 5. Execution

**When:** After implementing any PRD that adds or modifies write endpoints.

**How:** For each write handler, walk through the 12-row table in §2 and verify each grep target exists.

**Gate:** Phase cannot advance if any write path is missing a pipeline step.
