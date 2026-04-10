# Demo Showcase Page

> The GitHub Pages demo page is the first thing a visitor sees. It must communicate what the platform
> IS, what it DOES, and why it's DIFFERENT — in under 30 seconds. Built as a single static HTML page
> with the platform's design system (M PLUS 1 + Lato, primary/accent tokens). Seeded with the
> finalized architecture, not legacy Notion-era content.

---

## Overview

The demo page (`docs/index.html`) is served via GitHub Pages at the repository URL. It's the primary
marketing/showcase surface for the OSS project. Current visitors see a stale page built early in
development that doesn't reflect the platform's actual capabilities.

This PRD defines a complete rebuild that showcases the finalized architecture: ontology-driven platform,
dual-interface design (builder + canvas), data infrastructure, 76+ PRDs of engineering, and the
Anime Boston deployment as a concrete example.

**Audience:** Developers evaluating the platform for their own convention, potential contributors,
employers reviewing the founder's work, convention organizers curious about the platform.

---

## Full Specification

### 1. Page Structure

**Purpose:** Define the sections and content hierarchy.

**Sections (top to bottom):**

1. **Hero** — "Convention Operations Platform" headline. One-sentence pitch: "Source code is the engine. Database is the application. One deployment, all departments." Call-to-action: "View on GitHub" + "Read the PRDs"

2. **What It Does** — 4 capability cards:
   - **Ontology-Driven** — "Define your domain as data, not code. Concepts, properties, relationships — all in Postgres."
   - **Dual Interface** — "Builder for power users. Canvas for visual thinkers. Same data, different views."
   - **Data Infrastructure** — "Routing, transforms, pipelines, quality, lineage, security — data flows where it needs to go."
   - **Convention-Ready** — "Guest lifecycle, prep tracking, contracts, itineraries, transport, self-service forms — built for Anime Boston, works for any convention."

3. **Architecture Overview** — Interactive or static diagram showing:
   - 7 layers: Presentation (Vue) → API (Express) → Engine (ontology, RBAC, events, workflows) → Data (Postgres, routing, pipelines) → External (integrations)
   - Key numbers: 76 PRDs, 1345 tests, 7 process gates

4. **The System Graph** — Screenshot or animated mockup of the canvas system graph showing concepts as nodes, relationships as edges, departments as regions. Caption: "The platform diagrams itself."

5. **Feature Walkthrough** — Tabbed or scrolling sections:
   - **Ontology Builder** — screenshot + description of concept/property/relationship management
   - **Dynamic Forms** — screenshot of FormKit-rendered form with wizard layout
   - **View Renderer** — screenshot of table, kanban, timeline views
   - **Workflow Engine** — screenshot of workflow canvas with action chain
   - **Data Flow** — screenshot of data routing visualization with PII indicators
   - **Guest Self-Service** — screenshot of external form with save-and-resume

6. **For Anime Boston** — AB-branded section (.theme-ab colors) showing:
   - "Built for a 25,000-attendee volunteer-run anime convention"
   - GR module features: guest lifecycle, liaison assignments, prep tracking, contracts, itineraries, transport
   - The blue + orange palette, M PLUS 1 headers

7. **Tech Stack** — Grid of technologies with logos:
   - TypeScript, Vue 3, PrimeVue, FormKit, Vue Flow, Tailwind
   - Express, PostgreSQL, Firebase, Vitest, Testcontainers
   - Typesense, Zod, Docker

8. **Engineering Quality** — Stats:
   - 1345+ unit tests, 62 integration tests
   - 7 process PRDs with iterative convergence protocol
   - Phase completion requires zero findings across 6 verification steps
   - Every write endpoint: auth → RBAC → Zod → audit → encrypt → write → event → claim

9. **Getting Started** — Quick setup instructions (abbreviated from README):
   ```bash
   git clone ... && cd functions && npm install && npm test
   ```

10. **Footer** — AGPL-3.0 license, GitHub link, PRD documentation link

### 2. Design Requirements

**Purpose:** Define the visual treatment per the design system.

- **Typography:** M PLUS 1 (display/headers, Black weight for hero) + Lato (body)
- **Colors:** Neutral OSS palette (slate primary + amber accent) for most sections. AB section uses .theme-ab override.
- **Layout:** Full-width sections with max-width content container. Generous vertical spacing between sections. Alternating background tints (surface-0 / surface-50).
- **Motion:** Scroll-triggered reveals using IntersectionObserver. Staggered card animations. No heavy JS frameworks — vanilla JS + CSS animations.
- **Responsive:** Mobile-first. Hero stacks vertically. Feature cards wrap to single column. Screenshots scale.
- **Performance:** Single HTML file. Fonts loaded via Google Fonts CDN. No build step. Images as SVG or optimized PNG with lazy loading.
- **Accessibility:** Semantic HTML. Alt text on all images. Color contrast WCAG AA. Skip-to-content link.

### 3. Content Sources

**Purpose:** Define where each section's content comes from.

| Section | Content Source |
|---------|--------------|
| Hero | Platform vision from `platform/vision.md` |
| What It Does | Summarized from PRD shorthand descriptions |
| Architecture | Derived from `platform/architecture.md` layer model |
| System Graph | Screenshot of SystemGraphView.vue (or SVG mockup) |
| Feature Walkthrough | Screenshots of each Vue component (or SVG mockups) |
| For Anime Boston | From `modules/guest-relations/overview.md` + branding PRD |
| Tech Stack | From `package.json` dependencies |
| Engineering Quality | From test counts + process PRD descriptions |
| Getting Started | Abbreviated from README.md |

### 4. Screenshots vs Mockups

**Purpose:** Define whether to use real screenshots or static mockups.

Since the frontend components exist but aren't deployed, use **SVG mockups** that accurately represent the component designs. These should be embedded inline (not external files) for single-page delivery.

Mockups should show:
- The actual design system (M PLUS 1 headers, Lato body, primary/accent colors)
- Realistic data (Anime Boston guest names, schedule events, venue names)
- The dual-interface concept (builder panel + canvas view side by side)

### 5. AB Branding Section

**Purpose:** Showcase the convention-specific deployment.

This section applies `.theme-ab` to its container, switching to AB's blue (#4A90C4) + orange (#E8962D) palette. It demonstrates that the same platform renders differently per convention branding — the OSS neutral theme above, the AB theme here.

Content:
- "Anime Boston 2026" header in AB blue
- GR-specific feature list (guest lifecycle, liaison assignments, etc.)
- Data flow example: "Guest fills out dietary form → GR gets full details → PR gets non-PII version for social media → Transport gets pickup preferences"

### 6. Acceptance Criteria

- [ ] Page loads in <2 seconds on 3G connection
- [ ] All sections render on mobile (320px viewport)
- [ ] Zero `ab-*` CSS class references (uses primary-*/accent-* with .theme-ab override)
- [ ] Zero "Anime Boston" outside the AB-branded section
- [ ] M PLUS 1 + Lato fonts used throughout
- [ ] Scroll-triggered animations work without JavaScript errors
- [ ] GitHub link and PRD link are correct
- [ ] AGPL-3.0 license mentioned
- [ ] Test counts and PRD counts are accurate
- [ ] Alt text on all visual elements

### 7. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Mobile layout | Visual | 320px viewport | All sections visible, no horizontal scroll |
| Desktop layout | Visual | 1440px viewport | Full-width sections with centered content |
| Font loading | Visual | Verify M PLUS 1 + Lato render | No FOUT/FOIT after initial load |
| Theme switch | Visual | AB section uses .theme-ab | Blue/orange palette visible only in AB section |
| Performance | Lighthouse | Page speed score | >90 on mobile |
| Accessibility | Lighthouse | A11y score | >90 |
| Links | Functional | GitHub + PRD links | Both resolve correctly |
| Animations | Functional | Scroll through page | Sections reveal smoothly |
