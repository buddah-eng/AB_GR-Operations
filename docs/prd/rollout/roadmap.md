# Roadmap (Dependency-Ordered Build Plan)

> Everything ships. Build order determined by dependencies, not scope reduction. 14-month timeline with
> multiple collaborators. Phases represent what must exist before the next piece can be built.
> Parallel work streams maximize throughput.

---

## Overview

This is a dependency-ordered build plan, not a phased scope reduction. Every PRD in this document set is in scope. The phases represent build ORDER — what must exist before the next piece can be built. Multiple phases can execute in parallel where dependencies are met. With 14 months and multiple collaborators, parallel work streams are expected.

---

## Full Specification

### 1. Build Phases

#### Phase A: Foundation (no upstream dependencies)

**Can start immediately. Everything else depends on these.**

| Work Stream | PRDs | Deliverable |
|---|---|---|
| Database | `data/postgres-schema.md` | All CREATE TABLE scripts, migrations, indexes |
| Ontology Engine | `core/ontology-engine.md` | Loader, parsers, caching (Postgres-backed) |
| RBAC Engine | `core/rbac-engine.md` | Permission checks, field filtering, data scoping |
| Auth System | `core/auth-system.md` | Firebase OAuth, API key, token-scoped, MCP delegation |
| Event Bus | `core/event-bus.md` | Domain event pub/sub, pattern matching, logging |
| Condition Engine | `core/condition-expression.md` | Evaluation engine for ConditionExpressions |
| PII Encryption | `data/encryption.md` | AES-256-GCM encrypt/decrypt, key management |

**Parallel tracks:**
- Schema + ontology engine (ontology reads from schema)
- RBAC + auth (independent, both needed by API)
- Event bus + condition engine (independent)
- Encryption can start anytime (library code, no dependencies)

#### Phase B: API + Core Services (depends on Phase A)

| Work Stream | PRDs | Deliverable |
|---|---|---|
| Domain CRUD | `api/domain-crud.md` | Generic CRUD API with RBAC + events |
| Audit System | `core/audit-system.md` | Audit triggers, actor tracking, forensics |
| Versioning | `data/versioning-backups.md` | Row versioning, snapshots, rollback |
| YoY Registry | `data/yoy-registry.md` | Registry tables, pre-population logic |
| Platform Docs | `platform/multi-tenancy.md`, `platform/scaling.md`, `platform/oss-model.md` | Architecture decisions documented |

**Parallel tracks:**
- Domain CRUD (needs ontology + RBAC + events from Phase A)
- Audit + versioning (need schema + events)
- YoY registry (needs schema)
- Platform docs (documentation, no code dependencies)

#### Phase C: Ontology Management + API Surface (depends on Phase B)

| Work Stream | PRDs | Deliverable |
|---|---|---|
| Ontology Scoping | `core/ontology-scoping.md` | Org vs dept ownership |
| Ontology Web Builder | `core/ontology-web-builder.md` | Admin UI for concepts/properties/relationships |
| Config CI/QA | `core/ontology-ci-qa.md` | Validation, review gates, rollback |
| Integration Patterns | `api/integration-patterns.md` | API keys, webhooks, event subscriptions |
| External Surfaces | `api/external-surfaces.md` | Token auth, guest/driver views |
| MCP Surface | `api/mcp-surface.md` | AI agent tool definitions |

**Parallel tracks:**
- Ontology management (scoping → builder → CI/QA) is sequential
- API surface (integration, external, MCP) can run in parallel

#### Phase D: Automation + UI Rendering (depends on Phase B-C)

| Work Stream | PRDs | Deliverable |
|---|---|---|
| Workflow Engine | `automation/workflow-engine.md` | Executor, trigger matching, action chains |
| Workflow Actions | `automation/workflow-actions.md` | All 9 action type implementations |
| Workflow Builder | `automation/workflow-builder.md` | Visual workflow editor |
| Dynamic Forms | `ui/dynamic-forms.md` | FormKit schema bridge, DynamicForm component |
| View Renderer | `ui/view-renderer.md` | Table, kanban, timeline, dashboard renderers |
| Condition Builder UI | `ui/condition-builder-ui.md` | Shared visual logic builder |
| Form/View Builder | `ui/form-view-builder.md` | Drag-drop config UIs |
| In-App Documents | `ui/in-app-documents.md` | Contract/itinerary rendering, PDF export |

**Parallel tracks:**
- Automation (engine → actions → builder) is sequential
- UI (forms + views + condition builder) can run in parallel
- Form/view builder needs forms + views complete
- In-app documents needs forms + views

#### Phase E: Shared Services (depends on Phase D)

| Work Stream | PRDs | Deliverable |
|---|---|---|
| People | `shared-services/staff-management.md`, `volunteer-management.md`, `volunteer-scheduling.md` | Staff/volunteer records, shift scheduling |
| Places | `shared-services/venue-management.md` | Venue records, room scheduling |
| Calendar | `shared-services/scheduling-calendar.md`, `google-calendar-sync.md`, `guidebook-integration.md` | Event scheduling, external sync |
| Logistics | `shared-services/equipment-logistics.md` | Equipment tracking, warehouse integration |
| Collaboration | `shared-services/cross-dept-collaboration.md` | Cross-dept patterns, org-wide dashboards |

**Parallel tracks:**
- People (staff → volunteer → scheduling) is sequential
- Places (venues) independent
- Calendar (scheduling → gcal → guidebook) is sequential
- Logistics independent
- Collaboration needs multi-tenancy patterns working

#### Phase F: GR Module (depends on Phase E)

| Work Stream | PRDs | Deliverable |
|---|---|---|
| GR Core | `modules/guest-relations/overview.md`, `guest-lifecycle.md`, `pairings-staffing.md`, `prep-tracking.md` | Guest management, staffing, prep |
| GR Documents | `modules/guest-relations/contracts.md`, `itineraries.md` | Contract/itinerary generation |
| GR Transport | `modules/guest-relations/transport-logistics.md` | Flight tracking, ride booking, driver coordination |
| GR External | `modules/guest-relations/guest-self-service.md` | Guest self-service forms |

**Parallel tracks:**
- GR Core (lifecycle + pairings + prep) can run together
- Documents need in-app-documents from Phase D
- Transport needs external-surfaces + integration-patterns from Phase C
- External needs external-surfaces + yoy-registry

#### Phase G: Infrastructure + Polish (runs alongside Phases D-F)

| Work | Deliverable |
|---|---|
| Cloud Run migration | Dockerfile, deployment config, Firebase Hosting rewrites |
| Redis cache layer | Replace in-memory cache, cache invalidation pub/sub |
| Cloud Scheduler | Cron jobs for scheduled workflows |
| Load testing | k6/Artillery scripts for convention weekend simulation |
| CI/CD pipeline | GitHub Actions: test → build → deploy |

### 2. Parallel Work Stream Map

```
Timeline →  Month 1-2    Month 3-4     Month 5-7      Month 8-10    Month 11-14
            ─────────    ─────────     ─────────      ─────────     ─────────
Stream 1:   Phase A      Phase B       Phase C        Phase D       Phase F
            (foundation) (API+core)    (ontology mgmt)(automation)  (GR module)

Stream 2:   Phase A      Phase B       Phase C        Phase D       Phase F
            (schema)     (audit)       (API surface)  (UI render)   (GR docs)

Stream 3:                              Phase G        Phase E       Phase F
                                       (infra)        (shared svc)  (GR ext)

Stream 4:                                             Phase E       Phase G
                                                      (calendar)    (polish)
```

### 3. Milestone Checkpoints

| Milestone | When | What's True |
|---|---|---|
| **M1: Foundation** | End of Phase A | Postgres schema deployed, ontology loads, RBAC evaluates, events fire, auth works |
| **M2: API Live** | End of Phase B | Generic CRUD API operational, audit logging, versioning working |
| **M3: Self-Service** | End of Phase C | Ontology web builder usable, API keys issued, external surfaces working |
| **M4: Automation** | End of Phase D | Workflows execute, forms render dynamically, views render from config |
| **M5: Shared Services** | End of Phase E | Staff/volunteer/venue/scheduling/equipment operational |
| **M6: GR Operational** | End of Phase F | Full GR module: guests, contracts, transport, self-service |
| **M7: Convention Ready** | End of Phase G | Load tested, Cloud Run deployed, monitoring active |

### 4. Test Plan

Each milestone has gate criteria:

| Milestone | Gate |
|---|---|
| M1 | All Phase A unit tests pass, ≥80% coverage |
| M2 | CRUD integration tests pass for 3+ concepts |
| M3 | Ontology web builder E2E: create concept → form renders |
| M4 | Workflow E2E: guest created → prep items appear |
| M5 | Cross-dept E2E: GR confirms guest → Programming sees event |
| M6 | Full GR E2E: guest lifecycle start to finish |
| M7 | Load test: 50 concurrent users, <200ms p95 |
