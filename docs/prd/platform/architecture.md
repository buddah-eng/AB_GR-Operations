# System Architecture

> Layered architecture: Vue 3 SPA → Express API (Cloud Run) → Engine (ontology, RBAC, events, workflows) → Postgres.
> Four consumer types (UI, internal apps, external surfaces, MCP) all flow through the same middleware chain.
> Scales from free-tier Firebase (Y1 dev) to Cloud Run + Redis + Pub/Sub (production).

---

## Overview

The platform is organized in five layers: Presentation, API, Engine, Data, and External. Every request — whether from a staff member clicking a button, a warehouse app syncing inventory, a guest filling out a travel form, or an AI agent executing a workflow — flows through the same middleware chain and is subject to the same RBAC evaluation.

The codebase currently lives in two packages: `functions/` (Express API backend, deployed as a Cloud Function) and `web/` (Vue 3 SPA, deployed to Firebase Hosting). The target architecture replaces Cloud Functions with Cloud Run and adds Redis for shared caching and Cloud Pub/Sub for cross-service event delivery.

---

## Full Specification

### 1. Architectural Layers

**Purpose:** Define the platform's structural layers and their responsibilities.

**Detail:**

```
┌─────────────────────────────────────────────────────────┐
│  PRESENTATION                                            │
│  Vue 3 · PrimeVue · TailwindCSS · FormKit · Pinia       │
│  web/src/                                                │
├─────────────────────────────────────────────────────────┤
│  API                                                     │
│  Express router · Generic CRUD · Ontology endpoints      │
│  Auth middleware · Rate limiting                          │
│  functions/src/api/                                      │
├─────────────────────────────────────────────────────────┤
│  ENGINE                                                  │
│  Ontology loader · RBAC engine · Event bus               │
│  Workflow executor · Condition evaluator                  │
│  functions/src/ontology/ · functions/src/roles/          │
│  functions/src/events/                                   │
├─────────────────────────────────────────────────────────┤
│  DATA                                                    │
│  Postgres (ontology, config, RBAC, domain, audit)        │
│  Redis (cache) · Cloud Storage (PDFs, backups)           │
│  functions/src/db/ (planned)                             │
├─────────────────────────────────────────────────────────┤
│  EXTERNAL                                                │
│  Token-scoped surfaces · API key integrations            │
│  MCP tool surface · Webhook delivery                     │
│  Cloud Pub/Sub (cross-service events)                    │
└─────────────────────────────────────────────────────────┘
```

**Acceptance Criteria:**
- [ ] Each layer has a clear boundary — no direct Postgres queries from route handlers
- [ ] Engine layer has no knowledge of HTTP (testable without Express)
- [ ] Data layer is swappable (current implementation → Postgres) without changing engine or API

---

### 2. Module Map

**Purpose:** Map the actual codebase to architectural layers.

**Detail:**

| Layer | Directory | Key Files | Responsibility |
|-------|-----------|-----------|----------------|
| API | `functions/src/api/` | `domains.ts`, `ontology-routes.ts`, `actions.ts`, `config.ts` | Route handlers, request parsing, response formatting |
| Auth | `functions/src/auth/` | `middleware.ts` | Token verification, role resolution, auth gating |
| RBAC | `functions/src/roles/` | `engine.ts` | Permission checks, field filtering, data scope filtering |
| Ontology | `functions/src/ontology/` | `types.ts`, `loader.ts` | Type system, ontology loading/caching, config loading |
| Events | `functions/src/events/` | `bus.ts`, `types.ts` | Domain event emission, subscription, logging |
| Data | `functions/src/db/` (planned) | `client.ts`, `queries.ts` | Postgres connection, query builders, migrations |
| Presentation | `web/src/` | `App.vue`, `router/`, `stores/`, `views/`, `components/` | Vue SPA, Pinia state management, PrimeVue UI |
| Setup | `setup/src/` (legacy dir pending rename) | `seed-ontology.ts`, `seed-roles.ts`, `seed-workflows.ts` | One-time seeding scripts (→ Postgres seeds) |

**Frontend dependencies** (from `web/package.json`):
- Vue 3, Vue Router, Pinia (state management)
- PrimeVue (component library), PrimeIcons
- TailwindCSS (utility CSS)
- FormKit (form rendering — installed, not yet wired to ontology)
- Firebase SDK (auth)

**Backend dependencies** (from `functions/package.json`):
- Express, CORS (HTTP framework)
- Firebase Admin SDK, Firebase Functions (deployment + auth)
- Current data access client (to be replaced with `pg` / Postgres driver)

**Acceptance Criteria:**
- [ ] Every source file maps to exactly one architectural layer
- [ ] No circular dependencies between layers

---

### 3. Request Lifecycle

**Purpose:** Trace a complete request through all layers.

**Detail:**

Example: `GET /api/domains/guest?filter[status]=Confirmed&sort=name`

```
1. HTTP Request arrives at Express
   └─ functions/src/index.ts: app.use('/api/domains', domainRouter)

2. Auth Middleware (functions/src/auth/middleware.ts)
   ├─ authMiddleware(): extract Bearer token, verify with Firebase Auth
   ├─ resolveRole(): lookup user email → users table → role_key → roles table
   └─ Attaches req.user (AuthenticatedUser) and req.role (UserRole)

3. Require Auth (functions/src/auth/middleware.ts:117)
   └─ requireAuth(): if !req.user → 401

4. Route Handler (functions/src/api/domains.ts:44)
   ├─ validateConcept('guest'): calls getConceptByKey() from ontology loader
   │   └─ Returns Concept or 404 if not in ontology
   │
   ├─ RBAC Check: roleEngine.canPerformAction(roleKey, 'guest', 'view')
   │   └─ Looks up Permission record for role+concept → checks canView
   │   └─ Returns 403 if denied
   │
   ├─ Data Scope: roleEngine.buildDataScopeFilter(roleKey, 'guest', userId)
   │   └─ Looks up DataScope for role+concept
   │   └─ If scope='relation': adds WHERE filter for user's related records
   │   └─ If scope='department': adds WHERE filter for user's department
   │   └─ If scope='all': no filter added
   │
   ├─ Query Execution
   │   ├─ buildFilterFromQuery(): converts ?filter[status]=Confirmed → WHERE clause
   │   ├─ buildSortFromQuery(): converts ?sort=name → ORDER BY clause
   │   ├─ combineFilters(): merges user filter + data scope filter with AND
   │   └─ Execute query against Postgres
   │
   ├─ Field Filtering: for each record, roleEngine.filterRecord(roleKey, 'guest', record)
   │   └─ getVisibleProperties() → strip all fields not in visibleProperties list
   │
   └─ Response: { success: true, data: [...], meta: { total, page, limit, hasMore } }

5. Domain Event (for writes only — POST/PUT/DELETE)
   └─ emit(createDomainEvent({ eventName: 'guest.created', ... }))
       ├─ Matching subscribers execute sequentially by priority
       ├─ Event logged to event_log table
       └─ Workflows triggered if any match the event pattern
```

**Acceptance Criteria:**
- [ ] A request can be traced through every layer with log output at each step
- [ ] No step is skippable (RBAC can't be bypassed, events always fire on writes)

**Decisions/Rationale:**
- Sequential middleware chain (not parallel) ensures auth is fully resolved before any data access
- Field filtering happens AFTER data fetch (not in the query) to keep query logic simple and RBAC logic centralized in the engine

---

### 4. Consumer Model

**Purpose:** Define how each consumer type connects to the platform.

**Detail:**

| Consumer | Auth Header | Resolution | RBAC Scope |
|----------|-------------|------------|------------|
| Vue SPA | `Authorization: Bearer <firebase-token>` | Firebase Auth → users table → role | Full role permissions |
| Internal App | `Authorization: ApiKey <key>` | api_clients table → role | Scoped to allowed_concepts |
| Guest Form | `X-Guest-Token: <token>` | guest_form_sessions → guest_self_service role | Single record, limited fields |
| Driver View | `X-Driver-Token: <token>` | driver_sessions → driver_view role | Single booking, minimal fields |
| MCP Agent | `Authorization: Bearer <user's-firebase-token>` + `X-Actor-Type: ai_agent` | Same as Vue SPA | User's exact permissions |

All five paths converge in `authMiddleware()` which produces the same `req.user` + `req.role` + `req.actorType` regardless of auth method. Everything downstream is identical.

**Acceptance Criteria:**
- [ ] All five consumer types tested with same API endpoint, producing appropriately filtered results
- [ ] Actor type correctly recorded in audit log for each consumer type

---

### 5. Compute Strategy

**Purpose:** Define the compute infrastructure and scaling path.

**Detail:**

| Component | Current | Target | Why |
|-----------|---------|--------|-----|
| API Server | Firebase Cloud Functions | Cloud Run | No cold starts, scales to zero, container flexibility |
| Cache | In-memory (per-instance) | Redis (Memorystore) | Shared across instances, survives restarts |
| Events (internal) | In-process pub/sub | In-process pub/sub | Same-service handlers don't need network |
| Events (cross-service) | N/A | Cloud Pub/Sub | Internal apps need real-time event delivery |
| Cron/Scheduled | Cloud Scheduler → Cloud Function | Cloud Scheduler → Cloud Run | Same trigger, different target |
| Static Hosting | Firebase Hosting | Firebase Hosting | No change needed, CDN-backed |

**Cloud Run configuration:**
- Min instances: 0 (scale to zero between conventions, $0 off-season)
- Max instances: 10 (handles 100+ concurrent users during con weekend)
- CPU: 1 vCPU per instance
- Memory: 512MB per instance
- Concurrency: 80 requests per instance
- Region: us-east1 (closest to Boston)

**Acceptance Criteria:**
- [ ] API responds within 200ms p95 under 50 concurrent users
- [ ] Scale-to-zero verified: no running instances between convention events
- [ ] Cache invalidation propagates across all instances within 5 seconds

**Decisions/Rationale:**
- Cloud Run over Cloud Functions: Functions have 10-30s cold starts on first request after idle. Cloud Run with min-instances=0 has ~2s cold starts and supports WebSocket for future real-time features.
- Redis over in-memory cache: with multiple Cloud Run instances, in-memory caches diverge. Redis gives consistent cache state across all instances.

---

### 6. Infrastructure

**Purpose:** Define the GCP infrastructure components.

**Detail:**

```
GCP Project: animeboston-ops (or similar)
│
├── Cloud Run: gr-ops-api
│   └── Container: Node 20 + Express
│       └── Connects to: Cloud SQL, Redis, Pub/Sub
│
├── Firebase Hosting: gr-ops-web
│   └── Vue 3 SPA (static files + CDN)
│
├── Cloud SQL: gr-ops-db
│   └── PostgreSQL 15
│   └── Instance: db-f1-micro (dev) → db-custom-2-4096 (prod)
│   └── Automated backups enabled
│
├── Memorystore: gr-ops-cache
│   └── Redis 7.x
│   └── Instance: basic tier, 1GB
│
├── Cloud Pub/Sub (when needed)
│   └── Topic: domain-events
│   └── Subscriptions: per internal app
│
├── Cloud Storage: gr-ops-storage
│   └── Buckets: backups/, generated-pdfs/
│
├── Cloud Scheduler
│   └── Jobs: workflow cron triggers (flight polling, overdue alerts, etc.)
│
├── Firebase Auth
│   └── Google OAuth provider
│   └── User management
│
└── Secret Manager
    └── Database credentials, API keys, integration secrets
```

**Cost estimate (production, convention weekend peak):**
- Cloud Run: ~$5-15/month (mostly idle, spikes during con)
- Cloud SQL: ~$10-30/month (db-f1-micro is $8/month)
- Redis: ~$35/month (basic tier)
- Storage: <$1/month
- Firebase Hosting: free tier
- Firebase Auth: free tier (under 10k users)
- **Total: ~$50-80/month during active months, ~$15-20/month off-season**

**Acceptance Criteria:**
- [ ] All infrastructure deployable via Terraform or gcloud CLI scripts
- [ ] Secrets managed via Secret Manager, never in source code
- [ ] Automated database backups verified

---

### 7. Current Implementation Status

**Purpose:** Inventory what exists vs what's planned.

**Detail:**

| Component | Status | Location |
|-----------|--------|----------|
| Express API with generic CRUD | **Built** | `functions/src/api/domains.ts` |
| Ontology type system | **Built** | `functions/src/ontology/types.ts` |
| Ontology loader + caching | **Built** | `functions/src/ontology/loader.ts` |
| RBAC engine (permissions, scoping, filtering) | **Built** | `functions/src/roles/engine.ts` |
| Auth middleware (Firebase + dev bypass) | **Built** | `functions/src/auth/middleware.ts` |
| Event bus (pub/sub, pattern matching, logging) | **Built** | `functions/src/events/bus.ts` |
| Vue SPA with PrimeVue | **Built** | `web/src/` |
| Pinia ontology store | **Built** | `web/src/stores/ontology.ts` |
| Dynamic table view (DomainListView) | **Built** | `web/src/views/DomainListView.vue` |
| Seeding scripts | **Built** | `setup/src/` (legacy dir pending rename) |
| Postgres data layer | **Planned** | `functions/src/db/` |
| Redis caching | **Planned** | Replace in-memory cache layer |
| API key auth | **Planned** | Addition to `middleware.ts` |
| Token-scoped auth | **Planned** | Addition to `middleware.ts` |
| MCP tool surface | **Planned** | New module |
| Cloud Run deployment | **Planned** | Dockerfile + Cloud Run config |
| Workflow executor | **Planned** | New module |
| Dynamic form rendering (FormKit bridge) | **Planned** | FormKit installed but unused |
| Ontology web builder | **Planned** | New views |
| Cloud Pub/Sub integration | **Planned** | New module |

**Acceptance Criteria:**
- [ ] All "built" components have passing tests
- [ ] All "planned" components have corresponding PRDs in this doc set

---

### 8. Test Plan

**Purpose:** Define architectural-level testing requirements.

**Detail:**

| Test Type | Scope | Tool | Target |
|-----------|-------|------|--------|
| Unit | Engine layer (ontology, RBAC, events) | Vitest | ≥80% coverage |
| Integration | Request lifecycle (API → engine → data) | Vitest + supertest | All CRUD operations per consumer type |
| Load | Concurrent users during con weekend | k6 or Artillery | 50 concurrent users, <200ms p95 |
| Auth | Each auth method end-to-end | Vitest + supertest | All four methods resolve correctly |
| RBAC | Permission evaluation across roles | Vitest | Every permission combination tested |
| Cache | Invalidation propagation | Vitest | Cache miss after ontology change |
| Event | Emit → log → workflow trigger | Vitest | Events logged, workflows fire |

**TDD approach:** Tests written before implementation for each new module. Red → Green → Improve.

**Acceptance Criteria:**
- [ ] All test types passing in CI
- [ ] Load test results documented for convention weekend scenario
- [ ] No untested code paths in the middleware chain
