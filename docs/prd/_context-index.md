# Context Index

Structured manifest for AI agents and human collaborators. Use the **Shorthand** column
to decide if you need to load the full document.

## How to Use

- **Quick context selection:** Read shorthand only. If relevant, load overview.
- **Planning sessions:** Load overviews for all docs in the relevant phase.
- **Implementation:** Load full spec for the target PRD + overviews for its dependencies.
- **Token efficiency:** Never load full specs for docs outside your current scope.

---

## Document Registry

Shorthand is populated as each PRD is written. Empty shorthand = PRD not yet written.

### Meta Documents

| Doc | Path | Shorthand | Status |
|-----|------|-----------|--------|
| README | `README.md` | Navigation, principles, document format. Start here. | done |
| Orchestration | `_orchestration.md` | Build phases (dependency-ordered), agent rules, prompt template, lessons learned. | done |
| Context Index | `_context-index.md` | This file. Updated as PRDs are written. | living |

### Platform (Phase 1)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Vision | `platform/vision.md` | | `vision`, `platform`, `oss`, `shared-service` | pending |
| Architecture | `platform/architecture.md` | | `architecture`, `layers`, `request-lifecycle` | pending |
| Multi-Tenancy | `platform/multi-tenancy.md` | | `multi-tenancy`, `dept-isolation`, `onboarding` | pending |
| Scaling | `platform/scaling.md` | | `scaling`, `cloud-run`, `redis`, `pub-sub`, `cost` | pending |
| OSS Model | `platform/oss-model.md` | | `oss`, `engine-vs-app`, `fork-model` | pending |

### Core Engine (Phases 1-3)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Ontology Engine | `core/ontology-engine.md` | | `ontology`, `concepts`, `properties`, `relationships`, `loading`, `caching` | pending |
| Ontology Scoping | `core/ontology-scoping.md` | | `ontology`, `org-wide`, `dept-wide`, `ownership`, `governance` | pending |
| Ontology Web Builder | `core/ontology-web-builder.md` | | `ontology`, `admin-ui`, `concept-editor`, `property-editor` | pending |
| Ontology CI/QA | `core/ontology-ci-qa.md` | | `ontology`, `validation`, `review-gates`, `rollback`, `impact-analysis` | pending |
| Condition Expression | `core/condition-expression.md` | | `conditions`, `logic-engine`, `field-conditions`, `and-or-not` | pending |
| RBAC Engine | `core/rbac-engine.md` | | `rbac`, `permissions`, `field-level`, `data-scoping`, `roles-as-ontology` | pending |
| Auth System | `core/auth-system.md` | | `auth`, `firebase`, `api-keys`, `token-scoped`, `mcp-delegation` | pending |
| Event Bus | `core/event-bus.md` | | `events`, `pub-sub`, `pattern-matching`, `domain-events` | pending |
| Audit System | `core/audit-system.md` | | `audit`, `actor-types`, `postgres-triggers`, `forensics` | pending |

### Data Layer (Phase 2)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Postgres Schema | `data/postgres-schema.md` | | `postgres`, `schema`, `jsonb`, `indexes`, `fk-constraints` | pending |
| Versioning & Backups | `data/versioning-backups.md` | | `versioning`, `backups`, `audit-triggers`, `rogue-actor`, `rollback` | pending |
| YoY Registry | `data/yoy-registry.md` | | `registry`, `cross-year`, `pre-population`, `analytics` | pending |

### API Surface (Phases 2-3)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Domain CRUD | `api/domain-crud.md` | | `api`, `crud`, `filtering`, `pagination`, `rbac-enforcement` | pending |
| Integration Patterns | `api/integration-patterns.md` | | `api-keys`, `webhooks`, `event-subscriptions`, `internal-apps` | pending |
| External Surfaces | `api/external-surfaces.md` | | `token-auth`, `guest-forms`, `driver-views`, `public-submissions` | pending |
| MCP Surface | `api/mcp-surface.md` | | `mcp`, `ai-agent`, `tool-definitions`, `guardrails`, `rbac-scoped` | pending |

### Automation (Phase 4)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Workflow Engine | `automation/workflow-engine.md` | | `workflows`, `executor`, `triggers`, `conditions`, `transactions` | pending |
| Workflow Actions | `automation/workflow-actions.md` | | `actions`, `create-record`, `notify`, `generate-doc`, `call-api`, `sync-calendar` | pending |
| Workflow Builder | `automation/workflow-builder.md` | | `workflow-ui`, `visual-builder`, `node-editor` | pending |

### UI Rendering (Phase 4)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Dynamic Forms | `ui/dynamic-forms.md` | | `formkit`, `schema-bridge`, `dynamic-form`, `wizard`, `two-column` | pending |
| View Renderer | `ui/view-renderer.md` | | `table`, `kanban`, `timeline`, `dashboard`, `widgets` | pending |
| Form & View Builder | `ui/form-view-builder.md` | | `drag-drop`, `form-builder`, `view-builder`, `config-ui` | pending |
| Condition Builder UI | `ui/condition-builder-ui.md` | | `condition-ui`, `visual-logic`, `shared-component` | pending |
| In-App Documents | `ui/in-app-documents.md` | | `contracts`, `itineraries`, `in-app-views`, `pdf-export` | pending |

### Shared Services (Phase 5)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Staff Management | `shared-services/staff-management.md` | | `staff`, `roles`, `departments`, `assignment` | pending |
| Volunteer Management | `shared-services/volunteer-management.md` | | `volunteers`, `availability`, `skills`, `onboarding` | pending |
| Volunteer Scheduling | `shared-services/volunteer-scheduling.md` | | `shifts`, `coverage`, `conflicts`, `scheduling` | pending |
| Venue Management | `shared-services/venue-management.md` | | `venues`, `rooms`, `capacity`, `equipment` | pending |
| Scheduling & Calendar | `shared-services/scheduling-calendar.md` | | `scheduling`, `events`, `time-blocks`, `room-conflicts` | pending |
| Google Calendar Sync | `shared-services/google-calendar-sync.md` | | `google-calendar`, `bidirectional-sync`, `event-mapping` | pending |
| Guidebook Integration | `shared-services/guidebook-integration.md` | | `guidebook`, `attendee-app`, `schedule-publishing` | pending |
| Equipment & Logistics | `shared-services/equipment-logistics.md` | | `equipment`, `checkout`, `warehouse`, `tracking` | pending |
| Cross-Dept Collaboration | `shared-services/cross-dept-collaboration.md` | | `cross-dept`, `data-visibility`, `ontology-patterns` | pending |

### Guest Relations Module (Phase 6)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| GR Overview | `modules/guest-relations/overview.md` | | `gr`, `module-scope`, `concepts`, `relationships` | pending |
| Guest Lifecycle | `modules/guest-relations/guest-lifecycle.md` | | `guest`, `status-flow`, `invited`, `confirmed`, `attended` | pending |
| Pairings & Staffing | `modules/guest-relations/pairings-staffing.md` | | `pairings`, `liaison`, `interpreter`, `staffing-templates` | pending |
| Prep Tracking | `modules/guest-relations/prep-tracking.md` | | `prep`, `checklist`, `completion`, `overdue`, `alerts` | pending |
| Contracts | `modules/guest-relations/contracts.md` | | `contracts`, `clause-assembly`, `conditions`, `handlebars`, `in-app-view` | pending |
| Itineraries | `modules/guest-relations/itineraries.md` | | `itineraries`, `per-guest-schedule`, `in-app-view`, `pdf-export` | pending |
| Transport & Logistics | `modules/guest-relations/transport-logistics.md` | | `transport`, `flights`, `drivers`, `live-location`, `blacklane`, `flightaware` | pending |
| Guest Self-Service | `modules/guest-relations/guest-self-service.md` | | `self-service`, `external-forms`, `token-auth`, `yoy-prepopulation` | pending |

### Rollout (Phase 7)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Roadmap | `rollout/roadmap.md` | | `roadmap`, `build-order`, `dependencies`, `milestones` | pending |
| Risk Register | `rollout/risk-register.md` | | `risks`, `mitigations`, `bus-factor`, `contingencies` | pending |

---

## Semantic Tag Index

Updated as PRDs are written. Maps tags to doc paths for cross-cutting queries.

| Tag | Documents |
|-----|-----------|
| `ontology` | core/ontology-engine, core/ontology-scoping, core/ontology-web-builder, core/ontology-ci-qa |
| `rbac` | core/rbac-engine, api/domain-crud, api/external-surfaces, api/mcp-surface, platform/multi-tenancy |
| `auth` | core/auth-system, api/integration-patterns, api/external-surfaces, api/mcp-surface |
| `conditions` | core/condition-expression, ui/condition-builder-ui, automation/workflow-engine, modules/gr/contracts |
| `postgres` | data/postgres-schema, data/versioning-backups, data/yoy-registry |
| `events` | core/event-bus, core/audit-system, automation/workflow-engine |
| `workflows` | automation/workflow-engine, automation/workflow-actions, automation/workflow-builder |
| `api` | api/domain-crud, api/integration-patterns, api/external-surfaces, api/mcp-surface |
| `forms` | ui/dynamic-forms, ui/form-view-builder, core/ontology-web-builder |
| `views` | ui/view-renderer, ui/form-view-builder, ui/in-app-documents |
| `scheduling` | shared-services/scheduling-calendar, shared-services/google-calendar-sync, shared-services/guidebook-integration, shared-services/volunteer-scheduling |
| `external` | api/external-surfaces, modules/gr/guest-self-service, modules/gr/transport-logistics |
| `audit` | core/audit-system, data/versioning-backups |
| `platform` | platform/vision, platform/architecture, platform/multi-tenancy, platform/scaling, platform/oss-model |
| `gr` | modules/guest-relations/* |
| `transport` | modules/gr/transport-logistics, shared-services/equipment-logistics |
| `documents` | ui/in-app-documents, modules/gr/contracts, modules/gr/itineraries |
| `shared-services` | shared-services/* |
| `scaling` | platform/scaling, data/postgres-schema |
| `oss` | platform/oss-model, platform/vision |

---

## Dependency Graph

```
Phase 1 (Foundation):
  vision ─────────────────────────────────┐
  architecture ───────────────────────────┤
  postgres-schema ──┬─────────────────────┤
  ontology-engine ──┤                     │
  event-bus ────────┤                     │
  rbac-engine ──────┤                     │
  auth-system ──────┘                     │
                                          │
Phase 2 (Core Services):                  │
  condition-expression ──┐                │
  audit-system ──────────┤                │
  versioning-backups ────┤                │
  yoy-registry ──────────┤                │
  domain-crud ───────────┤                │
  multi-tenancy ─────────┤                │
  scaling ───────────────┤                │
  oss-model ─────────────┘                │
                                          │
Phase 3 (Management + API):              │
  ontology-scoping ──────┐                │
  ontology-web-builder ──┤                │
  ontology-ci-qa ────────┤                │
  integration-patterns ──┤                │
  external-surfaces ─────┤                │
  mcp-surface ───────────┘                │
                                          │
Phase 4 (Automation + UI):               │
  workflow-engine ───────┐                │
  workflow-actions ──────┤                │
  workflow-builder ──────┤                │
  dynamic-forms ─────────┤                │
  view-renderer ─────────┤                │
  condition-builder-ui ──┤                │
  form-view-builder ─────┤                │
  in-app-documents ──────┘                │
                                          │
Phase 5 (Shared Services):               │
  staff-management ──────┐                │
  volunteer-management ──┤                │
  volunteer-scheduling ──┤                │
  venue-management ──────┤                │
  scheduling-calendar ───┤                │
  google-calendar-sync ──┤                │
  guidebook-integration ─┤                │
  equipment-logistics ───┤                │
  cross-dept-collab ─────┘                │
                                          │
Phase 6 (GR Module):                     │
  gr/overview ───────────┐                │
  gr/guest-lifecycle ────┤                │
  gr/pairings-staffing ──┤                │
  gr/prep-tracking ──────┤                │
  gr/contracts ──────────┤                │
  gr/itineraries ────────┤                │
  gr/transport ──────────┤                │
  gr/guest-self-service ─┘                │
                                          │
Phase 7 (Rollout):                       │
  roadmap ───────────────┐                │
  risk-register ─────────┘────────────────┘
```
