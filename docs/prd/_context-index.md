# GR-Ops PRD Context Index

This file is the context management database for the GR-Ops product requirement documents.
Use the table below to locate the right document at the right detail level. The **Shorthand**
column provides enough context to decide whether you need to open the full document.

---

## Document Registry

| Doc ID | Title | Shorthand | Tags | Status | Last Updated |
|--------|-------|-----------|------|--------|--------------|
| PRD-00 | Platform Vision & Positioning | Ontology-driven convention operations platform. Source code = engine, database = application. AGPL-3.0 engine is OSS-safe; convention-specific config, workflows, and data stay private in Postgres. Replaces Notion as SOR due to rate limits, no transactions, no field-level RBAC. | `vision`, `ontology`, `oss`, `postgres`, `notion-migration`, `anime-boston` | draft | 2026-04-08 |
| PRD-01 | System Architecture | Three-tier architecture: Vue 3 SPA (PrimeVue) + Firebase Cloud Functions (Express/TypeScript) + Notion (migrating to Postgres). Ontology loader, RBAC engine, event bus, domain CRUD router, and in-memory cache with stale-while-revalidate. Deployed on Firebase Hosting + Cloud Functions us-east1. | `architecture`, `firebase`, `express`, `vue`, `notion`, `postgres`, `cache`, `cloud-functions` | draft | 2026-04-08 |
| PRD-02 | Ontology Engine & Web Builder | Five ontology databases (Concepts, Properties, Relationships, Events, Constraints) define the domain model at runtime. ConditionExpression system for conditional logic. FormConfig, ViewConfig, PageConfig enable DB-driven UI. Concept inheritance via `extends`. Ontology loaded via `functions/src/ontology/loader.ts`, typed in `functions/src/ontology/types.ts`. | `ontology`, `concepts`, `properties`, `relationships`, `constraints`, `conditions`, `forms`, `views`, `pages`, `inheritance` | draft | 2026-04-08 |
| PRD-03 | RBAC, Auth & Security | Firebase Auth (Google OAuth) with role resolution from Notion Users DB. Five roles (director/liaison/department_head/interpreter/volunteer) with priority-based hierarchy. Permission records define CRUD + field-level visibility per role per concept. DataScope records filter query results by relation path, field value, or department. ScreenAccess controls page visibility. Dev-bypass mode for emulator. | `rbac`, `auth`, `firebase-auth`, `permissions`, `data-scopes`, `screen-access`, `roles`, `security` | draft | 2026-04-08 |
| PRD-04 | API Layer & Integration Patterns | Express router mounted at `/api/*` on a single Cloud Function. Generic CRUD at `/api/domains/:concept` validates concept in ontology, enforces RBAC, fires domain events. Legacy action router at `/api/action` for backward compat. Ontology API at `/api/ontology` serves concept definitions to frontend. Config API at `/api/config` backed by Firestore. Concurrency-limited frontend client with semaphore (max 8). | `api`, `rest`, `crud`, `express`, `domains`, `actions`, `ontology-api`, `config-api`, `integration` | draft | 2026-04-08 |
| PRD-05 | Data Layer & Postgres Migration | Current SOR is Notion with 32 databases (5 ontology, 13 domain, 3 registry, 6 config, 5 role). Notion client wraps `@notionhq/client` with 2-concurrent-request semaphore and exponential backoff on 429s. Database ID registry maps logical keys to env vars. Migration target is Postgres for transactions, JOINs, FK constraints, and elimination of rate limits. | `postgres`, `notion`, `migration`, `databases`, `rate-limits`, `cache`, `data-layer` | draft | 2026-04-08 |
| PRD-06 | Workflow Engine & Automation | Domain event bus with glob-style pattern matching (`guest.*`, `*.created`). Priority-ordered sequential handler execution. Eight seed workflows: New Guest Pipeline, JP Guest Extras, Schedule-to-Calendar sync, Travel Update cascade, Pairing attendee sync, Prep Overdue daily cron, Staffing Auto-Create. WorkflowConfig stored in Notion with trigger, condition, and action arrays. | `workflows`, `events`, `event-bus`, `automation`, `domain-events`, `triggers`, `conditions` | draft | 2026-04-08 |
| PRD-07 | Dynamic Forms & View Builder | FormConfig supports single-column, two-column, and wizard layouts with conditional field visibility (`showIf` ConditionExpression). ViewConfig supports table, kanban, timeline, detail, and dashboard view types with column definitions, filters, sort, groupBy, and presets. PageConfig defines dashboard layouts with responsive breakpoints and widget grid positioning. Frontend ontology store provides runtime concept/property/relationship lookup. | `forms`, `views`, `pages`, `widgets`, `ui`, `dynamic-rendering`, `ontology`, `conditions` | draft | 2026-04-08 |
| PRD-08 | Contract Generation | Planned: Google Docs template-based itinerary and checklist generation per guest. OutputTemplates database defines template types (calendar, doc, email, itinerary). `handleGenerateItinerary` and `handleGenerateChecklist` stubs exist in `functions/src/api/actions.ts`. Targeted for Phase 3. | `contracts`, `documents`, `templates`, `google-docs`, `itinerary`, `checklist` | draft | 2026-04-08 |
| PRD-09 | Transportation & Logistics Module | Travel concept tracks flights/trains/cars with carrier, route, departure/arrival dates and times, confirmation numbers. Accommodations concept tracks hotel bookings with room type, check-in/check-out, special requests. Travel Update workflow cascades arrival changes to Transport-type schedule events. Dietary concept tracks restrictions, allergies, and preferences per guest. | `travel`, `accommodations`, `dietary`, `logistics`, `transportation`, `workflows` | draft | 2026-04-08 |
| PRD-10 | External Surfaces (Guest Forms, Driver Views) | Planned: token-scoped auth for external users (guests filling self-service forms, drivers viewing pickup schedules). Separate from Firebase Auth. External forms submit via API with scoped write permissions. Driver views are read-only filtered schedule views. Security boundary enforced via short-lived tokens, not full platform RBAC. | `external`, `guest-forms`, `driver-views`, `token-auth`, `self-service`, `security` | draft | 2026-04-08 |
| PRD-11 | Phased Rollout Roadmap | Y1: GR module for AB 2026 (guests, staff, schedule, travel, accommodations, dietary, prep, autographs, pairings, venues). Y1+: Exhibits (dealers, artists), Programming (panels, concerts, lotteries). Y2+: Convention-wide platform, multi-org support. Postgres migration timeline, external surfaces, contract generation phases. | `roadmap`, `phases`, `timeline`, `milestones`, `gr-module`, `exhibits`, `programming` | draft | 2026-04-08 |

---

## Semantic Tag Index

| Tag | Doc IDs |
|-----|---------|
| `ontology` | PRD-00, PRD-02, PRD-04, PRD-06, PRD-07 |
| `rbac` | PRD-00, PRD-03, PRD-04, PRD-10 |
| `postgres` | PRD-00, PRD-01, PRD-05 |
| `notion` | PRD-01, PRD-05 |
| `notion-migration` | PRD-00, PRD-05 |
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
| `cloud-functions` | PRD-01 |
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
| `google-docs` | PRD-08 |
| `itinerary` | PRD-08 |
| `checklist` | PRD-08 |
| `travel` | PRD-09 |
| `accommodations` | PRD-09 |
| `dietary` | PRD-09 |
| `logistics` | PRD-09 |
| `transportation` | PRD-09 |
| `external` | PRD-10 |
| `guest-forms` | PRD-10 |
| `driver-views` | PRD-10 |
| `token-auth` | PRD-10 |
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
