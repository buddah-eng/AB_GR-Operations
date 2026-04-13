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
| Context Index | `_context-index.md` | This file. 69 docs across 10 folders. Semantic tags + dependency graph. | living |

### Process (Evergreen — Apply to Every Phase)

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Wiring Audit | `process/wiring-audit.md` | No dead exports, no orphan columns, no broken cross-module dependencies. Run after every PRD. | `process`, `verification`, `quality` | done |
| Write Pipeline | `process/write-pipeline.md` | Every write endpoint follows full 10-step pipeline (auth→RBAC→audit→validate→encrypt→write→event→claim). | `process`, `verification`, `write-path` | done |
| Acceptance Gate | `process/acceptance-gate.md` | Line-by-line verification of every acceptance criteria with evidence before phase advancement. | `process`, `verification`, `gate` | done |
| Phase Discipline | `process/phase-discipline.md` | One phase at a time. Read PRD before code. No combining. Honest status reporting. | `process`, `discipline` | done |
| Session State | `process/session-state.md` | Save corrections, gap analyses, phase status to memory immediately. No deferred saves. | `process`, `memory`, `state` | done |
| Phase Completion | `process/phase-completion.md` | Iterative multi-pass verification: automated scans → write pipeline → acceptance criteria → fresh-eyes → build. Cycles until zero findings. | `process`, `verification`, `gate`, `convergence` | done |
| Deferred Backlog | `process/deferred-backlog.md` | Living tracker for deferred acceptance criteria with gate conditions. Checked at every phase start. Met gates become requirements. | `process`, `deferred`, `gate`, `tracking` | living |
| User Language Standard | `process/user-language-standard.md` | Property.label is single source of truth for user-facing text. Terminology translation table. Error message standards. Role-specific language. | `process`, `ux`, `language`, `terminology` | done |
| UX Checklist | `process/ux-checklist.md` | Every screen: 4 questions, empty states, loading states, error handling, accessibility, feedback. Verified during acceptance gate. | `process`, `ux`, `accessibility`, `verification` | done |
| Demo Data Integrity | `process/demo-data-integrity.md` | Zero orphan references across seed data. Forward/backward checks. Name/type/temporal consistency. | `process`, `demo`, `data-quality` | done |
| Demo Narrative Quality | `process/demo-narrative-quality.md` | Pre/during/post-event stories coherent and emotionally resonant. Canvas "aha" moment. | `process`, `demo`, `narrative` | done |
| Demo Visual Impact | `process/demo-visual-impact.md` | 30-second test, mobile, AB branding, navigation completeness, canvas wow. | `process`, `demo`, `visual`, `ux` | done |
| Subagent Orchestration | `process/subagent-orchestration.md` | Parallel dispatch rules, scope partitions, model selection, pre-spawn checklist, post-parallel integration. | `process`, `agents`, `parallel`, `orchestration` | done |

### Platform

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Vision | `platform/vision.md` | Source code = engine, DB = application. Ontology-driven, API-first, OSS-safe. Platform is shared service for all departments. | `vision`, `platform`, `oss`, `shared-service` | done |
| Architecture | `platform/architecture.md` | 5 layers (presentation/API/engine/data/external). Request lifecycle trace. 4 consumer types through same middleware. Cloud Run + Postgres + Redis. | `architecture`, `layers`, `request-lifecycle` | done |
| Multi-Tenancy | `platform/multi-tenancy.md` | One Postgres, one API. Depts isolated by ontology scoping + RBAC, not infra. Onboarding = config rows, zero deploys. | `multi-tenancy`, `dept-isolation`, `onboarding` | done |
| Scaling | `platform/scaling.md` | Cloud Functions → Cloud Run + Redis + Pub/Sub. Scale to zero ($0 off-season). 50-100 concurrent users during con. ~$50-80/mo active. | `scaling`, `cloud-run`, `redis`, `pub-sub`, `cost` | done |
| OSS Model | `platform/oss-model.md` | Engine (repo) vs application (DB). AGPL-3.0. Fork → deploy → populate ontology. No convention-specific data in source. | `oss`, `engine-vs-app`, `fork-model` | done |
| Branding | `platform/branding.md` | Colors/fonts/logo as config, not code. ab-* → primary-*. Tailwind from env vars. Runtime branding from DB. Settings UI with color picker. | `branding`, `theming`, `tailwind`, `config` | done |
| Template Infrastructure | `platform/template-infrastructure.md` | Unified template system: one table for record sets, notifications, documents, form/view presets, workflows. Versioned, scoped, CRUD API, import/export. Replaces 6+ separate template tables. | `templates`, `infrastructure`, `versioning`, `import-export` | done |
| Demo Showcase | `platform/demo-showcase.md` | Demo IS the real app on Vercel with DEMO_MODE=true. Real Postgres reads, localStorage writes. Three temporal views + canvas walkthrough. AB non-technical audience. | `demo`, `showcase`, `vercel`, `temporal-views` | done |
| Demo Architecture | `platform/demo-architecture.md` | Hybrid read/write: real Postgres reads via Vercel Functions, localStorage write interception. Single demo-store.ts. Import/export/reset. No mock API layers. | `demo`, `architecture`, `localstorage`, `hybrid` | done |
| Demo Deployment | `platform/demo-deployment.md` | Vercel hosting (free tier), demo branch strategy, Neon Postgres, auto-deploy on push. GitHub Pages disqualified. | `demo`, `deployment`, `vercel`, `neon` | done |
| Demo Data Narrative | `platform/demo-data-narrative.md` | Seed data for pre/during/post event. Authentic AB data (Japanese names, Hynes venues). Driver name phase-awareness. Canvas walkthrough. | `demo`, `seed-data`, `narrative`, `temporal` | done |
| Config Write Pipeline | `platform/config-write-pipeline.md` | POST/PUT endpoints for form_configs/view_configs. Payload adapters (frontend→DB shape). Versioning integration. Cache invalidation. Builder save/publish flow. | `config`, `write-pipeline`, `versioning`, `builders` | new |
| Data Wiring | `platform/data-wiring.md` | Fix ontology store discarding properties. Workflow engine wrong table/columns. Validation rules not reaching frontend. Seed data type mismatches. Notification delivery gaps. | `wiring`, `ontology`, `workflow`, `validation`, `integration` | new |
| Shared Services Setup | `platform/shared-services-setup.md` | Day Zero bootstrap wizard for non-developers. Org creation, department provisioning from templates, role hierarchy, user invitation, org-wide settings. Under 30 minutes. | `setup`, `wizard`, `bootstrap`, `onboarding`, `d0` | new |
| Template Library | `platform/template-library.md` | Browsable catalog of department template packs (GR, Programming, Ops, Vendor Relations, Registration, A/V). Browse, preview, customize, apply. Extends template-infrastructure with content and UX. | `templates`, `library`, `packs`, `browsing`, `preview` | new |
| Org Admin Dashboard | `platform/org-admin-dashboard.md` | Admin home page at /admin. Cross-department status, user management, template management, org-wide settings, audit overview, health metrics. PageConfig-driven, not hardcoded. | `admin`, `dashboard`, `cross-department`, `management` | new |

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
| RBAC Completion | `core/rbac-completion.md` | Seed full permission matrix for all 6 roles. Per-role visible/editable properties, data scopes, screen access. Contract tables for contract service. Fixes deny-by-default blocking non-director roles. | `rbac`, `permissions`, `seed-data`, `roles` | new |
| Department as Concept | `core/department-as-concept.md` | Department as first-class ontology concept with own table, lifecycle, scoping rules, templates. Not a flat text field. Director/assistant director assignment. Department dashboard and settings as PageConfig. | `ontology`, `department`, `lifecycle`, `scoping`, `templates` | new |

### Data Layer

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Postgres Schema | `data/postgres-schema.md` | Typed core columns + JSONB properties. 6 table families (ontology, config, RBAC, domain, audit, infra). Versioning columns on all ontology tables. GIN indexes. Audit triggers. Full CREATE TABLE SQL. | `postgres`, `schema`, `jsonb`, `indexes`, `fk-constraints` | done |
| Integration Testing | `data/integration-testing.md` | Testcontainers-based integration tests. Real Postgres 16 in Docker. Schema verification, trigger verification, constraint enforcement, E2E data flow. Separate vitest config. CI pipeline. | `testing`, `testcontainers`, `integration`, `postgres`, `ci` | done |
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
| Builder-to-Operator | `ui/builder-to-operator.md` | Property→input mapping (17 types), property→column mapping, default form/view/page auto-generation, ontology change impact on operators, builder guardrails. | `ux`, `translation`, `defaults`, `guardrails` | done |
| Operational UX Gaps | `ui/operational-ux-gaps.md` | Fix 10 failed user journeys. Detail routes, domain route shells, dashboard widget interactivity, horizontal Gantt timeline, relation field name resolution. Closes every UX lifecycle gap. | `ux`, `journeys`, `detail-pages`, `navigation`, `gaps` | new |
| Builder Guided Experience | `ui/builder-guided-experience.md` | Preview mode (operator view while editing), contextual help, default templates, undo history with visual timeline, validation warnings, first-time tutorial. Makes builders accessible to non-technical directors. | `ux`, `builders`, `preview`, `tutorial`, `guided`, `onboarding` | new |
| Canvas as Onboarding | `ui/canvas-as-onboarding.md` | System graph as primary onboarding tool. Interactive tour of department data model. Quick actions from canvas nodes. Department-scoped view. Relationship drawing. "What if" mode for risk-free exploration. | `canvas`, `onboarding`, `tour`, `interactive`, `department` | new |

### Data Infrastructure

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Data Routing | `data-infrastructure/data-routing.md` | Field-level routing & fan-out. Source→destination field mappings with PII filtering. Route triggers via event bus. Projection maintenance. | `data-flow`, `routing`, `pii`, `fan-out` | done |
| Data Transforms | `data-infrastructure/data-transforms.md` | 9 transform types (rename, strip, pii_strip, format, compute, aggregate, static, conditional, lookup). Composable chains. ConditionExpression integration. | `transforms`, `data-flow`, `conditions` | done |
| Internal Pipelines | `data-infrastructure/internal-pipelines.md` | Cross-department data flows. Pipeline stages (route, transform, quality_check, workflow, gate). Error handling with dead letter queue. | `pipelines`, `cross-dept`, `data-flow` | done |
| External Pipelines | `data-infrastructure/external-pipelines.md` | Third-party integrations (FlightAware, Guidebook, Google Calendar). Inbound/outbound/bidirectional. Sync state. Conflict resolution. Circuit breaker. | `pipelines`, `external`, `sync`, `integrations` | done |
| Data Quality | `data-infrastructure/data-quality.md` | Completeness, consistency, referential, staleness, uniqueness rules. Quality scores per record/concept/department. Violation tracking. | `quality`, `validation`, `rules` | done |
| Data Lineage | `data-infrastructure/data-lineage.md` | Provenance tracking. Forward/backward trace. Impact analysis. Built on audit + event log correlation via change_set UUID. | `lineage`, `provenance`, `audit`, `impact` | done |
| Data Security | `data-infrastructure/data-security.md` | PII governance. Data classification (PII/sensitive/internal/public). Breach detection. Retention policies. Right-to-deletion workflow. | `security`, `pii`, `governance`, `gdpr` | done |
| Data Observability | `data-infrastructure/data-observability.md` | Pipeline health monitoring. Data freshness. Flow throughput. Error tracking. Configurable alerting. Health check API. | `observability`, `monitoring`, `alerting` | done |
| Notifications | `data-infrastructure/notifications.md` | Email + in-app delivery. Template rendering. Recipient resolution (role/user/department). Preferences. Digest mode. Delivery tracking. | `notifications`, `email`, `in-app`, `templates` | done |
| Real-Time Updates | `data-infrastructure/real-time.md` | SSE-based live updates. RBAC-filtered event streams. Connection management. Reconnection with last-event-ID. Vue composable. | `real-time`, `sse`, `live-updates` | done |
| Platform Search | `data-infrastructure/platform-search.md` | Typesense integration. Per-concept indexes. RBAC-filtered search. Faceted search. Autocomplete. Blind index for encrypted fields. | `search`, `typesense`, `full-text`, `autocomplete` | done |

### Canvas System

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Canvas Engine | `canvas/canvas-engine.md` | Vue Flow rendering infrastructure. 8 node types, 4 edge types, 3 modes. Layout algorithms. Interaction primitives. Component architecture. Domain-agnostic. | `canvas`, `vue-flow`, `rendering`, `infrastructure` | done |
| System Visualization Architecture | `canvas/system-visualization-architecture.md` | Architectural keystone. Collector pattern. Unified VisualizationGraph model. Builder↔canvas coherence. Data infrastructure bridge. Caching with diff-based SSE. | `canvas`, `architecture`, `integration`, `visualization` | done |
| System Graph | `canvas/system-graph.md` | Auto-generated ontology graph. 3 zoom levels (system→department→concept). Editable. Department regions. Data flow + workflow overlays. | `canvas`, `ontology`, `graph`, `auto-generated` | done |
| Workflow Canvas | `canvas/workflow-canvas.md` | Auto-generated workflow flow diagrams. Cascade visualization. Dry-run mode. Cross-workflow dependency graph. | `canvas`, `workflows`, `flow-diagram` | done |
| Data Flow Canvas | `canvas/data-flow-canvas.md` | Field-level routing visualization. PII indicators. Transform nodes. Fan-out visualization. Live data animation. | `canvas`, `data-flow`, `routing`, `pii` | done |
| Canvas-Config Bridge | `canvas/canvas-config-bridge.md` | Bidirectional binding between canvas and config. CI/QA integration. Conflict resolution. Undo/redo via versioning service. | `canvas`, `bridge`, `bidirectional`, `ci-qa` | done |
| Canvas RBAC | `canvas/canvas-rbac.md` | 5-role visibility matrix. Edit permissions per canvas action. Canvas-specific permissions. Offline/disconnected behavior. | `canvas`, `rbac`, `permissions` | done |

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
| GR Config Integration | `modules/guest-relations/config-integration.md` | **Critical bridge PRD.** Maps every GR page to ViewConfig/FormConfig/PageConfig. Shell components, seed configs, routing, card layouts, migration plan. The missing piece from Phase 6 v1. | `gr`, `config-driven`, `integration`, `shell-components`, `seed-data` | done |
| GR Overview | `modules/guest-relations/overview.md` | 8 concepts (guest, pairing, prep_item, transport_booking, etc.). Relationships, roles, workflows, integration points with shared services. Department-centric settings. | `gr`, `module-scope`, `concepts`, `relationships` | done |
| Guest Lifecycle | `modules/guest-relations/guest-lifecycle.md` | draft→invited→confirmed→travel_arranged→arrived→attending→departed. Each transition triggers workflows. Guest types (JP/NA/other) determine constraints. | `guest`, `status-flow`, `invited`, `confirmed`, `attended` | done |
| Pairings & Staffing | `modules/guest-relations/pairings-staffing.md` | Guest→staff junction with role (liaison/interpreter/backup). Staffing templates from constraints. Coverage tracking. Liaison data-scoped view. | `pairings`, `liaison`, `interpreter`, `staffing-templates` | done |
| Prep Tracking | `modules/guest-relations/prep-tracking.md` | Template-based checklists per guest type. Completion % per guest/department. Auto-completion via domain events. Overdue alerts via scheduled workflow. | `prep`, `checklist`, `completion`, `overdue`, `alerts` | done |
| Contracts | `modules/guest-relations/contracts.md` | contract_template + contract_clause concepts. Conditional inclusion via ConditionExpression. 7 base + 7 conditional clauses. Handlebars variable resolution. In-app view + PDF export. | `contracts`, `clause-assembly`, `conditions`, `handlebars`, `in-app-view` | done |
| Itineraries | `modules/guest-relations/itineraries.md` | Computed view aggregating schedule + transport + pairings per guest. Day-by-day agenda. Real-time (no regeneration). PDF export. Liaison combined copy. | `itineraries`, `per-guest-schedule`, `in-app-view`, `pdf-export` | done |
| Transport & Logistics | `modules/guest-relations/transport-logistics.md` | Booking lifecycle (requested→dropped_off). FlightAware polling (15min). Blacklane/Karhoo ride booking. Driver token view. Live location sharing. Manager dashboard. | `transport`, `flights`, `drivers`, `live-location`, `blacklane`, `flightaware` | done |
| Guest Self-Service | `modules/guest-relations/guest-self-service.md` | Tokenized forms. YoY pre-population. Save-and-resume (JSONB partial saves). Submit→event→prep auto-complete. PII encryption. Token expiration, no enumeration. | `self-service`, `external-forms`, `token-auth`, `yoy-prepopulation` | done |
| Operational Writes | `modules/guest-relations/operational-writes.md` | Wire every operational write path. Edit routes, inline edit, status change UI, kanban card-move handler, form submission feedback. App is currently read-only; this makes it read-write. | `gr`, `writes`, `edit`, `status-change`, `kanban` | new |

### Rollout

| Doc | Path | Shorthand | Tags | Status |
|-----|------|-----------|------|--------|
| Roadmap | `rollout/roadmap.md` | Dependency-ordered build plan (Phases A-G). Parallel work streams for 14 months. 7 milestone checkpoints with gate criteria. Everything ships. | `roadmap`, `build-order`, `dependencies`, `milestones` | done |
| Risk Register | `rollout/risk-register.md` | 17 risks (technical/operational/security). Scored L×I. Top: bus factor (20), turnover (15), load (12), misconfig (12), PII breach (10). Mitigations + contingencies. | `risks`, `mitigations`, `bus-factor`, `contingencies` | done |

---

## Semantic Tag Index

| Tag | Documents |
|-----|-----------|
| `ontology` | core/ontology-engine, core/ontology-scoping, core/ontology-web-builder, core/ontology-ci-qa, core/department-as-concept |
| `rbac` | core/rbac-engine, core/rbac-completion, api/domain-crud, api/external-surfaces, api/mcp-surface, platform/multi-tenancy |
| `auth` | core/auth-system, api/integration-patterns, api/external-surfaces, api/mcp-surface |
| `conditions` | core/condition-expression, ui/condition-builder-ui, automation/workflow-engine, modules/gr/contracts |
| `postgres` | data/postgres-schema, data/integration-testing, data/versioning-backups, data/yoy-registry, data/encryption |
| `testing` | data/integration-testing |
| `process` | process/wiring-audit, process/write-pipeline, process/acceptance-gate, process/phase-discipline, process/session-state |
| `events` | core/event-bus, core/audit-system, automation/workflow-engine |
| `workflows` | automation/workflow-engine, automation/workflow-actions, automation/workflow-builder |
| `api` | api/domain-crud, api/integration-patterns, api/external-surfaces, api/mcp-surface |
| `forms` | ui/dynamic-forms, ui/form-view-builder, ui/builder-guided-experience, core/ontology-web-builder |
| `views` | ui/view-renderer, ui/form-view-builder, ui/in-app-documents, ui/operational-ux-gaps |
| `scheduling` | shared-services/scheduling-calendar, shared-services/google-calendar-sync, shared-services/guidebook-integration, shared-services/volunteer-scheduling |
| `external` | api/external-surfaces, modules/gr/guest-self-service, modules/gr/transport-logistics |
| `audit` | core/audit-system, data/versioning-backups, data/encryption |
| `platform` | platform/vision, platform/architecture, platform/multi-tenancy, platform/scaling, platform/oss-model, platform/branding, platform/config-write-pipeline, platform/data-wiring, platform/shared-services-setup, platform/template-library, platform/org-admin-dashboard |
| `gr` | modules/guest-relations/*, modules/guest-relations/operational-writes |
| `transport` | modules/gr/transport-logistics, shared-services/equipment-logistics |
| `documents` | ui/in-app-documents, modules/gr/contracts, modules/gr/itineraries |
| `shared-services` | shared-services/* |
| `scaling` | platform/scaling, data/postgres-schema |
| `oss` | platform/oss-model, platform/vision |
| `branding` | platform/branding |
| `encryption` | data/encryption |
| `security` | data/encryption, core/audit-system, data/versioning-backups, rollout/risk-register |
| `department` | core/department-as-concept, platform/multi-tenancy, platform/shared-services-setup, ui/canvas-as-onboarding |
| `templates` | platform/template-infrastructure, platform/template-library |
| `onboarding` | platform/shared-services-setup, ui/builder-guided-experience, ui/canvas-as-onboarding |
| `admin` | platform/org-admin-dashboard, platform/shared-services-setup |
| `wiring` | platform/data-wiring, process/wiring-audit |
| `writes` | modules/guest-relations/operational-writes, platform/config-write-pipeline, process/write-pipeline |
| `ux-gaps` | ui/operational-ux-gaps, ui/builder-guided-experience |
| `canvas` | canvas/canvas-engine, canvas/system-visualization-architecture, canvas/system-graph, canvas/workflow-canvas, canvas/data-flow-canvas, canvas/canvas-config-bridge, canvas/canvas-rbac, ui/canvas-as-onboarding |

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
  gr/config-integration ─┐                │
  gr/overview ───────────┤                │
  gr/guest-lifecycle ────┤                │
  gr/pairings-staffing ──┤                │
  gr/prep-tracking ──────┤                │
  gr/contracts ──────────┤                │
  gr/itineraries ────────┤                │
  gr/transport ──────────┤                │
  gr/guest-self-service ─┘                │
                                          │
Phase F.5 (Platform Completeness):       │
  data-wiring ───────────┐                │
  config-write-pipeline ─┤                │
  rbac-completion ───────┤                │
  operational-writes ────┤                │
  operational-ux-gaps ───┘                │
                                          │
Phase G (Shared Services & Dept Setup):  │
  department-as-concept ─┐                │
  template-library ──────┤                │
  shared-services-setup ─┤                │
  org-admin-dashboard ───┤                │
  builder-guided-exp ────┤                │
  canvas-as-onboarding ──┘                │
                                          │
Phase H (Launch Infrastructure):         │
  demo-architecture ─────┐                │
  demo-deployment ───────┤                │
  demo-data-narrative ───┤                │
  demo-showcase ─────────┘                │
                                          │
Phase I (Rollout):                       │
  roadmap ───────────────┐                │
  risk-register ─────────┘────────────────┘
```
