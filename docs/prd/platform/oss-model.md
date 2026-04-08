# OSS Model (Engine vs Application)

> The repository is the engine. The database is the application. Cloning gives an empty platform.
> AGPL-3.0 ensures engine improvements flow back; convention-specific config and data stay private.
> Another convention forks, deploys, populates their own ontology — completely different app, same engine.

---

## Overview

The platform is designed to be open-sourced without exposing any convention's operational value. The clean separation between engine (source code) and application (database contents) means the repo can be public while every convention's workflows, permission matrices, form layouts, and operational data remain private in their own Postgres instance.

---

## Full Specification

### 1. What's in the Repo (Public)

**Purpose:** Define what the open-source engine contains.

| Component | Description |
|-----------|-------------|
| Vue 3 SPA shell | App frame, router, component library integration |
| Express API engine | Generic CRUD router, ontology endpoints, config endpoints |
| Ontology loader | Reads ontology from Postgres, builds cache |
| RBAC engine | Evaluates permissions, filters fields, scopes data |
| Event bus | Domain event pub/sub with pattern matching |
| Workflow executor | Evaluates triggers/conditions, executes action chains |
| Condition evaluator | Universal ConditionExpression evaluation |
| FormKit schema bridge | Converts FormConfig → FormKit schema for rendering |
| View renderers | Table, kanban, timeline, dashboard from ViewConfig |
| Auth middleware | Firebase OAuth, API key, token-scoped, MCP |
| Postgres schema migrations | CREATE TABLE scripts for all table families |
| Seeding scripts | Example seed data (not production) |
| Docker/Cloud Run config | Deployment infrastructure |
| Documentation | This PRD set, API docs, contributor guide |

**What's NOT in the repo:**
- No convention-specific concept definitions
- No real guest/staff/vendor data
- No production permission matrices
- No workflow configurations
- No form/view layouts
- No API keys or secrets
- No convention branding or custom CSS (beyond the theme system)

### 2. What's in the Database (Private)

**Purpose:** Define what stays private per convention.

| Category | Examples |
|----------|---------|
| Ontology concepts | "Guest" with 15 properties, "Exhibit Booth" with 8 properties |
| Constraints | "JP Guest requires interpreter", "VIP gets green room" |
| Roles | volunteer, shift_lead, coordinator, dept_head, director, admin |
| Permissions | Director can edit all guest fields; volunteer sees name+status only |
| Workflows | "Guest confirmed → generate contract + create transport booking" |
| Form configs | Guest wizard: 6 steps with conditional field visibility |
| View configs | "JP Guests Kanban by status", "Overdue Prep Items table" |
| Operational data | Actual guest records, staff assignments, schedules |
| YoY registry | Multi-year guest/vendor history |
| Audit logs | Who changed what, when, from where |

### 3. Fork and Deploy Model

**Purpose:** Define how another convention uses the platform.

**Steps:**
1. Fork the repository
2. Set up a GCP project (or any cloud with Postgres + container hosting)
3. Run Postgres migrations to create empty schema
4. Deploy the API container and SPA
5. Create admin account via Firebase Auth
6. Use the ontology web builder to define concepts, properties, relationships
7. Configure roles and permissions
8. Build forms and views
9. Create workflows
10. Invite staff

**Time to operational:** Hours, not weeks. The web builder means a non-technical director can set up their department without writing code.

**What a fork inherits:**
- All engine capabilities (CRUD, RBAC, events, workflows, rendering)
- All UI components and layouts
- Future engine improvements (pull from upstream)

**What a fork does NOT inherit:**
- Any convention-specific configuration
- Any operational data
- Any permission structures

### 4. License

**Purpose:** Define the licensing model.

**AGPL-3.0** (GNU Affero General Public License v3):
- Engine improvements must be shared back if the modified platform is deployed as a service
- Convention-specific database contents (ontology, config, data) are NOT covered by AGPL — they're not derivative works of the engine
- Internal apps consuming the API are NOT required to be open-source — the API is a service boundary

**Why AGPL over MIT/Apache:**
- Prevents a commercial entity from forking the engine, adding features, and selling it as a closed-source product
- Ensures the community benefits from engine improvements
- Does not restrict conventions from keeping their operational data private

### 5. Contribution Model

**Purpose:** Define how community contributions work.

- **Engine contributions** (bug fixes, new features, performance improvements): PR to the main repo, reviewed and merged by maintainers
- **Convention-specific modules** (e.g., "anime convention guest pack" with pre-built concepts/workflows): Shared as ontology seed files or export/import packages, NOT as engine code
- **Integration adapters** (Blacklane, FlightAware, Guidebook, etc.): Contributed as engine code if generic, or as convention-specific config if customized

### 6. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Clean deploy | E2E | Fresh clone + deploy + migrate → empty platform boots | Web builder accessible, no errors |
| No hardcoded config | Static analysis | Grep for convention-specific strings in source | Zero matches |
| Seed data only | Review | Seeding scripts create example data, not production | No real names, emails, or operational data |
| License compliance | Review | All source files have AGPL-3.0 header | 100% coverage |

**Acceptance Criteria:**
- [ ] `git clone` + `docker-compose up` + run migrations → working empty platform
- [ ] No convention-specific data in the repo
- [ ] Another convention can be operational within a single day
