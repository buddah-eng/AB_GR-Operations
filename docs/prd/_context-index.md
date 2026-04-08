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

### Meta Documents

| Doc | Path | Shorthand | Status |
|-----|------|-----------|--------|
| README | `README.md` | Navigation, principles, document format. Start here. | done |
| Orchestration | `_orchestration.md` | Build phases (dependency-ordered), agent rules, prompt template, lessons learned. | done |
| Context Index | `_context-index.md` | This file. 53 docs across 9 folders. Semantic tags + dependency graph. | living |

### Platform

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Vision | `platform/vision.md` | Source code = engine, DB = application. Ontology-driven, API-first, OSS-safe. Platform is shared service for all departments. | `vision`, `platform`, `oss`, `shared-service` | done |
| Architecture | `platform/architecture.md` | 5 layers (presentation/API/engine/data/external). Request lifecycle trace. 4 consumer types through same middleware. Cloud Run + Postgres + Redis. | `architecture`, `layers`, `request-lifecycle` | done |
| Multi-Tenancy | `platform/multi-tenancy.md` | One Postgres, one API. Depts isolated by ontology scoping + RBAC, not infra. Onboarding = config rows, zero deploys. | `multi-tenancy`, `dept-isolation`, `onboarding` | done |
| Scaling | `platform/scaling.md` | Cloud Functions → Cloud Run + Redis + Pub/Sub. Scale to zero ($0 off-season). 50-100 concurrent users during con. ~$50-80/mo active. | `scaling`, `cloud-run`, `redis`, `pub-sub`, `cost` | done |
| OSS Model | `platform/oss-model.md` | Engine (repo) vs application (DB). AGPL-3.0. Fork → deploy → populate ontology. No convention-specific data in source. | `oss`, `engine-vs-app`, `fork-model` | done |
| Branding | `platform/branding.md` | Colors/fonts/logo as config, not code. ab-* → primary-*. Tailwind from env vars. Runtime branding from DB. Settings UI with color picker. | `branding`, `theming`, `tailwind`, `config` | done |

### Core Engine

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Ontology Engine | `core/ontology-engine.md` | 5 tables (concepts, properties, relationships, events, constraints). 17 property types. Loader builds OntologyCache. Config subsystems (forms, views, pages, workflows). Concept inheritance via extends. | `ontology`, `concepts`, `properties`, `relationships`, `loading`, `caching` | done |
| Ontology Scoping | `core/ontology-scoping.md` | owner_scope (org/department) + owner_department. Org-wide = admin only. Dept = director. Property extension pattern. Conflict resolution via composite uniqueness. | `ontology`, `org-wide`, `dept-wide`, `ownership`, `governance` | done |
| Ontology Web Builder | `core/ontology-web-builder.md` | Admin UI: concept manager, property editor (17 types, drag reorder), relationship editor, constraint editor. Safety guardrails (no type change on populated fields, no delete with data). | `ontology`, `admin-ui`, `concept-editor`, `property-editor` | done |
| Ontology CI/QA | `core/ontology-ci-qa.md` | ALL config changes (ontology, workflows, forms, views, RBAC): Draft→Validate→Review→Stage→Apply→Monitor→Rollback. Cross-system validation. Impact analysis. Review gates by scope/risk. | `ontology`, `validation`, `review-gates`, `rollback`, `impact-analysis`, `cross-system` | done |
| Condition Expression | `core/condition-expression.md` | Universal logic engine. 4 types (field/and/or/not), 10 operators. Used in constraints, form showIf, workflow conditions, contract clauses, RBAC scoping. Stored as JSONB. | `conditions`, `logic-engine`, `field-conditions`, `and-or-not` | done |
| RBAC Engine | `core/rbac-engine.md` | Roles as ontology concepts (admin-editable). Per role+concept: CRUD + field-level visibility/editability. 4 data scope types (all/relation/field/department). Deny by default. | `rbac`, `permissions`, `field-level`, `data-scoping`, `roles-as-ontology` | done |
| Auth System | `core/auth-system.md` | 4 auth methods: Firebase OAuth, API keys, token-scoped, MCP delegation. All resolve to same identity+role. Actor types for audit. Dev bypass for emulator. | `auth`, `firebase`, `api-keys`, `token-scoped`, `mcp-delegation` | done |
| Event Bus | `core/event-bus.md` | Domain event pub/sub with glob patterns. Priority-ordered sequential execution. Error isolation. Event logging to Postgres. Scaling path to Pub/Sub for cross-service. | `events`, `pub-sub`, `pattern-matching`, `domain-events` | done |
| Audit System | `core/audit-system.md` | 5 actor types. Dual audit tables (ontology + domain). Postgres triggers catch direct SQL. Change set grouping. Rogue actor detection via bidirectional mismatch. Forensics queries. | `audit`, `actor-types`, `postgres-triggers`, `forensics` | done |

### Data Layer

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Postgres Schema | `data/postgres-schema.md` | Typed core columns + JSONB properties. 6 table families (ontology, config, RBAC, domain, audit, infra). Versioning columns on all ontology tables. GIN indexes. Audit triggers. Full CREATE TABLE SQL. | `postgres`, `schema`, `jsonb`, `indexes`, `fk-constraints` | done |
| Versioning & Backups | `data/versioning-backups.md` | Row-level versioning (version chain, status swap rollback). Nightly pg_dump per table (90-day retention). Postgres audit triggers. Rogue actor protection (5 layers). Disaster recovery playbook. | `versioning`, `backups`, `audit-triggers`, `rogue-actor`, `rollback` | done |
| YoY Registry | `data/yoy-registry.md` | is_registry=true concepts persist cross-year. guest_registry + vendor_registry tables. Pre-population for returning guests. Analytics queries (return rates, cohort). Post-convention archive strategy. | `registry`, `cross-year`, `pre-population`, `analytics` | done |
| Encryption | `data/encryption.md` | AES-256-GCM column-level encryption for PII. 11 encrypted field types. Application-layer (key never reaches DB). Decrypt only after RBAC field filter. Key in Secret Manager. | `encryption`, `pii`, `aes-256`, `secret-manager` | done |

### API Surface

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Domain CRUD | `api/domain-crud.md` | 5 concept-agnostic endpoints (POST/GET/PUT/DELETE). Filter/sort/paginate. RBAC at every layer. Domain events on all writes. Change tracking (diff old vs new). References actual domains.ts code. | `api`, `crud`, `filtering`, `pagination`, `rbac-enforcement` | done |
| Integration Patterns | `api/integration-patterns.md` | API key auth (api_clients table). Webhook subscriptions with HMAC-SHA256. Rate limiting per key. Examples: warehouse, calendar sync, badge system. API versioning strategy. OpenAPI spec. | `api-keys`, `webhooks`, `event-subscriptions`, `internal-apps` | done |
| External Surfaces | `api/external-surfaces.md` | Token-scoped auth (X-Guest-Token/X-Driver-Token). Guest self-service forms (save-and-resume). Driver view (minimal data, status buttons). Public forms (future). Security (no enumeration, rate limits, CORS). | `token-auth`, `guest-forms`, `driver-views`, `public-submissions` | done |
| MCP Surface | `api/mcp-surface.md` | Personal AI agent via MCP. Firebase token delegation. 7 tool definitions mapped to API. Tool annotations (readOnly/destructive). Guardrails (no raw DB, bulk limits). ai_agent audit trail. | `mcp`, `ai-agent`, `tool-definitions`, `guardrails`, `rbac-scoped` | done |

### Automation

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Workflow Engine | `automation/workflow-engine.md` | WorkflowConfig: trigger (domain_event/scheduled/manual/field_changed) + condition (ConditionExpression) + action chain. Sequential execution with Postgres transactions. 4 concrete AB examples. | `workflows`, `executor`, `triggers`, `conditions`, `transactions` | done |
| Workflow Actions | `automation/workflow-actions.md` | 9 action types spec'd individually: create_record, create_records, update_record, delete_record, notify, sync_calendar, generate_doc, call_api, lookup_registry. Token interpolation for chaining. | `actions`, `create-record`, `notify`, `generate-doc`, `call-api`, `sync-calendar` | done |
| Workflow Builder | `automation/workflow-builder.md` | Visual 3-panel editor: trigger picker, condition builder, action chain with drag-drop. Dry-run testing against real records. CI/QA integration (loop detection, rate estimation). | `workflow-ui`, `visual-builder`, `node-editor` | done |

### UI Rendering

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Dynamic Forms | `ui/dynamic-forms.md` | FormKit schema bridge (type mapping, validation mapping). DynamicForm component. 3 layouts (single/two-column/wizard). Conditional visibility (showIf). Relation autocomplete. YoY pre-population. | `formkit`, `schema-bridge`, `dynamic-form`, `wizard`, `two-column` | done |
| View Renderer | `ui/view-renderer.md` | 5 view types: table (PrimeVue DataTable), kanban (drag-drop status), timeline (date fields), detail, dashboard (widgets). DynamicView component. View presets. | `table`, `kanban`, `timeline`, `dashboard`, `widgets` | done |
| Form & View Builder | `ui/form-view-builder.md` | Drag-drop form canvas with layout picker and wizard step editor. View type config with column/filter/sort/groupBy. Quick-create defaults. CI/QA pipeline integration. | `drag-drop`, `form-builder`, `view-builder`, `config-ui` | done |
| Condition Builder UI | `ui/condition-builder-ui.md` | Shared ConditionExpression visual component. Field picker, operator filtering by type, compound and/or/not grouping, human-readable preview. Used in 5+ places. | `condition-ui`, `visual-logic`, `shared-component` | done |
| In-App Documents | `ui/in-app-documents.md` | Contracts (conditional clause assembly, Handlebars, 14 clause inventory) and itineraries (per-guest schedule aggregation) as in-app views. PDF export via HTML→PDF. Template management via ontology. | `contracts`, `itineraries`, `in-app-views`, `pdf-export` | done |

### Shared Services

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Staff Management | `shared-services/staff-management.md` | Staff concept (name, email, role, department, languages, availability). Role assignment via ontology. Department membership. Staff directory with RBAC-filtered contact info. | `staff`, `roles`, `departments`, `assignment` | done |
| Volunteer Management | `shared-services/volunteer-management.md` | Extends staff. Skills, training status, availability, emergency contact. Onboarding flow (apply→review→approve→train). Skill-based assignment matching. | `volunteers`, `availability`, `skills`, `onboarding` | done |
| Volunteer Scheduling | `shared-services/volunteer-scheduling.md` | Shift concept (venue, time, required count, required skills). Assignment matching. Coverage tracking (assigned vs required). Swap/cancellation flow. | `shifts`, `coverage`, `conflicts`, `scheduling` | done |
| Venue Management | `shared-services/venue-management.md` | Venue concept (type, capacity, equipment, floor). Room scheduling with conflict detection. Equipment tracking per venue. Capacity enforcement. | `venues`, `rooms`, `capacity`, `equipment` | done |
| Scheduling & Calendar | `shared-services/scheduling-calendar.md` | Schedule event concept (type, venue, times, guests, staff). Room conflict detection. Time block management. Cross-department scheduling. Priority-based conflict resolution. | `scheduling`, `events`, `time-blocks`, `room-conflicts` | done |
| Google Calendar Sync | `shared-services/google-calendar-sync.md` | Bidirectional sync (platform is SOR). Event field mapping. Per-department calendars. sync_calendar workflow action. Service account auth. | `google-calendar`, `bidirectional-sync`, `event-mapping` | done |
| Guidebook Integration | `shared-services/guidebook-integration.md` | One-way push to attendee app. Schedule events + guest bios + venue info. Publish workflow (manual/nightly). Incremental sync with last_published_at. | `guidebook`, `attendee-app`, `schedule-publishing` | done |
| Equipment & Logistics | `shared-services/equipment-logistics.md` | Equipment concept with checkout lifecycle. Warehouse app API integration. Delivery→prep completion chain. Overdue alerts. Lost item reporting. | `equipment`, `checkout`, `warehouse`, `tracking` | done |
| Cross-Dept Collaboration | `shared-services/cross-dept-collaboration.md` | Shared concepts enable JOINs. RBAC controls cross-dept visibility (field-level). Event bus automates coordination. Org-wide dashboards with multi-concept widgets. | `cross-dept`, `data-visibility`, `ontology-patterns` | done |

### Guest Relations Module

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| GR Overview | `modules/guest-relations/overview.md` | 8 concepts (guest, pairing, prep_item, transport_booking, etc.). Relationships, roles, workflows, integration points with shared services. | `gr`, `module-scope`, `concepts`, `relationships` | done |
| Guest Lifecycle | `modules/guest-relations/guest-lifecycle.md` | draft→invited→confirmed→travel_arranged→arrived→attending→departed. Each transition triggers workflows. Guest types (JP/NA/other) determine constraints. | `guest`, `status-flow`, `invited`, `confirmed`, `attended` | done |
| Pairings & Staffing | `modules/guest-relations/pairings-staffing.md` | Guest→staff junction with role (liaison/interpreter/backup). Staffing templates from constraints. Coverage tracking. Liaison data-scoped view. | `pairings`, `liaison`, `interpreter`, `staffing-templates` | done |
| Prep Tracking | `modules/guest-relations/prep-tracking.md` | Template-based checklists per guest type. Completion % per guest/department. Auto-completion via domain events. Overdue alerts via scheduled workflow. | `prep`, `checklist`, `completion`, `overdue`, `alerts` | done |
| Contracts | `modules/guest-relations/contracts.md` | contract_template + contract_clause concepts. Conditional inclusion via ConditionExpression. 7 base + 7 conditional clauses. Handlebars variable resolution. In-app view + PDF export. | `contracts`, `clause-assembly`, `conditions`, `handlebars`, `in-app-view` | done |
| Itineraries | `modules/guest-relations/itineraries.md` | Computed view aggregating schedule + transport + pairings per guest. Day-by-day agenda. Real-time (no regeneration). PDF export. Liaison combined copy. | `itineraries`, `per-guest-schedule`, `in-app-view`, `pdf-export` | done |
| Transport & Logistics | `modules/guest-relations/transport-logistics.md` | Booking lifecycle (requested→dropped_off). FlightAware polling (15min). Blacklane/Karhoo ride booking. Driver token view. Live location sharing. Manager dashboard. | `transport`, `flights`, `drivers`, `live-location`, `blacklane`, `flightaware` | done |
| Guest Self-Service | `modules/guest-relations/guest-self-service.md` | Tokenized forms. YoY pre-population. Save-and-resume (JSONB partial saves). Submit→event→prep auto-complete. PII encryption. Token expiration, no enumeration. | `self-service`, `external-forms`, `token-auth`, `yoy-prepopulation` | done |

### Rollout

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Roadmap | `rollout/roadmap.md` | Dependency-ordered build plan (Phases A-G). Parallel work streams for 14 months. 7 milestone checkpoints with gate criteria. Everything ships. | `roadmap`, `build-order`, `dependencies`, `milestones` | done |
| Risk Register | `rollout/risk-register.md` | 17 risks (technical/operational/security). Scored L×I. Top: bus factor (20), turnover (15), load (12), misconfig (12), PII breach (10). Mitigations + contingencies. | `risks`, `mitigations`, `bus-factor`, `contingencies` | done |

---

## Semantic Tag Index

| Tag | Documents |
|-----|-----------|
| `ontology` | core/ontology-engine, core/ontology-scoping, core/ontology-web-builder, core/ontology-ci-qa |
| `rbac` | core/rbac-engine, api/domain-crud, api/external-surfaces, api/mcp-surface, platform/multi-tenancy |
| `auth` | core/auth-system, api/integration-patterns, api/external-surfaces, api/mcp-surface |
| `conditions` | core/condition-expression, ui/condition-builder-ui, automation/workflow-engine, modules/gr/contracts |
| `postgres` | data/postgres-schema, data/versioning-backups, data/yoy-registry, data/encryption |
| `events` | core/event-bus, core/audit-system, automation/workflow-engine |
| `workflows` | automation/workflow-engine, automation/workflow-actions, automation/workflow-builder |
| `api` | api/domain-crud, api/integration-patterns, api/external-surfaces, api/mcp-surface |
| `forms` | ui/dynamic-forms, ui/form-view-builder, core/ontology-web-builder |
| `views` | ui/view-renderer, ui/form-view-builder, ui/in-app-documents |
| `scheduling` | shared-services/scheduling-calendar, shared-services/google-calendar-sync, shared-services/guidebook-integration, shared-services/volunteer-scheduling |
| `external` | api/external-surfaces, modules/gr/guest-self-service, modules/gr/transport-logistics |
| `audit` | core/audit-system, data/versioning-backups, data/encryption |
| `platform` | platform/vision, platform/architecture, platform/multi-tenancy, platform/scaling, platform/oss-model, platform/branding |
| `gr` | modules/guest-relations/* |
| `transport` | modules/gr/transport-logistics, shared-services/equipment-logistics |
| `documents` | ui/in-app-documents, modules/gr/contracts, modules/gr/itineraries |
| `shared-services` | shared-services/* |
| `scaling` | platform/scaling, data/postgres-schema |
| `oss` | platform/oss-model, platform/vision |
| `branding` | platform/branding |
| `encryption` | data/encryption |
| `security` | data/encryption, core/audit-system, data/versioning-backups, rollout/risk-register |

---

## Dependency Graph

```
Phase A (Foundation):
  vision ─────────────────────────────────┐
  architecture ───────────────────────────┤
  postgres-schema ──┬─────────────────────┤
  ontology-engine ──┤                     │
  event-bus ────────┤                     │
  rbac-engine ──────┤                     │
  auth-system ──────┤                     │
  condition-expr ───┤                     │
  encryption ───────┘                     │
                                          │
Phase B (Core Services):                  │
  audit-system ──────────┐                │
  versioning-backups ────┤                │
  yoy-registry ──────────┤                │
  domain-crud ───────────┤                │
  multi-tenancy ─────────┤                │
  scaling ───────────────┤                │
  oss-model ─────────────┤                │
  branding ──────────────┘                │
                                          │
Phase C (Management + API):              │
  ontology-scoping ──────┐                │
  ontology-web-builder ──┤                │
  ontology-ci-qa ────────┤                │
  integration-patterns ──┤                │
  external-surfaces ─────┤                │
  mcp-surface ───────────┘                │
                                          │
Phase D (Automation + UI):               │
  workflow-engine ───────┐                │
  workflow-actions ──────┤                │
  workflow-builder ──────┤                │
  dynamic-forms ─────────┤                │
  view-renderer ─────────┤                │
  condition-builder-ui ──┤                │
  form-view-builder ─────┤                │
  in-app-documents ──────┘                │
                                          │
Phase E (Shared Services):               │
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
Phase F (GR Module):                     │
  gr/overview ───────────┐                │
  gr/guest-lifecycle ────┤                │
  gr/pairings-staffing ──┤                │
  gr/prep-tracking ──────┤                │
  gr/contracts ──────────┤                │
  gr/itineraries ────────┤                │
  gr/transport ──────────┤                │
  gr/guest-self-service ─┘                │
                                          │
Phase G (Rollout):                       │
  roadmap ───────────────┐                │
  risk-register ─────────┘────────────────┘
```
