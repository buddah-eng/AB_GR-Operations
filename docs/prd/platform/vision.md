# Platform Vision & Positioning

> Convention operations platform where the source code is the engine and the database is the application.
> Ontology-driven, RBAC-enforced, API-first. One deployment serves all departments. OSS-safe by design —
> cloning the repo gives an empty platform; all convention-specific value lives in Postgres.

---

## Overview

GR-Ops is a shared-service platform for managing convention operations across all departments — Guest Relations, Exhibits, Programming, Operations, and any future department. It replaces department silos and disconnected tools with a single system of record backed by Postgres.

The platform is **ontology-driven**: domain concepts (guests, staff, events, booths, panels), their properties, relationships, constraints, workflows, forms, and views are all defined as data in the database, not as code. Adding a new department or concept means adding configuration rows, not writing route handlers or Vue components.

The platform is **API-first**: every consumer — the staff-facing Vue app, internal apps (warehouse, logistics), external surfaces (guest self-service forms, driver pickup views), and personal AI agents (via MCP) — accesses data through the same REST API with the same RBAC enforcement.

The platform is **OSS-safe**: the engine (source code) handles ontology loading, RBAC evaluation, event emission, workflow execution, form/view rendering, and generic CRUD. The application (database) holds concept definitions, property schemas, permission matrices, workflow configs, form layouts, and all operational data. Another convention can fork the repo, deploy their own instance, and populate their own ontology without seeing Anime Boston's operational playbook.

**Target deployment:** Anime Boston, a 25,000+ attendee volunteer-run anime convention. 14-month build timeline with multiple collaborators. Everything described in this PRD set ships.

---

## Full Specification

### 1. Problem Statement

**Purpose:** Define the problems this platform solves.

**Detail:**

Anime Boston is a volunteer-run convention with multiple departments (Guest Relations, Exhibits, Programming, Operations, etc.) that currently operate in silos:

- **No shared system of record.** Each department tracks data independently. Guest info in GR doesn't connect to scheduling in Programming or booth assignments in Exhibits.
- **Manual processes.** Guest onboarding, contract generation, prep tracking, volunteer scheduling, transportation coordination — all manual, error-prone, and dependent on individual knowledge.
- **Department collaboration gaps.** When GR confirms a guest who needs a panel slot, Programming finds out via email or Slack. When Exhibits assigns a booth, Operations learns about equipment needs secondhand.
- **Custom apps in isolation.** Some departments have built their own tools (e.g., warehouse inventory). These don't share data, auth, or event notifications with each other.
- **Volunteer turnover.** Department directors change yearly. Institutional knowledge walks out the door. No persistent operational framework survives between convention years.
- **No access control granularity.** Volunteers see everything or nothing. No field-level permissions, no department-scoped views, no role-based data filtering.

**Acceptance Criteria:**
- [ ] Platform addresses each problem listed above (verified per-feature in downstream PRDs)
- [ ] Cross-department data sharing demonstrated with at least two departments

**Decisions/Rationale:**
- The org evaluated commercial platforms and determined that the custom operational requirements of a volunteer-run convention (unique role structures, cross-department workflows, seasonal usage patterns) aren't well served by generic tools.

---

### 2. Platform Thesis

**Purpose:** Define the core architectural principle.

**Detail:**

**"The source code is the engine. The database is the application."**

The platform is a generic operations engine that reads its own structure from the database at runtime:

| What | Where it lives | Who changes it |
|------|---------------|----------------|
| Concepts (Guest, Staff, Booth, Panel, etc.) | `ontology_concepts` table | Admin via web builder |
| Properties (name, status, type, etc.) | `ontology_properties` table | Admin/Director via web builder |
| Relationships (guest→pairings, booth→dealer) | `ontology_relationships` table | Admin via web builder |
| Constraints (JP guests require interpreter) | `ontology_constraints` table | Admin via web builder |
| Permissions (who can see/edit what fields) | `permissions` table | Admin via web builder |
| Workflows (on confirm → generate contract) | `workflow_configs` table | Director via workflow builder |
| Form layouts (wizard vs 2-column, field order) | `form_configs` table | Director via form builder |
| View configs (table vs kanban, columns, filters) | `view_configs` table | Director via view builder |
| Operational data (actual guests, staff, events) | Domain tables | Staff via platform UI |

The engine code handles: loading the ontology, evaluating RBAC permissions, emitting domain events, executing workflows, rendering forms/views, and providing generic CRUD endpoints. **The engine never contains domain-specific logic.** Adding "panel submissions" is ontology config; it doesn't touch the Express router, the Vue components, or the RBAC engine.

**Acceptance Criteria:**
- [ ] A new concept can be added via the ontology web builder with zero code changes
- [ ] The new concept immediately has CRUD API endpoints, form rendering, and view rendering
- [ ] Workflows can be attached to the new concept's events via config

**Decisions/Rationale:**
- This pattern is used by Frappe/ERPNext (Python/MariaDB), Directus (Node/SQL), and Salesforce (proprietary). Our implementation adds domain semantics (inheritance, constraints, conditional logic) that those platforms lack, and targets convention operations specifically.
- The JSONB + typed columns approach in Postgres gives us both schema flexibility (ontology-defined dynamic fields) and query performance (indexed typed columns for core fields).

---

### 3. Platform-as-Shared-Service

**Purpose:** Define how one deployment serves the entire organization.

**Detail:**

The platform is infrastructure, not an application. It sits at the center of the convention's technology ecosystem:

```
┌─────────────────────────────────────────────────────┐
│              DEPARTMENT MODULES (tenants)            │
│  GR  │  Exhibits  │  Programming  │  Operations     │
├──────┴────────────┴───────────────┴─────────────────┤
│           SHARED SERVICES (org-wide concepts)        │
│  Volunteers · Venues · Equipment · Scheduling        │
├─────────────────────────────────────────────────────┤
│              PLATFORM ENGINE                         │
│  Ontology · RBAC · Events · Workflows · API · Auth   │
├─────────────────────────────────────────────────────┤
│              POSTGRES (the application)               │
│  Ontology tables · Config · Permissions · Data       │
└─────────────────────────────────────────────────────┘
```

**Department isolation** is achieved via ontology scoping (org-wide vs department-owned concepts) and RBAC (role-based permissions per concept per field), not via separate deployments or databases.

**Onboarding a new department:**
1. Admin creates department-specific concepts in the ontology web builder
2. Admin defines permissions for that department's roles
3. Director configures forms, views, and workflows for their concepts
4. Zero code deployed. Zero infrastructure changes.

**Acceptance Criteria:**
- [ ] Two departments can operate on the same deployment with no data leakage
- [ ] A department director can only see/edit concepts they own or that are org-wide
- [ ] Internal apps consume the same API as the platform UI

**Decisions/Rationale:**
- Single-tenant per convention (one Postgres instance), multi-tenant at the department level. This is simpler than full multi-tenancy and appropriate for a single-org deployment.

---

### 4. OSS-Safe Architecture

**Purpose:** Define how the platform can be open-sourced without exposing operational value.

**Detail:**

| In the repo (public) | In the database (private) |
|---|---|
| Vue app shell | "Guest" concept + 15 properties |
| Express API engine | "JP Guest" constraint + defaults |
| Ontology loader | Interpreter auto-assignment workflow |
| RBAC engine | Role definitions and permission matrix |
| Event bus | Form layouts (Guest wizard steps) |
| Workflow executor | View configs (kanban vs timeline) |
| Generic CRUD routes | Department structure |
| FormKit schema bridge | All operational data |

Another convention — Otakon, PAX, or any community event — can:
1. Fork the repository
2. Deploy to their own GCP project
3. Run the ontology seeding scripts (or use the web builder from scratch)
4. Define their own concepts, roles, workflows, forms, views
5. Have a completely different application running on the same engine

**Acceptance Criteria:**
- [ ] A fresh deployment with an empty database boots successfully and presents the web builder
- [ ] No convention-specific config exists in the source code
- [ ] Seeding scripts create example data, not production data

**Decisions/Rationale:**
- AGPL-3.0 license ensures engine improvements flow back to the community while allowing each convention to keep their operational data private.

---

### 5. API-First Design

**Purpose:** Define the API as the universal integration backbone.

**Detail:**

Every consumer of the platform goes through the same API layer:

| Consumer | Auth Method | What they get |
|---|---|---|
| Staff-facing Vue app | Firebase OAuth → role | Full RBAC-filtered access |
| Warehouse inventory app | API key → scoped role | Read equipment + venues, write delivery status |
| Guest self-service form | Token → record-scoped role | Edit own flight/dietary info only |
| Driver pickup view | Token → record-scoped role | See assigned guest name + pickup location only |
| Personal AI agent (MCP) | Delegated user token | Exact same access as the user |

All five go through the same middleware chain: auth → role resolution → RBAC check → data scope filter → field-level filter → response. The RBAC engine is auth-method-agnostic.

**Acceptance Criteria:**
- [ ] All four auth methods (Firebase, API key, token, MCP) resolve to the same internal identity + role representation
- [ ] The RBAC engine produces identical results regardless of auth method
- [ ] An internal app can perform any operation the corresponding role allows

**Decisions/Rationale:**
- API-first (not UI-first) ensures the platform grows into an integration hub rather than a monolithic app that other tools can't talk to.

---

### 6. Target Users

**Purpose:** Define who uses the platform and how.

**Detail:**

**Internal users (platform UI):**
- Roles are defined in the ontology and editable by admin. Examples of roles a convention might define: volunteer, shift_lead, coordinator, dept_head, director, admin. These are data — any convention defines their own role hierarchy with their own names and permission levels.
- Each role gets concept-level CRUD permissions and field-level visibility/editability per concept.
- Data scoping restricts what records a user sees (e.g., a liaison sees only their assigned guests).

**Internal apps (API consumers):**
- Warehouse inventory, logistics tracking, badge printing, registration — any internally-developed tool.
- Each gets an API key with a scoped role defining exactly what concepts and fields it can access.

**External users (token-scoped):**
- Guests: self-service forms for travel details, dietary preferences, bio updates. Pre-populated from year-over-year registry.
- Drivers: pickup coordination view showing guest name, flight status, terminal, pickup instructions.
- Public: panel submission forms, artist alley applications (future).

**Personal AI agent (MCP):**
- Platform operator uses Claude Code with MCP tools that map to the API.
- Agent operates with the operator's exact permissions. Actor type tagged as 'ai_agent' in audit log.

**Acceptance Criteria:**
- [ ] A new role can be created via the ontology web builder with custom permissions
- [ ] External users can only access their scoped records
- [ ] AI agent actions are distinguishable from human actions in the audit log

---

### 7. Non-Goals

**Purpose:** Define what this platform is NOT.

**Detail:**

- **Not a registration system.** Attendee registration is a separate concern. The platform can receive registration data via API for operational purposes (badge printing, headcount) but does not handle ticket sales or attendee accounts.
- **Not a badge printing system.** Badge printing apps consume the platform's API to get attendee/guest data but handle printing logic independently.
- **Not a website CMS.** The convention's public website is separate. The platform provides data (schedule, guest list) via API for the website to display.
- **Not an attendee-facing app.** Guidebook (or similar) is the attendee-facing schedule app. The platform publishes schedule data to Guidebook via integration.
- **Not a communication tool.** The platform can trigger notifications (via workflow actions) but is not a chat system, email client, or announcement platform.

The platform is the **operational backbone** — the shared system of record that all these other tools integrate with via API.

**Acceptance Criteria:**
- [ ] No attendee-facing UI exists in the platform
- [ ] No registration/payment logic exists in the platform
- [ ] Integration points exist for each non-goal system to consume platform data

**Decisions/Rationale:**
- Scope discipline prevents the platform from becoming a monolith. Each adjacent system is better served by purpose-built tools that integrate via the API.
