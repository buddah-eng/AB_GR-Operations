# Consolidated PRD Requirements

Synthesized from 5 conversation-log extraction chunks (lines 1-5422 of session `6133eb47-fe09-444f-99f0-52da8693d57f`).
Cross-referenced against `_orchestration.md` for phase structure and existing PRD inventory.

**Purpose**: This document is the single input for writing, rewriting, and updating all PRDs needed before Phase 6 redo begins.

---

## Table of Contents

1. [Phase 6 Redo Scope](#phase-6-redo-scope)
2. [New Phase 7 Scope](#new-phase-7-scope)
3. [Phase 8 (Renumbered) Scope](#phase-8-renumbered-scope)
4. [Requirements by Phase](#requirements-by-phase)
   - [Phase 6 Redo Requirements](#phase-6-redo-requirements)
   - [New Phase 7 Requirements](#new-phase-7-requirements)
   - [Phase 8 Requirements](#phase-8-requirements)
   - [Process PRD Updates](#process-prd-updates)
   - [Architecture Updates](#architecture-updates)
   - [New PRDs Needed](#new-prds-needed)
5. [PRDs to Write Checklist](#prds-to-write-checklist)

---

## Phase 6 Redo Scope

Phase 6 was declared a failure because the GR Module pages were hardcoded Vue files with DataTable layouts, disconnected from the config-driven rendering engine built in Phases 3-4. The demo was static HTML on GitHub Pages with no connection to the real platform. The user deleted all Phase 6+ work and ordered a full redo.

### What Phase 6 Must Accomplish Differently This Time

1. **Config-driven views, not hardcoded pages.** Every operational page (Dashboard, Guests, New Guest, Guest Detail, Staff, Schedule, Prep Tracker, Workflows, Settings) must render through ViewConfig/FormConfig/PageConfig loaded from Postgres. No hardcoded DataTable implementations. No 700-line layout files.

2. **Integration, not just implementation.** The Phase 6 failure was not bad code but a missing integration step: the frontend never connected to the backend config infrastructure. Phase 6 redo PRDs must make backend-to-frontend wiring a first-class acceptance criterion, not an assumed side effect.

3. **Department-centric, not spreadsheet-centric.** List views must use atomic card/record layouts, not raw spreadsheet grids. Settings pages must feel department-centric. Canvas tabs must be functional, not cosmetic.

4. **Behavioral verification, not just build success.** The completion protocol must verify that a real user action (e.g., loading the guest list) pulls data from the DB and renders it through the config-driven renderer. "Tests pass" and "build succeeds" are necessary but not sufficient.

5. **Room for innovation.** The Phase 6 redo PRD should define outcomes (DB-driven views, working end-to-end) and leave room for the implementing agent to discover the best technical approach. Hard requirements are acceptance criteria, not implementation paths.

### Pages That Must Render from DB Config

All of these currently exist as hardcoded Vue files and must be converted:
- Dashboard (widget layout from PageConfig)
- Guest List (columns/filters from ViewConfig)
- New Guest Form (fields/validation from FormConfig)
- Guest Detail (layout from ViewConfig + FormConfig)
- Staff List (from ViewConfig)
- Schedule (from ViewConfig + scheduling data)
- Prep Tracker (from ViewConfig + workflow state)
- Workflows (from workflow config)
- Settings (department-centric, from ontology config)

### Phase 6 GR Module PRDs (from orchestration)

These PRDs define the GR Module scope and remain valid in intent but must be re-executed with config-driven rendering:

| PRD | What |
|-----|------|
| `modules/guest-relations/overview.md` | GR scope, concepts, relationships, department config |
| `modules/guest-relations/guest-lifecycle.md` | Invited->Confirmed->Attended flow, status workflows |
| `modules/guest-relations/pairings-staffing.md` | Liaison/interpreter assignment, staffing templates |
| `modules/guest-relations/prep-tracking.md` | Prep items per guest, completion %, overdue alerts |
| `modules/guest-relations/contracts.md` | Clause assembly, ConditionExpression, Handlebars, in-app view |
| `modules/guest-relations/itineraries.md` | Per-guest schedule from schedule + transport + events |
| `modules/guest-relations/transport-logistics.md` | Bookings, flights, drivers, live location |
| `modules/guest-relations/guest-self-service.md` | External forms, token auth, YoY pre-population |

### Phase 6 Redo Acceptance Criteria (Non-Negotiable)

- [ ] FormConfig loaded from API drives the guest intake form
- [ ] ViewConfig loaded from API drives the guest list view
- [ ] PageConfig loaded from API drives the dashboard widget layout
- [ ] Zero hardcoded DataTable/layout files for operational pages
- [ ] All UI tabs and buttons are functional, not cosmetic
- [ ] Settings page is department-centric
- [ ] List views use card/record layouts, not raw spreadsheet grids
- [ ] Behavioral verification: load guest list from DB config and render correctly end-to-end
- [ ] The ontology thesis is demonstrably true: source code is engine, database is application

---

## New Phase 7 Scope

Phase 7 is a new phase covering launch infrastructure, demo deployment, and the documentation series needed to ship the platform to its first users.

### What Phase 7 Covers

1. **Demo as the real app.** The demo is the production Vue SPA deployed with `VITE_DEMO_MODE=true` (or equivalent flag). Reads hit real Postgres (Neon on Vercel). Writes are intercepted by a localStorage adapter. No mock HTTP layers. No static HTML pages. No separate demo codebase.

2. **Demo hosting on Vercel.** Deployed on a `demo` branch via Vercel (free tier). GitHub Pages is disqualified (SPA routing issues, no server functions). Main branch is never destabilized by demo work.

3. **Seeded data with three temporal views.** Pre-event (vendors only, 40-50% prep), during-event (named drivers, 85%+ prep, live ops), post-event (completed records, wrap-up). Plus a canvas walkthrough showing system architecture.

4. **Demo import/export.** Users can save and restore their demo session state via import/export. Reset-to-seed capability.

5. **All builder views present.** Ontology builder, workflow canvas, data flow canvas, form builder, view builder, admin preview. Zero "load failed" or "data unavailable" states.

6. **Demo completion protocol.** Three demo-specific process PRDs with explicit gates: data integrity, narrative quality, visual impact.

7. **Launch guide documentation series.** Platform-agnostic primary path with Vercel-specific callouts. Covers environment setup, deployment, ontology seeding, demo mode, admin setup, first-run experience.

8. **Agentic tooling documentation.** Agent API surface docs must use the same REST API, RBAC, and ViewConfig/FormConfig structures as the frontend app. Agents are not a separate integration surface.

### Phase 7 Acceptance Criteria

- [ ] Demo deployed on Vercel from `demo` branch, publicly accessible without login
- [ ] All views render data immediately on load (no blank states)
- [ ] Canvas uses proper layout algorithm (force-directed or dagre), not raw grid
- [ ] Pre/during/post event views tell a believable story with authentic AB data
- [ ] Import/export and reset-to-seed work correctly
- [ ] All builder views functional with seeded config data
- [ ] Three demo process PRDs pass their gates
- [ ] Launch guide docs exist and are platform-agnostic with Vercel callouts
- [ ] Driver names visible during/post-event only; pre-event shows company/vendor details only

---

## Phase 8 (Renumbered) Scope

The existing Phase 7 (Rollout Planning) is renumbered to Phase 8. Its scope is unchanged:

| PRD | What |
|-----|------|
| `rollout/roadmap.md` | Dependency-ordered build plan, parallel work streams, milestones |
| `rollout/risk-register.md` | Threats, mitigations, contingencies |

---

## Requirements by Phase

### Phase 6 Redo Requirements

| # | Requirement | Description | User Quote | PRD Affected | Priority |
|---|-------------|-------------|------------|--------------|----------|
| R1 | Config-driven page rendering | Every operational page renders through ViewConfig/FormConfig/PageConfig from Postgres. No hardcoded DataTable implementations. | "What page views (not components but actual pages) aren't rendered from db?" | `modules/guest-relations/*.md`, new Phase 6 integration PRD | must-have |
| R2 | Backend-to-frontend wiring as acceptance criterion | Phase 6 PRDs must include explicit integration requirements connecting the backend engine to frontend renderers. | "wowwwww, what was even the point of all this. Reflect for a moment." | All Phase 6 GR module PRDs | must-have |
| R3 | No spreadsheet list views | List views must use atomic card/record layouts, not raw table/spreadsheet grids. Must feel like an app. | "the organization of the list views on tabs aren't atomic enough and just look like spreadsheets... it doesn't feel like an app at all" | `ui/view-renderer.md`, `modules/guest-relations/overview.md` | must-have |
| R4 | Department-centric settings | Settings page must feel department-centric, not generic. | "the settings page doesn't really feel like it's department centric" | `modules/guest-relations/overview.md` | must-have |
| R5 | Functional canvas tabs | All canvas view tabs must actually do something. No cosmetic-only UI elements. | "the canvas view tabs don't do anything" | `canvas/canvas-engine.md`, Phase 6 integration PRD | must-have |
| R6 | Innovation encouraged | Phase 6 redo should not over-specify implementation. Define outcomes, leave room for discovery. | "I think a fresh approach is best, really treat this as real, and you can even self-discover tooling that might be super helpful." | Phase 6 integration PRD | should-have |
| R7 | Driver name phase-awareness | Transport ontology must distinguish pre-event (vendor name only, driver TBD) from during/post-event (driver name assigned). | "during event and post event the drivers should have names, and pre-event we just have the company/vendor details" | `modules/guest-relations/transport-logistics.md` | must-have |

### New Phase 7 Requirements

| # | Requirement | Description | User Quote | PRD Affected | Priority |
|---|-------------|-------------|------------|--------------|----------|
| R8 | Demo IS the real app | The demo is the production Vue SPA with real Postgres reads and localStorage writes. No static HTML, no mock HTTP layer, no separate codebase. | "the demo is the actual app, just having you seed the data" / "delete the entire demo and start from scratch" | `platform/demo-showcase.md` (rewrite) | must-have |
| R9 | Hybrid read/write architecture | Reads from Neon Postgres via Vercel Functions. Writes intercepted by localStorage adapter. Shared DB stays clean. | "you're still launching with postgres for the backend, you're just not allowing writes to the postgres, writes go to local storage" | `platform/demo-showcase.md`, demo architecture PRD | must-have |
| R10 | Demo on Vercel, demo branch | Vercel hosting (free tier), deployed from `demo` branch. Main branch unaffected. GitHub Pages disqualified. | "would it make sense to refactor this into a vercel demo for quicker uptake? and just create a demo branch" / "dashboard just says data loading... is there another way to host a demo for free" | Demo deployment PRD | must-have |
| R11 | Three temporal views + canvas walkthrough | Pre-event, during-event, post-event seed data states. Plus interactive canvas walkthrough for non-technical stakeholders. | "Maybe a pre-event, during event, and post event view + a walkthrough of the app-based canvas for building the system" | Demo data/narrative PRD | must-have |
| R12 | Demo import/export + reset | Users can save/restore demo session state. Reset-to-seed capability. | "maybe give people a way to import/export their demo data to allow for testing the customization rather than start from scratch" | Demo architecture PRD | must-have |
| R13 | All builder views in demo | Ontology builder, workflow canvas, data flow canvas, form builder, view builder, admin preview. Zero "load failed" states. | "I don't see stuff like the ontology, workflow, data, etc. builders that enable setup? I also don't see an admin preview?" | Demo architecture PRD | must-have |
| R14 | Demo infrastructure minimal | Only a single `demo-store.ts` for state storage. Delete all other demo-* files. | "do you need all those demo-* items other that state storage?" | Demo architecture PRD | must-have |
| R15 | Demo targets non-technical AB staff | Target audience is directors, coordinators, not developers. Seed data uses authentic AB conventions (Japanese guest names, Hynes Convention Center, anime convention scheduling). | "The pages demo is meant for my AB (non technical crowd) to showcase the platform's usage" | Demo narrative PRD | must-have |
| R16 | Three demo process PRDs | Standardized demo completion protocol: data integrity, narrative quality, visual impact. Wired into orchestration. | "Can you standardize that bespoke protocol into 3 demo process prd's" | `process/demo-data-integrity.md`, `process/demo-narrative-quality.md`, `process/demo-visual-impact.md` | must-have |
| R17 | Demo data loads immediately | No blank states, no slow fetches. Demo client returns local JSON synchronously. | "demo pages needs work, it is fairly blank so data isn't populating or loading super slowly" | Demo architecture PRD | must-have |
| R18 | Canvas uses proper layout algorithm | Force-directed or dagre/hierarchical layout. Not a raw grid with straight overlapping lines. | "the visualization engine needs more naturally smart auto graphing, it's currently just a grid with lines which looks weird" | Demo architecture PRD, `canvas/canvas-engine.md` | must-have |
| R19 | Launch guide documentation series | Platform-agnostic primary path + Vercel-specific callouts. Covers env setup, deployment, ontology seeding, demo mode, admin setup, first-run. | "go deeper, build prd's on how to launch, and start saving that in a different folder" / "Write it vercel and non-vercel specific tho for the future." | `docs/launch-guide/` series | must-have |
| R20 | Agentic tooling uses same app surface | Agent-facing API definitions use the same REST API, RBAC, and config structures as the frontend. | "be sure that we're building pages, sub pages, etc. vis-a-vis the same tooling the frontend app has" | Agentic tooling docs | must-have |
| R21 | UX is self-teaching, not retextured Excel | Platform must guide users through the system via contextual cues. Not just powerful, but learnable. | "How are we properly building a system that is self-taught and not just retextured excel docs and google forms" | `ui/builder-to-operator.md`, `process/user-language-standard.md` | must-have |
| R22 | Progressive disclosure rejected | Do not hide complexity behind additional clicks. Show everything, explain clearly. Contextual education at point of use. | "I disagree on progressive disclosure" | All UI PRDs, `process/ux-checklist.md` | must-have |
| R23 | Builder-to-operator translation | Defines how ontology builder output becomes understandable to operators/volunteers. Translation tables, form label derivation, operator-language views. | "Keep the builder-to-user translation prd tho since it integrates with the process prd." | `ui/builder-to-operator.md` | must-have |

### Phase 8 Requirements

| # | Requirement | Description | User Quote | PRD Affected | Priority |
|---|-------------|-------------|------------|--------------|----------|
| R24 | Rollout roadmap | Dependency-ordered build plan, parallel work streams, milestones. | (Established in orchestration) | `rollout/roadmap.md` | must-have |
| R25 | Risk register | Threats, mitigations, contingencies. | (Established in orchestration) | `rollout/risk-register.md` | must-have |

### Process PRD Updates

These are updates to existing process PRDs, not new PRDs.

| # | Requirement | Description | User Quote | PRD Affected | Priority |
|---|-------------|-------------|------------|--------------|----------|
| R26 | Sequential phase execution enforced | Each phase must be executed and verified independently. Never combine phases. | "I don't like how you did 5 and 6 together, it makes me nervous" | `process/phase-discipline.md` | must-have |
| R27 | Convergence protocol for phase completion | Cycle through scans, write-pipeline checks, acceptance audits, fresh-eyes reads, build verification. Loop until zero findings. | "how do we require you not to [take shortcuts] and to keep iterating and discovering until it's actually done?" | `process/phase-completion.md` | must-have |
| R28 | Completion protocol must be blind-executable | Protocol must work for an agent with no prior session context. It discovers failures through its scanning steps. | "you should start the process protocol from the start, not letting the agent know about failures" | `process/phase-completion.md` | must-have |
| R29 | No human approval needed mid-cycle | Once initiated, agent cycles until convergence without stopping for approval. Only stops at zero findings or ambiguous design decisions. | "the process shouldn't need human approval since you got the approval to begin it to begin with" | `process/phase-completion.md` | must-have |
| R30 | Testing proportional to complexity | Test count must be proportional to endpoint/migration/trigger count. Flag phases with anomalously low test coverage. | "why did phase 2 get so little testing?" | `process/phase-completion.md` | must-have |
| R31 | Process changes propagate retroactively | When protocol changes, re-verify all phases completed under the old standard. | "add this to the process and renew the cycle for phase 2 and 3" | `process/phase-completion.md` | must-have |
| R32 | Foundation check before phase advancement | Validate Phase N-1 before any Phase N work begins. If prior phase cannot be verified, subsequent phases are invalid. | "restart from phase 2 entirely, phase 3+ is built on a house of lies" | `process/phase-discipline.md` | must-have |
| R33 | Mandatory PRD discovery before writing new PRDs | Read `_context-index.md`, `_orchestration.md`, and relevant subfolder PRDs before drafting any new PRD. | "be sure to do full discovery and exploration on existing prd's before writing new ones" | `process/session-state.md` | must-have |
| R34 | PRD count must match user specification | When user specifies a count, audit existing PRDs and confirm before writing. Do not produce more or fewer. | "4 prd's, did you not read my message" | `process/session-state.md` | must-have |
| R35 | Gaps require PRDs, not deferrals | Any gap must result in a new PRD. "I have gaps" is not an acceptable status. No gap without a PRD entry, no PRD entry left unimplemented. | "if they're in a PRD they should be done? and if they're not in a prd, start making prd's" | `process/phase-discipline.md` | must-have |
| R36 | Deferred backlog with gate conditions | Each deferred item has a gate condition. Gates checked at phase start. Met gates become current-phase requirements. | "Also where are we tracking a cohesive deferred orchestration plan with gates" | `process/deferred-backlog.md` | must-have |
| R37 | Session state and lesson learning | Agents must save lessons to memory after each session, read all existing PRDs before writing new ones. | "have you been learning lessons for the memory?" | `process/session-state.md` | must-have |
| R38 | Behavioral verification in completion protocol | "Tests pass" and "build succeeds" are insufficient. Must verify real user actions render correctly through config-driven renderers end-to-end. | "that's not a refactor, that's a clear failing of the database and documentation. It's slop." | `process/phase-completion.md` | must-have |
| R39 | Process PRDs are evergreen | Re-run at start of every phase. Self-contained enough that an agent can execute them without prior context. | "is there an evergreen series of 5 PRD's we can implement that require going through and doing all of this each time" | All `process/*.md` | must-have |
| R40 | Testing completeness before shipping | Unit/integration tests pass, E2E tests run, completion process scorecard passes before any deployment. | "Was this tested? E2E? Integration? Completion process? Etc." | `process/phase-completion.md`, demo process PRDs | must-have |

### Architecture Updates

These are updates to existing architecture/platform PRDs.

| # | Requirement | Description | User Quote | PRD Affected | Priority |
|---|-------------|-------------|------------|--------------|----------|
| R41 | Ontology-driven platform principle | No hardcoded domain logic in source. Role lists, field definitions, form configs, workflow rules all Postgres-resident. | "The source code is the engine. The database is the application." | All `core/` PRDs | must-have |
| R42 | Canvas and builder are parallel interfaces | Both required. Technical users use builder (structured). Non-technical users use canvas (visual). Not a design choice. | "they serve different audiences depending on if people are more technical vs no-code" | `canvas/canvas-engine.md`, `canvas/canvas-config-bridge.md` | must-have |
| R43 | Auto-visualization engine written last | Must be written after all other canvas and data-infrastructure PRDs. Defines how every piece connects to every visual surface. | "for auto-visualization engine I think that's worth writing last" | `canvas/system-visualization-architecture.md` | must-have |
| R44 | Canvas supports live data flows | Canvas edits write back to ontology config. Downstream/upstream relationships are live, not cosmetic. | "it's actually editable and flows downstream and upstream" | `canvas/data-flow-canvas.md` | must-have |
| R45 | Data routing and fan-out with PII filtering | Field-level routing rules, PII stripping before cross-department sharing, declarative config. | "a form that someone fills out might need to populate that field in not just the output of the department's form" | `data-infrastructure/data-routing.md` | must-have |
| R46 | RBAC integrated with data pipelines | Data pipeline PRDs must reference `core/rbac.md` and include RBAC enforcement at pipeline level. | "we need to make sure this is all integrated with our app's rbac/permissions" | All `data-infrastructure/` PRDs | must-have |
| R47 | Unified template infrastructure | Six+ template systems must share storage format, versioning, export/import, discovery. No siloed template tables. | "We specifically talked about setting up a template builder/template system" | `platform/template-infrastructure.md` | must-have |
| R48 | Dual-theme design system | OSS default = refined minimal, token-based. AB override = blue/amber palette, `.theme-ab` CSS class. Token naming uses `primary-*` not `ab-*`. | "refined minimal for oss but embrace the fun blue and orange of anime Boston" | `platform/branding.md` | must-have |
| R49 | Font system | M PLUS 1 (Black weight) for display/headers. Lato for body. Both apply across themes. | "the display/header fonts should be Japanese esque" | `platform/branding.md` | must-have |
| R50 | Platform search uses OSS | Evaluate Meilisearch, Typesense, or similar. Do not build custom vector search. | "platform search might be best served with an opensource repo" | `data-infrastructure/platform-search.md` | should-have |
| R51 | System architecture integration PRD | Bridges builders, canvases, and the overall app. How all surfaces connect through one config layer. | "this is the system architecture and integration prd for bridging the builders, canvasses, and overall app" | `canvas/system-visualization-architecture.md` or `canvas/canvas-config-bridge.md` | should-have |
| R52 | Testcontainers in Phase 1 | `data/integration-testing.md` must be Phase 1. Testcontainers is mandated. Not pg-mem, PGlite, or SQLite. | "first write the prds for test containers... update the documentation so it's in phase 1" | `data/integration-testing.md`, `_orchestration.md` | must-have |
| R53 | Phase 4 = data infrastructure, Phase 4.5 = frontend | Orchestration must reflect this split. All data infra PRDs complete before frontend work. | "your data stuff is actually phase 4, and the frontend prd's become 4.5" | `_orchestration.md` | must-have |
| R54 | PRDs gitignored, local copy on Desktop | `docs/prd/` in `.gitignore`. Local copy at `C:\Users\buddah laptop\Desktop\GR-Ops-PRDs\`. | "Can you git ignore them, save a copy of the prd's locally on my desktop" | `.gitignore`, file management | should-have |

### New PRDs Needed

PRDs that do not currently exist and must be written.

| # | Requirement | Description | User Quote | PRD to Create | Priority |
|---|-------------|-------------|------------|---------------|----------|
| R55 | Phase 6 integration PRD | Defines how the config-driven rendering engine (Phases 3-4) connects to GR Module views. The missing piece that caused Phase 6 failure. | "What page views aren't rendered from db?" / "what was even the point of all this" | `modules/guest-relations/config-integration.md` or update to `overview.md` | must-have |
| R56 | Demo architecture PRD | Hybrid read/write model, localStorage adapter, DEMO_MODE flag, seed data scope, import/export, reset-to-seed. Minimal infra (single demo-store.ts). | "the demo is the actual app... writes go to local storage" / "do you need all those demo-* items other than state storage?" | `platform/demo-architecture.md` | must-have |
| R57 | Demo deployment PRD | Vercel hosting, demo branch strategy, build pipeline, preview-deploy-per-PR. | "refactor this into a vercel demo... create a demo branch" | `platform/demo-deployment.md` | must-have |
| R58 | Demo data and narrative PRD | Seed data for three temporal states. Authentic AB data (Japanese names, Hynes venues, anime scheduling). Canvas walkthrough narrative. | "pre-event, during event, and post event view + a walkthrough" | `platform/demo-data-narrative.md` | must-have |
| R59 | Demo process: data integrity | Zero orphan references. Forward/backward reference checks. Name/type/temporal consistency. | "standardize that bespoke protocol into 3 demo process prd's" | `process/demo-data-integrity.md` | must-have |
| R60 | Demo process: narrative quality | Pre/during/post stories are coherent. Canvas walkthrough produces "aha" moment. % completion targets. | (same as R59) | `process/demo-narrative-quality.md` | must-have |
| R61 | Demo process: visual impact | 30-second test, mobile responsiveness, AB branding authenticity, canvas "wow" moment. | (same as R59) | `process/demo-visual-impact.md` | must-have |
| R62 | Launch guide series | How to launch GR-Ops from scratch. Platform-agnostic + Vercel callouts. Updated iteratively as lessons are learned. | "build prd's on how to launch, and start saving that in a different folder" | `docs/launch-guide/` series (multiple docs) | must-have |
| R63 | Subagent orchestration PRD | When parallel dispatch is appropriate vs. sequential. Non-overlapping scope partitions. Model selection guidance. | "5 agents on anti patterns (no overlap) and 5 on prd requirements (no overlap)" | `process/subagent-orchestration.md` | should-have |
| R64 | Internal pipelines PRD | Cross-department data flows, stages, error handling, dead letter queue. | "pipelines are 2 (internal and external)" | `data-infrastructure/internal-pipelines.md` (exists in orchestration) | must-have |
| R65 | External pipelines PRD | Third-party integrations (FlightAware, Guidebook, Google Calendar), sync state, conflict resolution. | (same as R64) | `data-infrastructure/external-pipelines.md` (exists in orchestration) | must-have |
| R66 | Data security / cybersecurity PRD | PII governance, data classification, breach detection, retention, right-to-deletion. | "pipelines are 2 (internal and external) as well as cybersecurity" | `data-infrastructure/data-security.md` (exists in orchestration) | must-have |
| R67 | Data warehouse and data flows PRD | Data warehouse strategy, field-to-field mapping, source-of-record tracking, downstream effect propagation, change tracking. | "we need better data mapping, data warehouse, data flows, and connecting nodes to sources" | `data-infrastructure/data-lineage.md` (partially covers), possibly new PRD | must-have |

---

## Anti-Patterns (Requirements by Negation)

These are corrections the user made that define what the system must NOT do. All PRDs must be written with these in mind.

| Anti-Pattern | Implied Requirement |
|---|---|
| Phases consolidated or skipped | Each phase executed sequentially and fully |
| Gaps found after phase declared "done" | Convergence protocol catches gaps before advancing |
| Phase 3+ built on broken Phase 2 | Foundation check required before each phase |
| Demo was fake static HTML | Demo must be real app with real Postgres backend |
| Canvas tabs that don't function | All UI elements must be functional |
| List views that look like spreadsheets | View renderer must produce app-like layouts |
| Canvas presented as choice vs. builder | Both are required for different audiences |
| Progressive disclosure proposed | Rejected. Show everything, explain clearly |
| PRDs removed from git without user decision | User decides what stays in/out of git |
| Agent wrote more/fewer PRDs than specified | Must hit exact count specified by user |
| Demo deployed before completion protocol | Completion protocol runs before any deploy |
| Phases 5+6 done together | Phases must never be combined |
| Onboarding PRDs built before users exist | Defer onboarding until first production users |
| Multiple siloed template systems | Unified template infrastructure required |
| Custom vector search from scratch | Use OSS search library |
| Agent proceeds from stale context | Must read README and existing PRDs before any work |

---

## PRDs to Write Checklist

Ordered by dependency and phase. Items marked [UPDATE] are rewrites of existing PRDs. Items marked [NEW] do not exist yet. Items marked [VERIFY] exist and need verification against these requirements.

### Priority 1: Process PRD Updates (Before Any Phase Work)

- [ ] [UPDATE] `process/phase-completion.md` -- Add convergence protocol, blind-executability, no mid-cycle approval, testing proportionality, behavioral verification, process change propagation (R27, R28, R29, R30, R31, R38, R40)
- [ ] [UPDATE] `process/phase-discipline.md` -- Add sequential-only enforcement, foundation check, gaps-require-PRDs rule (R26, R32, R35)
- [ ] [UPDATE] `process/session-state.md` -- Add mandatory PRD discovery, PRD count matching, lesson saving (R33, R34, R37)
- [ ] [UPDATE] `process/deferred-backlog.md` -- Add gate conditions, phase-start review, living document updates (R36)
- [ ] [UPDATE] `process/ux-checklist.md` -- Add no-progressive-disclosure constraint, no-spreadsheet constraint (R22, R3)
- [ ] [VERIFY] `process/acceptance-gate.md` -- Confirm alignment with behavioral verification requirement (R38)
- [ ] [VERIFY] `process/write-pipeline.md` -- Confirm alignment with RBAC integration requirement (R46)
- [ ] [VERIFY] `process/user-language-standard.md` -- Confirm alignment with self-teaching UX requirement (R21)
- [ ] [NEW] `process/subagent-orchestration.md` -- Parallel dispatch rules, scope partitions, model selection (R63)

### Priority 2: Architecture PRD Updates (Before Phase 6 Redo)

- [ ] [UPDATE] `_orchestration.md` -- Restructure: Phase 6 = GR Module (config-driven), Phase 7 = Launch/Demo/Docs, Phase 8 = Rollout Planning. Verify Phase 4 = data infra, Phase 4.5 = frontend. Wire demo process PRDs into context. (R53, multiple)
- [ ] [VERIFY] `platform/branding.md` -- Confirm dual-theme, font system, token naming (R48, R49)
- [ ] [VERIFY] `platform/template-infrastructure.md` -- Confirm unified template system (R47)
- [ ] [VERIFY] `canvas/canvas-engine.md` -- Confirm parallel interface requirement, layout algorithms (R42, R18)
- [ ] [VERIFY] `canvas/system-visualization-architecture.md` -- Confirm keystone role, written-last sequencing (R43, R51)
- [ ] [VERIFY] `canvas/data-flow-canvas.md` -- Confirm live data flows, not cosmetic (R44)
- [ ] [VERIFY] `canvas/canvas-config-bridge.md` -- Confirm integration architecture role (R51)
- [ ] [VERIFY] `data-infrastructure/data-routing.md` -- Confirm PII filtering, fan-out (R45)
- [ ] [VERIFY] `data-infrastructure/platform-search.md` -- Confirm OSS approach (R50)
- [ ] [VERIFY] `data/integration-testing.md` -- Confirm Testcontainers mandate, Phase 1 placement (R52)
- [ ] [VERIFY] All `data-infrastructure/` PRDs -- Confirm RBAC integration (R46)

### Priority 3: Phase 6 Redo PRDs

- [ ] [NEW] `modules/guest-relations/config-integration.md` -- How config-driven rendering connects to GR Module views. The integration bridge that was missing. (R55, R1, R2)
- [ ] [VERIFY/UPDATE] `modules/guest-relations/overview.md` -- Add department-centric settings, config-driven rendering requirements (R4)
- [ ] [VERIFY/UPDATE] `modules/guest-relations/guest-lifecycle.md` -- Confirm config-driven forms/views (R1)
- [ ] [VERIFY/UPDATE] `modules/guest-relations/pairings-staffing.md` -- Confirm config-driven views (R1)
- [ ] [VERIFY/UPDATE] `modules/guest-relations/prep-tracking.md` -- Confirm config-driven views (R1)
- [ ] [VERIFY/UPDATE] `modules/guest-relations/contracts.md` -- Confirm in-app view rendering (R1)
- [ ] [VERIFY/UPDATE] `modules/guest-relations/itineraries.md` -- Confirm config-driven rendering (R1)
- [ ] [VERIFY/UPDATE] `modules/guest-relations/transport-logistics.md` -- Add driver name phase-awareness (R7)
- [ ] [VERIFY/UPDATE] `modules/guest-relations/guest-self-service.md` -- Confirm config-driven forms (R1)

### Priority 4: New Phase 7 PRDs (Demo + Launch)

- [ ] [NEW] `platform/demo-architecture.md` -- Hybrid read/write, localStorage adapter, DEMO_MODE flag, seed data scope, import/export, reset, minimal infra (R56, R9, R12, R14, R17)
- [ ] [NEW] `platform/demo-deployment.md` -- Vercel hosting, demo branch, build pipeline, public accessibility (R57, R10)
- [ ] [NEW] `platform/demo-data-narrative.md` -- Three temporal views, authentic AB data, canvas walkthrough, driver name visibility rules (R58, R11, R15, R7)
- [ ] [UPDATE] `platform/demo-showcase.md` -- Rewrite to reference new demo architecture/deployment/narrative PRDs. Remove all GitHub Pages and static HTML references. (R8)
- [ ] [NEW] `process/demo-data-integrity.md` -- Seed data consistency, zero orphan references, cross-file validation (R59)
- [ ] [NEW] `process/demo-narrative-quality.md` -- Story coherence, % targets, authentic names/venues, no placeholders (R60)
- [ ] [NEW] `process/demo-visual-impact.md` -- 30-second test, mobile, branding, canvas wow moment (R61)
- [ ] [NEW/UPDATE] `docs/launch-guide/` series -- Platform-agnostic + Vercel callouts, environment setup, deployment, seeding, demo mode, admin setup, first-run (R62, R19)
- [ ] [VERIFY] `ui/builder-to-operator.md` -- Confirm translation tables, form label derivation, operator language (R23)

### Priority 5: Phase 8 PRDs (Renumbered from Phase 7)

- [ ] [UPDATE] `rollout/roadmap.md` -- Renumber to Phase 8, update dependencies to include Phase 7 (R24)
- [ ] [UPDATE] `rollout/risk-register.md` -- Renumber to Phase 8 (R25)

---

## Deferred Items (Not in Current Scope)

These were explicitly deferred by the user and must NOT be built until their gate conditions are met.

| Item | Gate Condition | Reference |
|---|---|---|
| Onboarding flow PRD | First production users onboarded | "I unfortunately need to defer this. A lot of this isn't helpful until we get the users onboard." |
| In-context education PRD | First production users onboarded | Same as above |
| Populated templates (content) | Template infrastructure built | "instead of building the templates we just focus on the infra for them" |

---

## Orchestration Context Updates Required

The following changes must be made to `_orchestration.md`:

1. Phase 6 renamed: "GR Module (Config-Driven)" -- emphasize config-driven rendering
2. Phase 7 added: "Launch Infrastructure" -- demo architecture, demo deployment, demo data, launch guides
3. Phase 7 (old) renumbered to Phase 8: "Rollout Planning"
4. Demo process PRDs added to the process PRD table (demo-data-integrity, demo-narrative-quality, demo-visual-impact)
5. `platform/demo-showcase.md` moved from Phase 7 (old) to Phase 7 (new)
6. Phase 6 GR module PRDs must reference config-driven rendering as a cross-cutting requirement
7. Agent orchestration rules updated: add "crawl chat logs before Phase 6 redo" and "refresh PRD knowledge from README"

---

*This document is the authoritative input for all PRD writing, rewriting, and verification work. Every requirement is grounded in direct user quotes from the conversation log. No requirement was invented -- each traces to a specific user statement.*
