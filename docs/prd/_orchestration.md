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
| `process/user-language-standard.md` | Terminology translation table. Property.label is the single source of truth for user-facing text. No jargon. Referenced by all UI PRDs. | When implementing any user-facing text |
| `process/ux-checklist.md` | Every screen answers 4 questions + empty states + loading + errors + a11y + feedback. Checked during acceptance gate. | When implementing any UI screen |
| `process/demo-data-integrity.md` | Zero orphan references across seed data. Forward/backward reference checks. Name/type/temporal consistency. | Before shipping any demo build |
| `process/demo-narrative-quality.md` | Pre/during/post-event stories are coherent and emotionally resonant. Canvas walkthrough produces "aha" moment. | Before shipping any demo build |
| `process/demo-visual-impact.md` | 30-second test, mobile responsiveness, AB branding authenticity, navigation completeness, canvas "wow" moment. | Before shipping any demo build |
| `process/subagent-orchestration.md` | Parallel dispatch rules, scope partitions, model selection, pre-spawn checklist, post-parallel integration | When using subagents for any task |

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

### Phase 4A — Automation + Backend Services

Depends on Phase 2-3 core + API.

| PRD | What | Depends On |
|-----|------|------------|
| `automation/workflow-engine.md` | Executor, trigger evaluation, condition matching, transactions | event-bus, condition-expression, domain-crud |
| `automation/workflow-actions.md` | Each action type spec'd: create_record, notify, generate_doc, call_api, sync_calendar, lookup_registry | workflow-engine, domain-crud, integration-patterns |
| `platform/template-infrastructure.md` | Unified template system (record sets, notifications, documents, presets, workflows). Replaces 6+ separate template tables. | ontology-engine, versioning, workflow-actions |
| `ui/builder-to-operator.md` | Property→input/column mapping, default form/view auto-generation, ontology change impact, builder guardrails | ontology-engine |
| `ui/in-app-documents.md` | Contract/itinerary rendering as first-class views, PDF export | condition-expression |

**Parallel tracks in Phase 4A:**
- Workflow engine → actions is sequential; template-infrastructure parallel
- builder-to-operator and in-app-documents are backend services, parallel

### Phase 4B — Data Infrastructure

Depends on Phase 4A (workflows, templates provide the action layer that data infrastructure routes through).

| PRD | What | Depends On |
|-----|------|------------|
| `data-infrastructure/data-routing.md` | Field-level routing & fan-out with PII filtering | event-bus, rbac-engine, encryption |
| `data-infrastructure/data-transforms.md` | 9 transform types, composable chains, ConditionExpression integration | data-routing, condition-expression |
| `data-infrastructure/internal-pipelines.md` | Cross-department data flows with stages, error handling, dead letter queue | data-routing, data-transforms, workflow-engine |
| `data-infrastructure/external-pipelines.md` | Third-party integrations (FlightAware, Guidebook, Google Calendar), sync state, conflict resolution | data-routing, data-transforms, integration-patterns |
| `data-infrastructure/data-quality.md` | Completeness, consistency, staleness, dedup rules using ConditionExpression | condition-expression, data-routing |
| `data-infrastructure/data-lineage.md` | Provenance tracking, forward/backward trace, impact analysis | audit-system, event-bus, data-routing |
| `data-infrastructure/data-security.md` | PII governance, data classification, breach detection, retention, right-to-deletion | encryption, rbac-engine, audit-system |
| `data-infrastructure/data-observability.md` | Pipeline health, freshness, throughput, alerting | data-routing, internal-pipelines, external-pipelines |
| `data-infrastructure/notifications.md` | Email + in-app delivery, templates, preferences, digest mode | template-infrastructure, event-bus |
| `data-infrastructure/real-time.md` | SSE-based live updates with RBAC filtering | event-bus, rbac-engine |
| `data-infrastructure/platform-search.md` | Typesense integration, RBAC-filtered search, autocomplete | event-bus, rbac-engine, ontology-engine |

**Parallel tracks in Phase 4B:**
- data-routing → data-transforms → internal-pipelines → external-pipelines is sequential
- data-quality, data-lineage, data-security can run in parallel (all depend on data-routing)
- data-observability depends on pipelines
- notifications, real-time, platform-search are independent infrastructure

### Phase 4.5 — Frontend + Canvas

Depends on Phase 4A (backend services) and Phase 4B (data infrastructure provides the data that canvas visualizes).

Builder and canvas are parallel interfaces: builders serve technical/power users, canvas serves visual/no-code users. They read and write the same underlying data.

| PRD | What | Depends On |
|-----|------|------------|
| `canvas/canvas-engine.md` | Vue Flow rendering infrastructure, node/edge types, modes, layout, accessibility | — (domain-agnostic) |
| `canvas/system-visualization-architecture.md` | Architectural keystone: collector pattern, unified VisualizationGraph, builder↔canvas coherence, data infrastructure bridge | ALL Phase 4A + 4B PRDs |
| `canvas/system-graph.md` | Auto-generated ontology visualization, 3 zoom levels, editable | canvas-engine, system-visualization-architecture |
| `canvas/workflow-canvas.md` | Workflow flow diagrams, cascade visualization, dry-run | canvas-engine, system-visualization-architecture, workflow-engine |
| `canvas/data-flow-canvas.md` | Field-level routing visualization, PII indicators, transform nodes | canvas-engine, system-visualization-architecture, data-routing |
| `canvas/canvas-config-bridge.md` | Bidirectional binding, CI/QA integration, conflict resolution, undo/redo | canvas-engine, ontology-ci-qa |
| `canvas/canvas-rbac.md` | 5-role visibility matrix, edit permissions, offline behavior | canvas-engine, rbac-engine |
| `ui/dynamic-forms.md` | FormKit schema bridge, DynamicForm component, wizard/2-col layouts | ontology-engine, builder-to-operator |
| `ui/view-renderer.md` | Table, kanban, timeline, dashboard widget rendering | ontology-engine, builder-to-operator |
| `ui/condition-builder-ui.md` | Shared visual builder for ConditionExpressions | condition-expression |
| `ui/form-view-builder.md` | Drag-drop config UI for forms + views | dynamic-forms, view-renderer, condition-builder-ui |
| `automation/workflow-builder.md` | Visual node editor for building workflows (traditional builder — coexists with workflow canvas) | workflow-engine, workflow-actions, condition-builder-ui |
| `platform/branding.md` | Convention branding as config (colors, fonts, logo). Neutral OSS default + convention-specific themes. Token rename, runtime branding, settings UI, color scale generation. | All UI components |

**Parallel tracks in Phase 4.5:**
- Canvas engine → system-visualization-architecture is sequential (engine first, then architecture)
- system-graph, workflow-canvas, data-flow-canvas can run in parallel (all depend on architecture)
- canvas-config-bridge and canvas-rbac are parallel infrastructure
- UI rendering (forms + views + condition builder) can run in parallel with canvas work
- form-view-builder depends on forms + views completing
- workflow-builder is independent of canvas (parallel interface for different users)
- branding applies to ALL components — should be established early so components build on the design system

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

### Phase 6 — GR Module (Config-Driven)

Depends on Phase 5 shared services (especially staff, scheduling, venues).

**Cross-cutting requirement:** Every operational page in this phase MUST render through ViewConfig/FormConfig/PageConfig loaded from Postgres. No hardcoded DataTable implementations. No bespoke 700-line layout files. The config-driven rendering engine built in Phases 3-4.5 is the foundation — Phase 6 USES it. If a page is a hardcoded Vue file instead of a config-driven renderer, it's wrong.

| PRD | What | Depends On |
|-----|------|------------|
| `modules/guest-relations/config-integration.md` | **How config-driven rendering connects to GR Module views. The integration bridge that was missing in the first attempt.** | view-renderer, dynamic-forms, form-view-builder, ontology-engine |
| `modules/guest-relations/overview.md` | GR scope, concepts, relationships, department-centric settings config | multi-tenancy, ontology-scoping, config-integration |
| `modules/guest-relations/guest-lifecycle.md` | Invited→Confirmed→Attended flow, status workflows, config-driven forms/views | workflow-engine, dynamic-forms, config-integration |
| `modules/guest-relations/pairings-staffing.md` | Liaison/interpreter assignment, staffing templates, coverage, config-driven views | staff-management, volunteer-management, config-integration |
| `modules/guest-relations/prep-tracking.md` | Prep items per guest, completion %, overdue alerts, config-driven views | workflow-engine, view-renderer, config-integration |
| `modules/guest-relations/contracts.md` | Clause assembly, ConditionExpression per clause, Handlebars, in-app view | condition-expression, in-app-documents, workflow-actions (generate_doc) |
| `modules/guest-relations/itineraries.md` | Per-guest schedule view from schedule + transport + events, config-driven rendering | scheduling-calendar, in-app-documents, config-integration |
| `modules/guest-relations/transport-logistics.md` | Bookings, flights, drivers (phase-aware: pre-event=vendor only, during/post=named), live location | workflow-actions (call_api), external-surfaces, integration-patterns |
| `modules/guest-relations/guest-self-service.md` | External forms, token auth, YoY pre-population, save-and-resume, config-driven forms | external-surfaces, yoy-registry, dynamic-forms, config-integration |

**Parallel tracks in Phase 6:**
- config-integration is foundational — must be first
- overview depends on config-integration
- guest-lifecycle + pairings + prep-tracking can run in parallel (all depend on config-integration)
- contracts + itineraries depend on rendering + workflows
- transport + self-service depend on external surfaces + integrations

**Phase 6 Acceptance Criteria (Non-Negotiable):**
- [ ] FormConfig loaded from API drives the guest intake form
- [ ] ViewConfig loaded from API drives the guest list view
- [ ] PageConfig loaded from API drives the dashboard widget layout
- [ ] Zero hardcoded DataTable/layout files for operational pages
- [ ] All UI tabs and buttons are functional, not cosmetic
- [ ] Settings page is department-centric
- [ ] List views use card/record layouts, not raw spreadsheet grids
- [ ] Behavioral verification: load guest list from DB config and render correctly end-to-end
- [ ] The ontology thesis is demonstrably true: source code is engine, database is application

### Phase 7 — Launch Infrastructure (Demo + Docs)

Depends on Phase 6 (GR Module must be config-driven before demo can showcase it).

**Purpose:** The demo IS the real app deployed with `VITE_DEMO_MODE=true`. Reads hit real Postgres (Neon on Vercel). Writes intercepted by localStorage adapter. Seeded with authentic AB data across three temporal views. All builder views functional. No mock HTTP layers. No separate codebase.

| PRD | What | Depends On |
|-----|------|------------|
| `platform/demo-architecture.md` | Hybrid read/write model, localStorage adapter, DEMO_MODE flag, seed data scope, import/export, reset-to-seed. Single `demo-store.ts`, no parallel infrastructure. | All implementation phases |
| `platform/demo-deployment.md` | Vercel hosting (free tier), demo branch strategy, build pipeline, preview-deploy-per-PR. GitHub Pages disqualified. | demo-architecture |
| `platform/demo-data-narrative.md` | Seed data for 3 temporal states (pre/during/post event). Authentic AB data (Japanese names, Hynes venues, anime scheduling). Canvas walkthrough. Driver names visible during/post only. | demo-architecture |
| `platform/demo-showcase.md` | Updated: references demo-architecture/deployment/narrative PRDs. Removed all GitHub Pages and static HTML references. | demo-architecture, demo-deployment, demo-data-narrative |
| `docs/launch-guide/` series | Platform-agnostic primary path + Vercel-specific callouts. Environment setup, deployment, ontology seeding, demo mode, admin setup, first-run. | All implementation phases |

**Phase 7 Acceptance Criteria:**
- [ ] Demo deployed on Vercel from `demo` branch, publicly accessible without login
- [ ] All views render data immediately on load (no blank states)
- [ ] Canvas uses proper layout algorithm (force-directed or dagre), not raw grid
- [ ] Pre/during/post event views tell a believable story with authentic AB data
- [ ] Import/export and reset-to-seed work correctly
- [ ] All builder views functional with seeded config data
- [ ] Three demo process PRDs (data-integrity, narrative-quality, visual-impact) pass their gates
- [ ] Launch guide docs exist and are platform-agnostic with Vercel callouts
- [ ] Driver names visible during/post-event only; pre-event shows company/vendor details only

### Phase 8 — Rollout Planning

Depends on all above (reads everything to produce build plan + risk analysis). Renumbered from Phase 7.

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
11. **Mandatory PRD discovery before writing.** Read `_context-index.md`, `_orchestration.md`, and relevant subfolder PRDs before drafting ANY new PRD. Never write a PRD in a vacuum.
12. **Config-driven rendering is non-negotiable in Phase 6+.** Every operational page must render through ViewConfig/FormConfig/PageConfig loaded from Postgres. If a page is hardcoded, it fails the acceptance gate.
13. **Behavioral verification required.** "Tests pass" and "build succeeds" are necessary but NOT sufficient. Navigate to the actual page and verify it renders real data through config-driven renderers.

## Agent Prompt Template

When spawning an agent to write a PRD:

```
You are writing an atomic PRD for the GR-Ops convention operations platform.

Repository: C:/Users/buddah laptop/Documents/GitHub/AB_GR-Operations
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
- Phase 6 failed because infrastructure was built but never connected to the frontend — integration is a first-class acceptance criterion
- The demo is NOT a separate artifact — it is the real app with `DEMO_MODE=true` and a localStorage write adapter
- Progressive disclosure is rejected — show everything, explain clearly
- List views must use card/record layouts, not spreadsheet grids
- Every page must render from DB config. A hardcoded Vue page is a failure, not a shortcut
- "Close enough" after one verification cycle is the exact shortcut the completion protocol prevents
