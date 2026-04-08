# Risk Register

> Threats, mitigations, and contingencies for the platform build and convention deployment.
> Covers technical risks (bus factor, con-weekend load), operational risks (volunteer turnover,
> scope management), and security risks (PII exposure, rogue actors).

---

## Overview

This register catalogs risks to the platform's successful build and deployment, with mitigations and contingencies for each. Risks are rated by likelihood (L) and impact (I) on a 1-5 scale, producing a risk score (L×I).

---

## Full Specification

### Technical Risks

| # | Risk | L | I | Score | Mitigation | Contingency |
|---|---|---|---|---|---|---|
| T1 | **Bus factor: single primary developer** | 4 | 5 | 20 | OSS-safe architecture (engine is documented, forkable). PRD set enables any developer to understand the system. Multiple collaborators onboarded early. | If primary dev unavailable: collaborators can continue from PRDs. Engine code is generic — domain knowledge is in the DB, not the developer's head. |
| T2 | **Convention weekend load spike** | 3 | 4 | 12 | Cloud Run auto-scaling (0→10 instances). Redis shared cache. Postgres connection pooling. Load testing at M7 milestone. | If load exceeds capacity: scale up Cloud Run max instances (minutes to change). Redis can scale tier. Postgres read replica if queries are the bottleneck. |
| T3 | **Third-party API failures during con** | 3 | 3 | 9 | FlightAware: cache last known status, degrade gracefully. Blacklane: Karhoo as fallback. Google Calendar: local schedule is SOR, sync is supplementary. | If all APIs down: manual mode. Transport status updated manually. Flight info checked on airline websites. Calendar sync disabled, platform schedule is authoritative. |
| T4 | **Database corruption or data loss** | 1 | 5 | 5 | Row-level versioning (instant rollback). Nightly pg_dump snapshots (90-day retention). Cloud SQL automated backups. Audit triggers catch unauthorized changes. | Restore from nightly snapshot (worst case: lose 1 day). Row versioning handles ontology corruption without full restore. |
| T5 | **Cold start latency during con** | 2 | 3 | 6 | Cloud Run min-instances=1 during convention (prevents scale-to-zero). Redis cache warmup on startup. Ontology pre-loaded at boot. | If cold starts occur: first request ~2s (acceptable). Subsequent requests <200ms. |
| T6 | **FormKit or PrimeVue breaking changes** | 2 | 3 | 6 | Pin dependency versions. Test UI on dependency updates before merging. Schema bridge abstraction isolates FormKit internals. | If library breaks: pin to last working version. Schema bridge can target alternative form library if needed. |

### Operational Risks

| # | Risk | L | I | Score | Mitigation | Contingency |
|---|---|---|---|---|---|---|
| O1 | **Volunteer director turnover** | 5 | 3 | 15 | Ontology + RBAC means new directors inherit config, don't rebuild. Workflows, forms, views persist in DB across leadership changes. Platform documentation in PRD set. | New director uses existing config. Training: 1 session on ontology web builder. Previous director's work survives intact in DB. |
| O2 | **Ontology misconfiguration by director** | 3 | 4 | 12 | Config CI/QA pipeline: validation, review gates, impact analysis. 24hr rollback window. Org-wide changes require admin approval. | Rollback: one-click restore to previous version. Change set grouping enables atomic rollback of multi-record changes. |
| O3 | **Adoption resistance from staff** | 3 | 3 | 9 | Start with GR module (smallest, most motivated team). Demonstrate value with working system before expanding. Platform complements existing tools via API, doesn't replace everything at once. | If staff resists: reduce scope to API-only (internal apps consume data, staff continues with existing workflow until convinced). |
| O4 | **Feature creep across departments** | 3 | 3 | 9 | Each department onboards via ontology config, not code. Feature requests = "add this concept/property/workflow" not "build this feature." Ontology builder enables self-service for non-code changes. | If scope grows: the platform is designed for this. New concepts are config rows. New departments are ontology + RBAC records. The engine handles it. |
| O5 | **Training burden for ontology web builder** | 2 | 2 | 4 | Quick-create defaults generate baseline forms/views. Builder has live preview. CI/QA pipeline catches errors before they go live. | If builder is too complex: developers seed config via scripts (existing pattern from setup/). Directors request changes, devs implement. |

### Security Risks

| # | Risk | L | I | Score | Mitigation | Contingency |
|---|---|---|---|---|---|---|
| S1 | **PII data breach** | 2 | 5 | 10 | Column-level AES-256-GCM encryption for all PII. RBAC field-level filtering. TLS in transit. Cloud SQL at-rest encryption. Decryption only after RBAC filtering. | If breach occurs: encrypted data is useless without application key. Key stored in Secret Manager (separate from DB). Rotate key immediately. Notify affected parties per legal requirements. |
| S2 | **Rogue volunteer with DB access** | 2 | 4 | 8 | Postgres audit triggers catch direct SQL changes. RBAC prevents unauthorized API access. Soft-delete only (no hard delete). Bulk operation limits. Alert on changes without API audit entries. | Detect via rogue actor detection (bidirectional audit comparison). Rollback unauthorized changes via version history. Revoke access immediately. |
| S3 | **API key compromise** | 2 | 3 | 6 | Keys stored as bcrypt hashes. Rate limiting per key. Allowed concepts restrict scope. Keys rotatable without downtime. | Revoke compromised key immediately (set active=false). Issue new key. Audit log shows what the key accessed. |
| S4 | **Token enumeration on external surfaces** | 2 | 3 | 6 | Tokens are crypto.randomUUID() (122 bits of entropy). Invalid/expired/nonexistent tokens return identical error. Rate limiting on token endpoints. | If tokens are brute-forced (effectively impossible with UUID v4): rate limiting blocks after 10 attempts/min. Alert admin on suspicious activity. |
| S5 | **AI agent makes unauthorized changes** | 2 | 3 | 6 | MCP agent uses delegated user token — same RBAC as human. Actor type 'ai_agent' in audit. Destructive tools require human confirmation. Bulk limit: 5+ mutations blocked. | Audit log: filter by actor_type='ai_agent'. Rollback AI changes via change set. Director can review all AI actions. |

### Risk Score Summary

```
CRITICAL (15-25):  T1 (bus factor=20), O1 (turnover=15)
HIGH (10-14):      T2 (load=12), O2 (misconfig=12), S1 (breach=10)
MEDIUM (5-9):       T3 (APIs=9), O3 (adoption=9), O4 (creep=9),
                    S2 (rogue=8), T4 (data loss=5), T5 (cold start=6),
                    T6 (deps=6), S3 (API key=6), S4 (token=6), S5 (AI=6)
LOW (1-4):          O5 (training=4)
```

### Test Plan

| Risk | Verification Method |
|---|---|
| T1 | New developer can deploy from README + PRDs without primary dev |
| T2 | Load test passes at M7 milestone (50 concurrent, <200ms p95) |
| T3 | API failure simulation: platform degrades gracefully |
| T4 | Backup restore drill: recover from snapshot within 1 hour |
| O2 | Rollback drill: apply change, rollback, verify state restored |
| S1 | Penetration test: verify encrypted data unreadable via SQL |
| S2 | Rogue actor drill: direct SQL change detected and alerted |
| S5 | AI guardrail test: bulk mutation blocked, destructive action requires confirmation |
