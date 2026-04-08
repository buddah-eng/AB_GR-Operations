# GR-Ops Platform — Product Requirements

This directory contains the atomic PRD set for the GR-Ops convention operations platform.

## How to Use These Docs

**For AI agents / planning sessions:**
1. Start with `_context-index.md` — read the shorthand column to find relevant docs
2. Load only the overview tier unless you need implementation detail
3. Follow dependency links before reading downstream docs

**For human collaborators:**
1. Start with `platform/vision.md` for the big picture
2. Read `_orchestration.md` for build order and phase dependencies
3. Dive into the subfolder relevant to your work

## Structure

```
platform/          Why we're building this, how it's shaped, how it scales
core/              Engine internals — ontology, RBAC, auth, events, audit
data/              Postgres schema, versioning, backups, YoY registry
api/               CRUD, integrations, external surfaces, MCP
automation/        Workflow engine, actions, visual builder
ui/                Dynamic forms, views, builders, in-app documents
shared-services/   Org-wide: volunteers, venues, scheduling, equipment
modules/           Department-specific: guest-relations/ (with sub-PRDs)
rollout/           Build order (dependency-based), risk register
```

## Document Format

Every atomic PRD follows the same structure:

1. **Shorthand** — blockquote, 2-3 lines. Enough to know if you need to read further.
2. **Overview** — one page. For planning sessions and context loading.
3. **Full Specification** — detailed, with atomic sub-sections. Each sub-section has:
   - Purpose and scope
   - Inputs / outputs
   - Dependencies (which other PRDs must exist first)
   - Implementation detail (data model, logic, UI, integration points)
   - Test plan (what to test, TDD approach, coverage target ≥80%)
   - Acceptance criteria (independently verifiable)
   - Decisions and rationale

## Principles

- **Postgres is the SOR.** The ontology, config, permissions, workflows, and domain data all live in Postgres.
- **The source code is the engine. The database is the application.** Cloning the repo gives an empty platform. All convention-specific value is in the DB.
- **The platform is a shared service.** One deployment serves all departments. Departments are isolated by ontology scoping + RBAC, not by infrastructure.
- **Roles are ontology-defined and admin-editable.** No hardcoded role lists in code.
- **Everything ships.** The build plan is ordered by dependency, not by scope reduction. Every PRD in this directory is in scope.
- **Test plans are integral.** Every atomic unit includes what to test and how. TDD: red → green → improve.
