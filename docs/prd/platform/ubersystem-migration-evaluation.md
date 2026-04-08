# Ubersystem Migration Evaluation

> Can an event currently running MAGFest's Ubersystem adopt our ontology-driven platform?
> Short answer: yes, but it's a paradigm shift, not a lift-and-shift migration.
> The data migrates. The operational logic gets *re-expressed* as ontology configuration, not ported as code.

---

## 1. What Ubersystem Is

[Ubersystem](https://github.com/magfest/ubersystem) is a Python/CherryPy/SQLAlchemy convention management system originally built by MAGFest. [magprime](https://github.com/magfest/magprime) is a full-fledged event plugin that customizes Ubersystem for MAGFest Prime specifically.

**Stack:** Python, CherryPy, SQLAlchemy (SQLModel), PostgreSQL, Mako templates, Celery + RabbitMQ, Alembic migrations, Docker.

**Architecture:** Code-first, model-driven. Domain entities (Attendee, Group, Department, Job, Shift, etc.) are hardcoded SQLAlchemy models with typed columns. The system ships ~62 site sections covering registration, staffing, scheduling, dealers, panels, hotel lottery, art shows, gaming, guests, badge printing, and more.

**Plugin system:** Python packages that extend the core via:
- Config mixins (`@Config.mixin`) that override settings
- Model mixins that add columns/relationships to core models
- Template overrides (Mako)
- Additional route handlers (site sections)
- Alembic migrations for schema changes

**Per-event customization:** Each event (magprime, magstock, etc.) is a separate plugin package. Each plugin can override configuration, add models, add routes, and override templates. Each event runs as a separate deployment instance.

---

## 2. What We're Building

Our platform is an **ontology-driven operations engine** where:
- Domain concepts, properties, relationships, constraints, workflows, forms, views, and permissions are all **data in Postgres**, not code
- A single generic CRUD engine serves all concepts through one API router
- The source code is the engine; the database is the application
- A fork produces an empty platform; all event-specific value lives in the database

See [vision.md](vision.md), [oss-model.md](oss-model.md), and [architecture.md](architecture.md) for full details.

---

## 3. Domain Coverage Comparison

| Domain | Ubersystem | Our Platform | Gap |
|--------|-----------|-------------|-----|
| **Registration & ticketing** | Core feature (preregistration, badge pricing, promo codes, group reg) | Explicit non-goal | **Major** - events need a separate registration system |
| **Staffing & volunteers** | Departments, Jobs, Shifts, DeptMembership, volunteer hours tracking | Phase 5 shared service (staff, volunteers, scheduling) | Equivalent scope planned |
| **Scheduling** | Events, time slots, room assignments, schedule views | Phase 5 shared service (schedule_event, venues) | Equivalent scope planned |
| **Guest management** | Guest model, guest groups, guest admin, guest reports | Phase 6 GR module (full lifecycle, contracts, transport, itineraries) | **We go deeper** |
| **Departments** | Hardcoded Department model, dept_memberships, dept_checklist | Ontology scoping (org vs department concepts), RBAC per department | Equivalent via different mechanism |
| **Dealers/vendors** | Dealer admin, dealer reports, marketplace | Modelable as ontology concepts | Not pre-built, but configurable |
| **Panels/programming** | Panel applications, panel admin, scheduling | Modelable as ontology concepts | Not pre-built, but configurable |
| **Hotel management** | Hotel lottery, room assignments | Modelable as ontology concepts | Not pre-built |
| **Art show** | Applications, administration, reports | Modelable as ontology concepts | Not pre-built |
| **Gaming** | MIVS, indie arcade, tabletop check-ins | Modelable as ontology concepts | Not pre-built |
| **Badge printing** | Badge exports, print jobs, barcodes | External app consuming our API | Not in scope (API integration point) |
| **Attractions** | Attractions admin, scheduling | Modelable as ontology concepts | Not pre-built |
| **Financial** | Receipts, transactions, budget tracking, merch | Modelable as ontology concepts | Not pre-built |
| **Cross-department workflows** | Limited (email/Slack between humans) | Event bus + workflow automation engine | **We go deeper** |
| **Field-level RBAC** | Admin access groups (coarse-grained) | Role + concept + field-level permissions with data scoping | **We go deeper** |
| **AI agent integration** | None | MCP surface with delegated auth | **We go deeper** |
| **Year-over-year continuity** | Manual data migration between event instances | YoY registry with automatic pre-population | **We go deeper** |
| **Audit trail** | Tracking model (basic) | Dual-path audit (application + database triggers), rogue-actor detection | **We go deeper** |

### The Registration Gap

This is the most significant difference. Ubersystem's core identity is as a registration system that grew into operations. Our platform explicitly does not handle registration, ticketing, or payments (see [vision.md](vision.md) Non-Goals).

**For an Ubersystem event migrating to our platform, they would need:**
- A separate registration system (could be a stripped-down Ubersystem instance, or a purpose-built tool like Pretix, Eventbrite, or a custom solution)
- API integration between the registration system and our platform for attendee/badge data flow

This is actually consistent with how many large events already operate - registration is a distinct concern from operations.

---

## 4. Architectural Paradigm Comparison

| Dimension | Ubersystem | Our Platform |
|-----------|-----------|-------------|
| **Philosophy** | Code is the application | Database is the application |
| **Domain modeling** | Hardcoded SQLAlchemy models with typed columns | Ontology concepts with typed core columns + JSONB |
| **Adding a concept** | Write Python model, Alembic migration, route handlers, Mako templates | Add rows to ontology tables via web builder (zero code) |
| **Adding a field** | Add column to model, Alembic migration, update templates | Add property row to ontology_properties (zero deploy) |
| **Customization** | Python plugin packages (code) | Ontology configuration (data) |
| **Per-event variation** | Separate plugin repo + separate deployment | Same engine, different database contents |
| **UI rendering** | Mako templates (server-rendered HTML) | Vue 3 SPA with dynamic form/view rendering from config |
| **Access control** | Admin access groups (route-level) | RBAC engine (concept + field + row level) |
| **Workflows** | Celery tasks, Python code, email handlers | Condition-driven workflow engine, event bus, configurable actions |
| **Configuration** | INI files + env vars + Python config classes | Postgres tables (ontology, config, permissions) |
| **Deployment** | One instance per event | One instance per organization (departments are logical tenants) |
| **API** | CherryPy endpoints (mixed with UI) | Express REST API (API-first, UI is a consumer) |
| **Year-over-year** | Separate instance per year, manual data migration | Same instance, YoY registry with automatic continuity |

### The Fundamental Shift

Ubersystem says: "Write Python code to define your event's domain model, then customize via plugins."

Our platform says: "Configure your event's domain model as data, then the engine renders everything from that configuration."

This means migration is not about translating Python to TypeScript. It's about expressing what Ubersystem hardcodes as models/routes/templates as ontology definitions/form configs/view configs/workflow configs instead.

---

## 5. What a Migration Actually Looks Like

### Phase A: Ontology Mapping (Weeks 1-2)

Map Ubersystem's core models to ontology concepts. This is design work, not code:

| Ubersystem Model | Ontology Concept | Notes |
|-----------------|-----------------|-------|
| `Attendee` | `attendee` (if reg integrated) or not modeled (if reg is separate) | Most Attendee fields are reg-specific |
| `Department` | Implicit in ontology scoping | Departments become logical tenants, not a data concept |
| `DeptMembership` | Relationship: `staff` -- member_of -- department scope | Expressed via RBAC + data scoping |
| `Job` | `job` or `shift_template` | Org-wide shared service concept |
| `Shift` | `shift_assignment` | Relationship between volunteer and job |
| `Group` | `group` (if needed) | Depends on whether reg is integrated |
| `Event` (scheduled) | `schedule_event` | Org-wide shared service concept |
| `PromoCode` | Not modeled (reg concern) | Stays in registration system |
| `AdminAccount` | Firebase Auth + roles table | Auth is external, roles are ontology-defined |
| `PanelApplication` | `panel_submission` | Department-owned concept (Programming) |
| `ArtShowApplication` | `art_show_entry` | Department-owned concept (Art Show) |
| Custom plugin models | Department-owned concepts | Each plugin's custom models become ontology concepts |

### Phase B: Data Migration (Week 3)

ETL scripts that:
1. Read Ubersystem's PostgreSQL tables
2. Map typed columns to our typed columns + JSONB properties
3. Populate domain tables in our schema
4. Preserve IDs for cross-reference integrity

This is straightforward database work. The models are relational on both sides.

### Phase C: Configuration Recreation (Weeks 2-4, overlaps with Phase A)

The hardest part. Everything Ubersystem does in code, we do in configuration:

| Ubersystem (code) | Our Platform (config) |
|---|---|
| Model field definitions | `ontology_properties` rows |
| Model relationships | `ontology_relationships` rows |
| Validation logic (`@presave_adjustment`) | `ontology_constraints` with ConditionExpressions |
| Cost calculations (`@cost_property`) | Formula properties or workflow actions |
| Temporal gates (`BEFORE_X`, `AFTER_X`) | ConditionExpressions on date fields |
| Admin access groups | `roles` + `permissions` + `data_scopes` rows |
| Mako template layouts | `form_configs` (FormKit schema) |
| Site section views | `view_configs` (table/kanban/timeline) |
| Celery task automation | `workflow_configs` triggered by domain events |
| Email sending logic | Workflow actions (notify) |
| Config mixins (plugin) | Ontology property extensions per department |

### Phase D: Registration Bridge (Week 2+)

Build an API integration between the chosen registration system and our platform:
- Webhook or polling sync for attendee data
- Badge status updates
- Headcount feeds for operational planning

### Phase E: Validation & Parallel Run (Weeks 4-6)

Run both systems in parallel for one event cycle to validate data integrity and operational equivalence.

---

## 6. What Migrates Cleanly

These aspects of an Ubersystem event translate naturally:

1. **Department structure** - Departments become ontology scopes with their own concepts and permissions. Directors get the web builder instead of asking a developer to write a plugin.

2. **Staff/volunteer data** - Direct ETL. Ubersystem's Attendee-with-staffing-flag maps to our `staff`/`volunteer` concepts.

3. **Job/shift definitions** - Direct mapping to ontology concepts with appropriate properties and relationships.

4. **Schedule data** - Events, time slots, room assignments map to `schedule_event` with venue relationships.

5. **Department checklists** - Ubersystem's `DeptChecklist` maps to workflow-driven prep tracking.

6. **Guest data** - If the event has guests, our GR module goes significantly deeper than Ubersystem's guest management.

7. **Audit history** - Can be imported into our `domain_audit_log` for continuity.

---

## 7. What Doesn't Migrate (and Shouldn't)

1. **Registration/ticketing logic** - Intentionally out of scope. Keep Ubersystem (or switch to a dedicated reg system) for this.

2. **Badge pricing algorithms** - Complex Python logic with temporal buckets, group discounts, promo codes. This is registration, not operations.

3. **Hotel lottery** - Highly event-specific Python logic. Could be modeled as ontology concepts + workflows, but the algorithm would need to be a custom workflow action.

4. **Payment processing** - Not in our scope.

5. **Mako templates** - No translation path. UI is rebuilt via form/view config in the web builder.

6. **CherryPy route handlers** - No translation path. All access goes through the generic CRUD API.

7. **Plugin Python code** - The entire plugin model is replaced by ontology configuration. There's no code to port because there's no code to write.

---

## 8. The Value Proposition for an Ubersystem Event

### Why an event would migrate

| Pain Point in Ubersystem | How We Solve It |
|---|---|
| Need a Python developer to add a field | Director adds it via web builder in 30 seconds |
| Plugin development cycle (code → test → deploy) | Configuration change, instant effect |
| Separate deployment per event/year | Same instance, YoY registry handles continuity |
| Coarse-grained access control | Field-level RBAC with data scoping |
| No cross-department data visibility | Ontology scoping with explicit cross-dept permissions |
| Department directors can't customize their own workflows | Workflow builder (no code) |
| Manual operational processes | Event-driven automation |
| No AI integration | MCP surface with delegated auth |
| Volunteer turnover kills institutional knowledge | Ontology IS the institutional knowledge - it persists |
| Each department builds their own tools | Shared platform, department-scoped concepts |

### Why an event might NOT migrate

| Strength of Ubersystem | Our Gap |
|---|---|
| Battle-tested at scale (MAGFest: 20k+ attendees, 10+ years) | New platform, unproven at scale |
| Registration + operations in one system | Registration explicitly excluded |
| Large community, multiple events using it | Single-org origin |
| Hotel lottery, art show, gaming - all built | Must be configured from scratch per event |
| Python ecosystem familiarity | TypeScript/Vue stack |
| Mature Celery task infrastructure | Workflow engine is new |

---

## 9. Migration Strategy Recommendation

For an event currently on Ubersystem considering adoption:

### Option A: Full Migration (Recommended for operations-heavy events)

1. **Keep Ubersystem for registration only** - Strip it down to reg/ticketing/payment. It's excellent at this.
2. **Migrate operations to our platform** - Staffing, scheduling, departments, vendors, guests, panels, etc.
3. **Bridge via API** - Ubersystem pushes attendee data to our platform via webhook. Our platform is the operational system of record.
4. **Timeline:** 4-6 weeks of configuration + parallel run. No code to write.

### Option B: Gradual Department Migration

1. **Start with one department** - e.g., Guest Relations (where our platform is deepest)
2. **Prove the model** - Run one department for one event cycle
3. **Expand** - Migrate additional departments as directors see the value
4. **Eventually** - Ubersystem handles only registration; our platform handles all operations

### Option C: Ontology Seed Packages

We could publish **convention starter packs** - pre-built ontology configurations that mirror Ubersystem's domain model:

```
seeds/
  convention-starter/
    concepts.json      # attendee, department, job, shift, event, venue...
    properties.json    # all fields from Ubersystem's core models
    relationships.json # department→jobs, jobs→shifts, attendee→shifts...
    roles.json         # volunteer, shift_lead, dept_head, admin
    permissions.json   # default permission matrix
    form-configs.json  # basic forms for each concept
    view-configs.json  # table views, department dashboards
```

An event runs `seed-ontology --pack=convention-starter` and gets a fully operational platform with a familiar domain model. Then they customize from there via the web builder.

---

## 10. Feasibility Assessment

| Dimension | Feasibility | Notes |
|-----------|------------|-------|
| Data migration | **High** | Both use Postgres. Straightforward ETL. |
| Domain model mapping | **High** | Ubersystem's models map cleanly to ontology concepts. |
| Workflow recreation | **Medium** | Simple automations are easy. Complex Python logic (pricing algorithms, lottery) needs custom workflow actions. |
| UI recreation | **Medium** | No template porting, but form/view configs must be built. Web builder makes this accessible to non-developers. |
| Permission mapping | **High** | Our RBAC is strictly more expressive than Ubersystem's access groups. |
| Plugin replacement | **High** | Plugins become ontology config. This is a simplification, not a complication. |
| Registration bridge | **Medium** | Requires API integration work. Well-defined boundary. |
| Operational continuity | **Medium** | Parallel run period needed. Staff retraining on new UI. |
| Community adoption | **Low-Medium** | Requires trust, documentation, and at least one successful migration case study. |

### Bottom Line

**Yes, we are building a system that Ubersystem events could adopt.** The migration path is real, but it's a paradigm shift from code-defined to data-defined operations. The strongest pitch is this: everything an Ubersystem plugin does in Python code (models, routes, templates, config overrides), our platform does in database configuration that non-developers can manage through a web builder. For volunteer-run conventions where developer availability is the bottleneck, that's transformative.

The registration gap is intentional and healthy - it forces a clean architectural boundary that Ubersystem's monolithic approach conflates. Events keep Ubersystem (or any reg system) for what it does best, and use our platform for what Ubersystem struggles with: flexible operations, cross-department workflows, granular access control, and year-over-year continuity.
