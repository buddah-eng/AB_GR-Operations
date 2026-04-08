# GR-Ops PRD Context Index

This file is the context management database for the GR-Ops product requirement documents.
Use the table below to locate the right document at the right detail level. The **Shorthand**
column provides enough context to decide whether you need to open the full document.

---

## Document Registry

| Doc ID | Title | Shorthand | Tags | Status | Last Updated |
|--------|-------|-----------|------|--------|--------------|
| PRD-00 | Platform Vision & Positioning | Ontology-driven convention operations platform. Source code = engine, database = application. AGPL-3.0 engine is OSS-safe; convention-specific config, workflows, and data stay private in Postgres. Built instead of Notion after build-vs-buy analysis showed Notion can't provide transactions, field-level RBAC, or scale past 3 req/s API limits. | `vision`, `ontology`, `oss`, `postgres`, `anime-boston` | draft | 2026-04-08 |
| PRD-01 | System Architecture | Three-tier architecture: Vue 3 SPA (PrimeVue) + Express/TypeScript API + Postgres (SOR). Ontology loader, RBAC engine, event bus, domain CRUD router. Current: Firebase Cloud Functions. Target: Cloud Run + Postgres + Redis. Scaling from Firebase free tier (Y1) → Cloud Run auto-scaling (Y2+). | `architecture`, `firebase`, `express`, `vue`, `postgres`, `cloud-run`, `redis`, `cache` | draft | 2026-04-08 |
| PRD-02 | Ontology Engine & Web Builder | Five ontology databases (Concepts, Properties, Relationships, Events, Constraints) define the domain model at runtime. ConditionExpression system for conditional logic. FormConfig, ViewConfig, PageConfig enable DB-driven UI. Concept inheritance via `extends`. Ontology loaded via `functions/src/ontology/loader.ts`, typed in `functions/src/ontology/types.ts`. | `ontology`, `concepts`, `properties`, `relationships`, `constraints`, `conditions`, `forms`, `views`, `pages`, `inheritance` | draft | 2026-04-08 |
| PRD-03 | RBAC, Auth & Security | Firebase Auth (Google OAuth) with role resolution from Postgres users table. Four-tier hierarchy: volunteer→manager→director→admin. Permission records define CRUD + field-level visibility per role per concept. DataScope records filter query results by relation path, field value, or department. API key auth for internal app integrations. Token-scoped auth for external surfaces. Audit triggers on all ontology tables. | `rbac`, `auth`, `firebase-auth`, `permissions`, `data-scopes`, `roles`, `security`, `api-keys`, `token-auth`, `audit` | draft | 2026-04-08 |
| PRD-04 | API Layer & Integration Patterns | Express router mounted at `/api/*` on a single Cloud Function. Generic CRUD at `/api/domains/:concept` validates concept in ontology, enforces RBAC, fires domain events. Legacy action router at `/api/action` for backward compat. Ontology API at `/api/ontology` serves concept definitions to frontend. Config API at `/api/config` backed by Firestore. Concurrency-limited frontend client with semaphore (max 8). | `api`, `rest`, `crud`, `express`, `domains`, `actions`, `ontology-api`, `config-api`, `integration` | draft | 2026-04-08 |
| PRD-05 | Data Layer (Postgres) | Postgres as SOR. Ontology tables (concepts, properties, relationships, events, constraints), config tables (forms, views, pages, workflows), RBAC tables (roles, permissions, data_scopes), domain tables with JSONB properties column. Row-level versioning, nightly pg_dump snapshots, audit triggers on all ontology tables. YoY registry for cross-year persistent data. | `postgres`, `databases`, `schema`, `versioning`, `backups`, `audit`, `data-layer`, `jsonb`, `registry` | draft | 2026-04-08 |
| PRD-06 | Workflow Engine & Automation | Domain event bus with glob-style pattern matching (`guest.*`, `*.created`). Priority-ordered sequential handler execution. WorkflowConfig stored in Postgres with trigger (domain_event/scheduled/manual/field_changed), ConditionExpression evaluation, and action chains (create_record, notify, generate_doc, call_api, etc.). Workflows are DB-defined, not code. | `workflows`, `events`, `event-bus`, `automation`, `domain-events`, `triggers`, `conditions` | draft | 2026-04-08 |
| PRD-07 | Dynamic Forms & View Builder | FormConfig supports single-column, two-column, and wizard layouts with conditional field visibility (`showIf` ConditionExpression). ViewConfig supports table, kanban, timeline, detail, and dashboard view types with column definitions, filters, sort, groupBy, and presets. PageConfig defines dashboard layouts with responsive breakpoints and widget grid positioning. Frontend ontology store provides runtime concept/property/relationship lookup. | `forms`, `views`, `pages`, `widgets`, `ui`, `dynamic-rendering`, `ontology`, `conditions` | draft | 2026-04-08 |
| PRD-08 | Contracts & Itineraries | Conditional clause assembly: contract_template + contract_clause concepts in Postgres. Each clause has a ConditionExpression (e.g., type='JP' → interpreter clause, dept='Music' → performance rider). Handlebars templates with {{variable}} resolution. Contracts and itineraries are first-class in-app views (not external docs), exportable to PDF. Triggered via generate_doc workflow action on guest confirmation. | `contracts`, `itineraries`, `documents`, `templates`, `clause-assembly`, `handlebars`, `pdf-export`, `workflows`, `in-app-views` | draft | 2026-04-08 |
| PRD-09 | Transportation & Logistics Module | New concepts: transport_booking (status lifecycle, flight tracking, driver assignment), transport_driver, api_integration. Third-party APIs: Blacklane/Karhoo for rides, FlightAware for flight status. Three views: guest (tokenized ETA/driver info), driver (tokenized pickup details), manager dashboard (all bookings). Pre-event guest forms with YoY pre-population. | `travel`, `transport`, `logistics`, `flights`, `drivers`, `blacklane`, `flightaware`, `api-integration`, `external-surfaces` | draft | 2026-04-08 |
| PRD-10 | External Surfaces (Guest Forms, Driver Views) | Planned: token-scoped auth for external users (guests filling self-service forms, drivers viewing pickup schedules). Separate from Firebase Auth. External forms submit via API with scoped write permissions. Driver views are read-only filtered schedule views. Security boundary enforced via short-lived tokens, not full platform RBAC. | `external`, `guest-forms`, `driver-views`, `token-auth`, `self-service`, `security` | draft | 2026-04-08 |
| PRD-11 | Phased Rollout Roadmap | Y1: GR module for AB 2026 (guests, staff, schedule, travel, accommodations, dietary, prep, autographs, pairings, venues). Y1+: Exhibits (dealers, artists), Programming (panels, concerts, lotteries). Y2+: Convention-wide platform, multi-org support. Postgres migration timeline, external surfaces, contract generation phases. | `roadmap`, `phases`, `timeline`, `milestones`, `gr-module`, `exhibits`, `programming` | draft | 2026-04-08 |

---

## Semantic Tag Index

| Tag | Doc IDs |
|-----|---------|
| `ontology` | PRD-00, PRD-02, PRD-04, PRD-06, PRD-07 |
| `rbac` | PRD-00, PRD-03, PRD-04, PRD-10 |
| `postgres` | PRD-00, PRD-01, PRD-05, PRD-06, PRD-08 |
| `firebase` | PRD-01, PRD-03 |
| `firebase-auth` | PRD-03 |
| `auth` | PRD-03, PRD-10 |
| `api` | PRD-04 |
| `rest` | PRD-04 |
| `crud` | PRD-04 |
| `express` | PRD-01, PRD-04 |
| `vue` | PRD-01, PRD-07 |
| `architecture` | PRD-01 |
| `cache` | PRD-01, PRD-05 |
| `cloud-run` | PRD-01 |
| `redis` | PRD-01 |
| `api-keys` | PRD-03, PRD-04 |
| `token-auth` | PRD-03, PRD-10 |
| `audit` | PRD-03, PRD-05 |
| `versioning` | PRD-05 |
| `backups` | PRD-05 |
| `jsonb` | PRD-05 |
| `registry` | PRD-05 |
| `transport` | PRD-09 |
| `drivers` | PRD-09 |
| `flights` | PRD-09 |
| `api-integration` | PRD-04, PRD-09 |
| `clause-assembly` | PRD-08 |
| `itineraries` | PRD-08 |
| `pdf-export` | PRD-08 |
| `in-app-views` | PRD-08 |
| `concepts` | PRD-02 |
| `properties` | PRD-02 |
| `relationships` | PRD-02 |
| `constraints` | PRD-02 |
| `conditions` | PRD-02, PRD-06, PRD-07 |
| `inheritance` | PRD-02 |
| `forms` | PRD-02, PRD-07 |
| `views` | PRD-02, PRD-07 |
| `pages` | PRD-07 |
| `widgets` | PRD-07 |
| `ui` | PRD-07 |
| `dynamic-rendering` | PRD-07 |
| `permissions` | PRD-03 |
| `data-scopes` | PRD-03 |
| `screen-access` | PRD-03 |
| `roles` | PRD-03 |
| `security` | PRD-03, PRD-10 |
| `workflows` | PRD-06, PRD-09 |
| `events` | PRD-06 |
| `event-bus` | PRD-06 |
| `automation` | PRD-06 |
| `domain-events` | PRD-06 |
| `triggers` | PRD-06 |
| `contracts` | PRD-08 |
| `documents` | PRD-08 |
| `templates` | PRD-08 |
| `travel` | PRD-09 |
| `logistics` | PRD-09 |
| `external` | PRD-10 |
| `guest-forms` | PRD-10 |
| `driver-views` | PRD-10 |
| `self-service` | PRD-10 |
| `roadmap` | PRD-11 |
| `phases` | PRD-11 |
| `timeline` | PRD-11 |
| `milestones` | PRD-11 |
| `gr-module` | PRD-11 |
| `exhibits` | PRD-11 |
| `programming` | PRD-11 |
| `vision` | PRD-00 |
| `oss` | PRD-00 |
| `anime-boston` | PRD-00 |
| `integration` | PRD-04 |
| `databases` | PRD-05 |
| `rate-limits` | PRD-05 |
| `data-layer` | PRD-05 |
| `domains` | PRD-04 |
| `actions` | PRD-04 |
| `ontology-api` | PRD-04 |
| `config-api` | PRD-04 |

---

## Dependency Graph

Documents are listed with their upstream dependencies (documents that must be
read or implemented first for the dependent document to make full sense).

```
PRD-00  Platform Vision & Positioning
  (no dependencies -- foundational)

PRD-01  System Architecture
  depends on: PRD-00

PRD-02  Ontology Engine & Web Builder
  depends on: PRD-01

PRD-03  RBAC, Auth & Security
  depends on: PRD-01, PRD-02

PRD-04  API Layer & Integration Patterns
  depends on: PRD-01, PRD-02, PRD-03

PRD-05  Data Layer & Postgres Migration
  depends on: PRD-01, PRD-02

PRD-06  Workflow Engine & Automation
  depends on: PRD-02, PRD-04

PRD-07  Dynamic Forms & View Builder
  depends on: PRD-02, PRD-03, PRD-04

PRD-08  Contract Generation
  depends on: PRD-04, PRD-06

PRD-09  Transportation & Logistics Module
  depends on: PRD-04, PRD-06, PRD-10

PRD-10  External Surfaces (Guest Forms, Driver Views)
  depends on: PRD-03, PRD-04, PRD-07

PRD-11  Phased Rollout Roadmap
  depends on: PRD-00 through PRD-10 (references all)
```

### Visual Dependency Map

```
                 PRD-00 (Vision)
                    |
                 PRD-01 (Architecture)
                /   |   \
           PRD-02  PRD-05  PRD-03
          / |  \          / |
     PRD-06 |  PRD-07 <--  |
        |   |    |         |
     PRD-08 |  PRD-10 <----+
            |    |
         PRD-09 -+
            |
         PRD-11 (Roadmap -- reads all)
```
