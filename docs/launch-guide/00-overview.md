# Launch Overview

> GR-Ops separates engine (source code) from application (database contents).
> Launching means deploying the engine, then populating the database with your convention's ontology, configuration, and operational data.
> Time to operational: hours, not weeks.

---

## What "Launching" Means

GR-Ops is an empty platform when you clone it. The source code provides the engine -- a generic CRUD API, an ontology loader, an RBAC engine, a workflow executor, form and view renderers, and a Vue 3 SPA shell. None of this does anything useful until you populate the database with your convention's domain model.

This is by design. The repository is the engine. The database is the application. Two conventions can run the exact same codebase and have completely different operational platforms, because their databases contain different ontology definitions, different permission matrices, different form layouts, and different operational data.

---

## The 8 Launch Steps

| Step | What You Do | What It Creates |
|------|-------------|-----------------|
| 1. [Infrastructure](01-infrastructure.md) | Provision Postgres + hosting | Empty database, running API and SPA |
| 2. [Database Schema](02-database-schema.md) | Run SQL migrations | 40+ tables across 5 families |
| 3. [Seed Ontology](03-seed-ontology.md) | Define concepts, properties, relationships | Your domain model (Guest, Staff, Schedule, etc.) |
| 4. [Configure RBAC](04-configure-rbac.md) | Define roles, permissions, data scopes | Who can see and do what |
| 5. [Build Forms & Views](05-build-forms-views.md) | Create form configs and view configs | Data entry forms and list/kanban/timeline views |
| 6. [Create Workflows](06-create-workflows.md) | Define triggers, conditions, and actions | Automated processes (e.g., guest confirmed -> create prep items) |
| 7. [Populate Data](07-populate-data.md) | Insert operational records | Guests, staff, schedule, pairings, prep items, transport |
| 8. [Verify](09-verification.md) | Run the launch checklist | Confidence that everything works |

An optional step covers [Demo Mode](08-demo-mode.md), which is a specific deployment pattern for public-facing demonstrations where writes are intercepted on the frontend.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | Runtime for backend and frontend build |
| PostgreSQL | 16+ | Any provider: local Docker, managed cloud, self-hosted |
| npm | 10+ | Comes with Node.js |
| Docker | Latest | Optional: for local Postgres and integration tests |
| Git | 2.30+ | To clone the repository |

**Hosting requirements:**
- A server or serverless platform that can run a Node.js + Express application (the backend)
- A static file host for the Vue 3 SPA (the frontend)
- A PostgreSQL 16+ database accessible from the backend

---

## Platform-Agnostic Approach

This guide is written to work on any cloud platform that supports Postgres and Node.js hosting. Where a specific platform offers conveniences (like Vercel's Neon Postgres integration or Firebase's Auth system), those are noted as callouts rather than requirements.

**Vercel note:** Vercel can host the entire stack -- the Express backend as Vercel Functions (with Fluid Compute for connection pooling), the Vue SPA as a static build, and Postgres via the Neon Marketplace integration. This is the simplest path if you want a managed deployment.

---

## Time Estimate

| Step | Estimated Time | Notes |
|------|---------------|-------|
| Infrastructure | 15-30 minutes | Longer if setting up a new cloud account |
| Database schema | 5 minutes | Just running SQL files |
| Seed ontology | 1-3 hours | The most creative step -- defining your domain model |
| Configure RBAC | 30-60 minutes | Depends on number of roles and departments |
| Build forms & views | 1-2 hours | Can be done iteratively after launch |
| Create workflows | 30-60 minutes | Optional at launch; can be added later |
| Populate data | 1-2 hours | Depends on volume; can be imported from CSV/JSON |
| Verification | 15 minutes | Run the checklist |

**Total: 4-8 hours for a complete launch.** Steps 5-7 can be done iteratively after initial launch -- you do not need to build every form and view before your team can start using the platform.

---

## Architecture at a Glance

```
                                      +-----------------+
                                      |  PostgreSQL 16+ |
                                      |  (any provider) |
                                      +--------+--------+
                                               |
+-----------------+    HTTP/REST     +---------+----------+
|  Vue 3 SPA      | <-------------> |  Express API       |
|  (static host)  |                 |  (Node.js 20)      |
|                 |                 |                     |
|  PrimeVue       |                 |  Ontology Loader   |
|  TailwindCSS    |                 |  RBAC Engine       |
|  FormKit        |                 |  Event Bus         |
|  Pinia          |                 |  Workflow Executor |
|  Vue Flow       |                 |  Auth Middleware   |
+-----------------+                 +--------------------+
```

The SPA communicates with the Express API via REST. The API reads the ontology and RBAC configuration from Postgres at runtime, caches it in memory, and uses it to validate every request. All domain data (guests, staff, schedule, etc.) is stored in Postgres with typed columns for frequently queried fields and a JSONB `properties` column for ontology-defined dynamic fields.

---

## Next Step

[01-infrastructure.md -- Infrastructure Setup](01-infrastructure.md)
