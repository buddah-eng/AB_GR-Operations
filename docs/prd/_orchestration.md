# Orchestration Plan

How to build the platform, in what order, and why.

## Process PRDs (Evergreen — Apply to Every Phase)

These are not features. They are mandatory verification procedures that run after every PRD implementation and before every phase advancement. They exist because the project repeatedly failed at wiring, completeness, and honest status reporting.

| PRD | What | When to Run |
|-----|------|-------------|
| `process/wiring-audit.md` | No dead exports, no orphan columns, no broken cross-module dependencies | After every PRD implementation |
| `process/write-pipeline.md` | Every write endpoint follows the full 10-step pipeline (auth→RBAC→audit→validate→encrypt→write→event→claim) | After implementing any write endpoint |
| `process/acceptance-gate.md` | Line-by-line verification of every acceptance criteria with evidence (file+line+test) | Before declaring any phase complete |
| `process/phase-discipline.md` | One phase at a time, read PRD before coding, no combining phases, honest status | Always |
| `process/session-state.md` | Save corrections, gap analyses, and phase status to memory immediately | Always |
| `process/phase-completion.md` | Iterative multi-pass verification cycle. Automated scans → write pipeline → acceptance criteria → fresh-eyes → build. Loops until zero findings. | Before declaring ANY phase complete |
| `process/deferred-backlog.md` | Living tracker for deferred acceptance criteria. Each has a gate condition. Gates checked at phase start. Met gates become current-phase requirements. | At phase start and when deferring |

**These are not optional.** A phase cannot be declared complete unless all 7 process PRDs are satisfied. The phase-completion protocol is the final gate — it runs in cycles until a complete cycle finds zero issues. Any deferred items must be in the backlog with gate conditions.

---

## Build Phases (Dependency-Ordered)

Phases represent build ORDER based on what depends on what. Everything ships.
Multiple phases can run in parallel where dependencies are met.

### Phase 1 — Foundation

These have no upstream dependencies. Everything else depends on them.

| PRD | What | Blocks |
|-----|------|--------|
| `platform/vision.md` | Problem, thesis, platform-as-service model | All other docs (framing) |
| `platform/architecture.md` | Layers, request lifecycle, module map | All implementation |
| `data/postgres-schema.md` | Tables, JSONB strategy, indexes, FK constraints | All data access |
| `data/integration-testing.md` | Testcontainers infrastructure, migration runner, schema/trigger/constraint verification | All integration tests |
| `core/ontology-engine.md` | Concept/property/relationship loading + caching | All domain features |
| `core/event-bus.md` | Domain event pub/sub, pattern matching | Workflows, audit, integrations |
| `core/rbac-engine.md` | Permissions, field-level filtering, data scoping. Roles are ontology-defined. | All access control |
| `core/auth-system.md` | Firebase OAuth, API keys, token-scoped, MCP delegation | All authenticated access |

**Parallel tracks in Phase 1:**
- Schema + ontology engine can be built simultaneously (ontology reads from schema)
- Integration testing infrastructure can be built alongside schema (depends on migration files existing)
- RBAC + auth can be built simultaneously (auth resolves identity, RBAC evaluates permissions)
- Event bus is independent

### Phase 2 — Core Platform Services

Depends on Phase 1 foundation.

| PRD | What | Depends On |
|-----|------|------------|
| `core/condition-expression.md` | Universal logic engine (used in RBAC, forms, workflows, contracts, constraints) | ontology-engine |
| `core/audit-system.md` | Human/AI/API actor tracking, Postgres triggers, forensics | event-bus, auth-system, postgres-schema |
| `data/versioning-backups.md` | Row versioning, nightly snapshots, audit triggers, rogue actor protection | postgres-schema, audit-system |
| `data/yoy-registry.md` | Cross-year persistent data, pre-population, analytics | postgres-schema |
| `api/domain-crud.md` | Generic CRUD, filtering, pagination, RBAC enforcement, event emission | ontology-engine, rbac-engine, event-bus |
| `platform/multi-tenancy.md` | Dept isolation via ontology scoping + RBAC, dept onboarding | ontology-engine, rbac-engine |
| `platform/scaling.md` | Firebase → Cloud Run + Redis + Pub/Sub, cost model | architecture |
| `platform/oss-model.md` | Engine vs application, what's public vs private, fork model | architecture, multi-tenancy |

**Parallel tracks in Phase 2:**
- condition-expression + audit-system + versioning can run together
- domain-crud depends on ontology + RBAC + events (all Phase 1)
- multi-tenancy + scaling + oss-model are platform docs, independent of implementation PRDs

### Phase 3 — Ontology Management + API Surface

Depends on Phase 2 core services.

| PRD | What | Depends On |
|-----|------|------------|
| `core/ontology-scoping.md` | Org-wide vs dept-wide ownership, governance model | ontology-engine, multi-tenancy, rbac-engine |
| `core/ontology-web-builder.md` | Admin UI: concept/property/relationship editors | ontology-engine, ontology-scoping, domain-crud |
| `core/ontology-ci-qa.md` | Validation pipeline, review gates, impact analysis, rollback | ontology-engine, ontology-scoping, versioning-backups |
| `api/integration-patterns.md` | API keys, webhooks, event subscriptions, internal app consumption | domain-crud, auth-system, event-bus |
| `api/external-surfaces.md` | Token auth, guest forms, driver views, public submissions, save-and-resume | domain-crud, auth-system, rbac-engine |
| `api/mcp-surface.md` | Personal AI agent access, tool definitions, RBAC-scoped, guardrails | domain-crud, auth-system, rbac-engine, audit-system |

**Parallel tracks in Phase 3:**
- Ontology management (scoping → builder → CI/QA) is sequential
- API surface (integration, external, MCP) can run in parallel — all depend on domain-crud + auth

### Phase 4 — Automation + UI Rendering

Depends on Phase 2-3 core + API.

| PRD | What | Depends On |
|-----|------|------------|
| `automation/workflow-engine.md` | Executor, trigger evaluation, condition matching, transactions | event-bus, condition-expression, domain-crud |
| `automation/workflow-actions.md` | Each action type spec'd: create_record, notify, generate_doc, call_api, sync_calendar, lookup_registry | workflow-engine, domain-crud, integration-patterns |
| `automation/workflow-builder.md` | Visual node editor for building workflows | workflow-engine, workflow-actions, condition-builder-ui |
| `ui/dynamic-forms.md` | FormKit schema bridge, DynamicForm component, wizard/2-col layouts | ontology-engine, domain-crud, condition-expression |
| `ui/view-renderer.md` | Table, kanban, timeline, dashboard widget rendering | ontology-engine, domain-crud |
| `ui/condition-builder-ui.md` | Shared visual builder for ConditionExpressions | condition-expression |
| `ui/form-view-builder.md` | Drag-drop config UI for forms + views | dynamic-forms, view-renderer, condition-builder-ui, ontology-web-builder |
| `ui/in-app-documents.md` | Contract/itinerary rendering as first-class views, PDF export | dynamic-forms, view-renderer |

**Parallel tracks in Phase 4:**
- Automation (engine → actions → builder) is sequential
- UI rendering (forms + views + condition builder) can run in parallel
- form-view-builder depends on both forms and views completing
- in-app-documents depends on forms + views

### Phase 5 — Shared Services

Depends on Phase 4 rendering + automation.

| PRD | What | Depends On |
|-----|------|------------|
| `shared-services/staff-management.md` | Staff records, role assignment, department membership | domain-crud, rbac-engine, dynamic-forms |
| `shared-services/volunteer-management.md` | Volunteer records, availability, skills, onboarding | staff-management |
| `shared-services/volunteer-scheduling.md` | Shift assignment, coverage tracking, conflict detection | volunteer-management, scheduling-calendar |
| `shared-services/venue-management.md` | Rooms, capacities, equipment, scheduling constraints | domain-crud, dynamic-forms |
| `shared-services/scheduling-calendar.md` | Event/calendar management, time blocks, room conflicts | venue-management, domain-crud, workflow-engine |
| `shared-services/google-calendar-sync.md` | Bidirectional sync, event mapping, conflict resolution | scheduling-calendar, workflow-actions (sync_calendar) |
| `shared-services/guidebook-integration.md` | Publishing schedule to Guidebook attendee app, sync model | scheduling-calendar, integration-patterns |
| `shared-services/equipment-logistics.md` | Checkout, tracking, warehouse app integration | venue-management, integration-patterns |
| `shared-services/cross-dept-collaboration.md` | How ontology enables cross-dept data visibility, patterns | multi-tenancy, ontology-scoping, rbac-engine |

**Parallel tracks in Phase 5:**
- Staff → volunteer → volunteer scheduling is sequential
- Venue → scheduling → google cal → guidebook is sequential
- Equipment + cross-dept are independent tracks

### Phase 6 — GR Module (Department-Specific)

Depends on Phase 5 shared services (especially staff, scheduling, venues).

| PRD | What | Depends On |
|-----|------|------------|
| `modules/guest-relations/overview.md` | GR scope, concepts, relationships, department config | multi-tenancy, ontology-scoping |
| `modules/guest-relations/guest-lifecycle.md` | Invited→Confirmed→Attended flow, status workflows | workflow-engine, dynamic-forms |
| `modules/guest-relations/pairings-staffing.md` | Liaison/interpreter assignment, staffing templates, coverage | staff-management, volunteer-management |
| `modules/guest-relations/prep-tracking.md` | Prep items per guest, completion %, overdue alerts | workflow-engine, view-renderer |
| `modules/guest-relations/contracts.md` | Clause assembly, ConditionExpression per clause, Handlebars, in-app view | condition-expression, in-app-documents, workflow-actions (generate_doc) |
| `modules/guest-relations/itineraries.md` | Per-guest schedule view from schedule + transport + events | scheduling-calendar, in-app-documents |
| `modules/guest-relations/transport-logistics.md` | Bookings, flights, drivers, live location, Blacklane/FlightAware | workflow-actions (call_api), external-surfaces, integration-patterns |
| `modules/guest-relations/guest-self-service.md` | External forms, token auth, YoY pre-population, save-and-resume | external-surfaces, yoy-registry, dynamic-forms |

**Parallel tracks in Phase 6:**
- overview is foundational for the module
- guest-lifecycle + pairings + prep-tracking can run in parallel
- contracts + itineraries depend on rendering + workflows
- transport + self-service depend on external surfaces + integrations

### Phase 7 — Rollout Planning

Depends on all above (reads everything to produce build plan + risk analysis).

| PRD | What | Depends On |
|-----|------|------------|
| `rollout/roadmap.md` | Dependency-ordered build plan, parallel work streams, milestones | All PRDs |
| `rollout/risk-register.md` | Threats, mitigations, contingencies | All PRDs |

---

## Agent Orchestration Rules

When using AI agents to write PRDs:

1. **Never mention Notion.** Not as legacy, not as migration source, not as comparison. The platform uses Postgres. Period.
2. **Roles are ontology-defined.** Never enumerate a fixed role list. Roles are concepts in the DB, editable by admin.
3. **Everything ships.** Do not suggest deferring features to "Y2" or "future." The build plan is dependency-ordered, not scope-reduced.
4. **Contracts and itineraries are in-app views** with PDF export. Not external documents, not Google Docs.
5. **The platform is a shared service.** One deployment, all departments. Dept isolation is via ontology scoping + RBAC.
6. **Each PRD is atomic.** Independently verifiable. Has its own test plan, acceptance criteria, inputs/outputs.
7. **Read upstream dependencies first.** An agent writing `workflow-engine.md` must have context from `event-bus.md` and `condition-expression.md`.
8. **Three-tier format.** Every doc: shorthand (blockquote) → overview (1 page) → full specification (atomic sub-sections).
9. **Reference actual code.** Ground specs in the existing codebase at `/home/user/AB_GR-Operations/`. Cite file paths and interfaces.
10. **Include test plans.** Every atomic sub-section specifies what to test, TDD approach, ≥80% coverage target.

## Agent Prompt Template

When spawning an agent to write a PRD:

```
You are writing an atomic PRD for the GR-Ops convention operations platform.

Repository: /home/user/AB_GR-Operations
Read the codebase to ground your spec in reality.

KEY CONTEXT:
- Postgres is the SOR. The ontology, config, permissions, workflows, and data all live in Postgres.
- Source code = engine, database = application. The repo is OSS-safe; all convention-specific value is in the DB.
- The platform is a shared service: one deployment serves all departments, isolated by ontology scoping + RBAC.
- Roles are ontology-defined and admin-editable. Do not hardcode role lists.
- Everything ships. Do not defer features. Order by dependency, not scope.
- Contracts/itineraries are in-app views with PDF export.

UPSTREAM DEPENDENCIES (read these files first for context):
[list the dependency PRDs that should exist by now]

WRITE: [file path]
TOPIC: [what this PRD covers]
FORMAT: Three tiers — shorthand (blockquote) → overview (1 page) → full specification
EACH SUB-SECTION MUST HAVE: purpose, inputs/outputs, dependencies, implementation detail, test plan, acceptance criteria, decisions/rationale
```

## Lessons Learned

- Batch-launching agents without shared context produces inconsistent output and Notion contamination
- Agents must read upstream PRDs before writing downstream ones — stagger by phase
- The context index must be written AFTER all PRDs, not before — it summarizes what exists
- Platform framing (shared service, OSS model, multi-tenancy) must be established before any implementation PRDs
