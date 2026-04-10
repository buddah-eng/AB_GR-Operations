# Demo Showcase

> The demo IS the real GR-Ops platform deployed with `VITE_DEMO_MODE=true` on Vercel. Reads hit
> real Postgres (Neon). Writes intercepted by localStorage adapter. Seeded with authentic Anime
> Boston data across three temporal views (pre-event, during-event, post-event) plus a canvas
> walkthrough. Target audience: AB non-technical staff — directors, coordinators, liaisons.

---

## Overview

The demo page is for Anime Boston's convention staff — department directors, coordinators, liaisons,
and volunteers. These are non-technical people who need to understand what the platform does for THEM,
not how it's built. They want to see their guests, their schedules, their prep checklists, their
driver assignments — not architecture diagrams or test counts.

The demo is the production Vue SPA deployed to Vercel with `VITE_DEMO_MODE=true`. Reads go to real
Neon Postgres. Writes are intercepted by a localStorage adapter. No mock HTTP layers. No separate
codebase. No static HTML. The diff between demo and production is minimal — a single environment
flag and a storage adapter.

**This PRD is the umbrella.** Implementation details are split across three supporting PRDs:
- `platform/demo-architecture.md` — Hybrid read/write model, localStorage adapter, import/export
- `platform/demo-deployment.md` — Vercel hosting, demo branch strategy, build pipeline
- `platform/demo-data-narrative.md` — Seed data for three temporal states, authentic AB data

**Dependencies:** All implementation phases (the demo showcases the complete platform)

---

## Full Specification

### 1. What the Demo Demonstrates

**Purpose:** Define the demo's value proposition for non-technical AB staff.

**The demo answers one question:** "What would it be like to use GR-Ops for Anime Boston?"

| View | What It Shows | Key "Aha" Moments |
|------|-------------|-------------------|
| Pre-event | Platform 6 weeks before convention | "I can see who hasn't confirmed, what prep is overdue, and which flights to track — in one place" |
| During-event | Platform on Saturday of convention | "Real-time driver locations, live schedule, instant pickup status updates" |
| Post-event | Platform 1 week after convention | "Everything's archived. Next year, the system remembers guest preferences" |
| Canvas walkthrough | How the system was built | "This is how we define what a Guest is, what happens when one confirms, where data flows" |

### 2. Navigation

**Top bar with 4 tabs:**
- Pre-Event (6 weeks before)
- During Event (Saturday morning)
- Post-Event (after convention)
- How It's Built (canvas walkthrough)

Each tab loads the appropriate seed data state. Switching tabs changes the temporal context
but preserves the app structure — same sidebar, same pages, different data snapshot.

### 3. Design

- `.theme-ab` class on `<html>` — AB blue/amber palette
- M PLUS 1 (Black weight) for display/headers, Lato for body text
- AB logo (loaded from config, not committed to repo)
- "Anime Boston 2026" convention name from platform_config
- Realistic Japanese + English names throughout seed data

### 4. All Builder Views Present

The demo must include ALL builder/admin views with seeded config data:
- Ontology builder (concept/property/relationship editors with GR concepts loaded)
- Workflow canvas (guest lifecycle workflows visible and navigable)
- Data flow canvas (GR data routing visible with PII indicators)
- Form builder (guest intake wizard config visible and editable in demo mode)
- View builder (guest list ViewConfig visible and editable)
- Admin preview (what the system looks like to each role)

Zero "load failed" or "data unavailable" states. Every builder view renders data immediately.

### 5. What This Is NOT

- ~~GitHub Pages hosting~~ → Vercel (SPA routing works, serverless functions available)
- ~~Mocked API responses~~ → Real Postgres reads via Vercel Functions
- ~~Static HTML~~ → Production Vue SPA with DEMO_MODE flag
- ~~Separate demo codebase~~ → Same repo, demo branch, one env var difference
- ~~504-line demo-client.ts~~ → Single demo-store.ts file

---

## Acceptance Criteria

- [ ] Demo deployed on Vercel from `demo` branch, publicly accessible without login
- [ ] All 4 navigation tabs work correctly
- [ ] Pre/during/post-event data states are distinct, realistic, and tell a coherent story
- [ ] Canvas walkthrough shows system graph with overlay toggles (workflows, data flows)
- [ ] AB branding applied (blue/amber, M PLUS 1 headers, convention name)
- [ ] All builder views render data (ontology, workflow, data flow, form, view builders)
- [ ] Mobile responsive (convention staff use phones)
- [ ] "Demo Mode" banner visible but unobtrusive
- [ ] All views render data immediately on load (no blank states)
- [ ] Import/export and reset-to-seed work correctly
- [ ] Driver names visible during/post-event only; pre-event shows company/vendor details
- [ ] Canvas uses proper layout algorithm (force-directed or dagre), not raw grid
- [ ] Page loads in <3 seconds
- [ ] No broken links, missing data references, or "load failed" states
- [ ] Three demo process PRDs (data-integrity, narrative-quality, visual-impact) pass their gates

---

## Test Plan

| Test | Type | Expected |
|------|------|----------|
| Load demo URL | E2E | Page renders with data visible within 3 seconds |
| Switch temporal tabs | E2E | Data changes to match pre/during/post/canvas views |
| Navigate all pages | E2E | Guest list, detail, schedule, prep, staff, settings all render |
| Try write operation | E2E | Toast shows "Demo Mode", change visible in localStorage |
| Export/import | E2E | Export downloads JSON, import restores state |
| Reset to seed | E2E | Clears localStorage, returns to original data |
| Mobile viewport | E2E | All pages render correctly at 375px width |
| Builder views | E2E | Ontology, workflow, data flow, form, view builders all render with data |
| Canvas layout | Visual | Force-directed layout, not raw grid |
| AB branding | Visual | Blue/amber theme, M PLUS 1 headers, Lato body |
