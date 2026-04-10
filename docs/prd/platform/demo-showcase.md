# Demo Showcase

> A static interactive demo of the actual GR-Ops platform seeded with realistic Anime Boston data.
> Three scenarios (pre-event, during-event, post-event) walk the AB non-technical staff through
> what their convention operations look like in the system. Plus a canvas walkthrough showing
> how the system was built. Hosted on GitHub Pages. No backend required — mocked API responses.

---

## Overview

The demo page is for Anime Boston's convention staff — department directors, coordinators, liaisons,
and volunteers. These are non-technical people who need to understand what the platform does for THEM,
not how it's built. They want to see their guests, their schedules, their prep checklists, their
driver assignments — not architecture diagrams or test counts.

The demo is the actual Vue app compiled as a static build with mocked API responses. It looks and
behaves exactly like the real platform, seeded with realistic (but fictional) Anime Boston data.

---

## Full Specification

### 1. Demo Mode Architecture

**Purpose:** Run the platform frontend without a backend.

**Detail:**

The demo uses the existing Vue app with a `DEMO_MODE=true` flag that swaps the API client from
real HTTP calls to a local JSON data store. All interactions (click, filter, sort, navigate) work.
Write operations (create, edit, delete) show a "Demo Mode — changes not saved" toast but still
update the local state so the user can explore the full flow.

```typescript
// src/api/client.ts
if (import.meta.env.VITE_DEMO_MODE === 'true') {
  // Return mocked responses from src/demo/data/*.json
} else {
  // Real API calls
}
```

**Build for GitHub Pages:**
```bash
VITE_DEMO_MODE=true npm run build
# Output: dist/ → deployed to docs/ or gh-pages branch
```

**Acceptance Criteria:**
- [ ] Demo loads without any backend running
- [ ] All navigation works (sidebar, breadcrumbs, page transitions)
- [ ] Data is realistic and consistent (guest names appear in schedules, pairings, prep items)
- [ ] Write operations show demo toast but update local state

---

### 2. Seed Data — Anime Boston 2026

**Purpose:** Define the fictional but realistic data that populates the demo.

**Guests (12):**
- 4 JP guests (voice actors, manga artists — Japanese names, require interpreters)
- 4 NA guests (content creators, cosplayers — English names)
- 2 Industry guests (studio representatives)
- 2 Special guests (musical performers)

Each guest has: name, type, department, status (varying across the lifecycle), company, pairings,
prep items, schedule events, transport bookings, dietary info, contract status.

**Staff (20):**
- 3 Directors (GR, Programming, Operations)
- 5 Coordinators
- 6 Liaisons (assigned to guests)
- 3 Interpreters
- 3 Volunteers

**Schedule Events (30):**
- Panels, autograph sessions, photo ops, meals, rehearsals, meet & greets
- Spread across Fri/Sat/Sun
- Assigned to venues with time slots

**Venues (8):**
- Main Events Hall A/B, Panel Rooms 1-3, Autograph Hall, Green Room, Press Room

**Prep Items (60):**
- Per-guest checklists (travel confirmed, hotel booked, dietary noted, contract signed, etc.)
- Varying completion states

**Transport Bookings (15):**
- Airport pickups, hotel transfers, inter-venue runs
- Various statuses (requested, confirmed, picked_up, dropped_off)

**Contracts (6):**
- Draft, sent, signed states

**Acceptance Criteria:**
- [ ] Data is internally consistent (guest pairings match staff records)
- [ ] Data covers all lifecycle states (some guests draft, some confirmed, some arrived)
- [ ] Data is realistic enough that AB staff recognize the patterns

---

### 3. Pre-Event View

**Purpose:** Show what the platform looks like 2 weeks before the convention.

**What the user sees:**

- **Dashboard:** 12 guests (4 confirmed, 3 travel_arranged, 3 invited, 2 draft). Prep 45% complete. 8 overdue items. Staff coverage 75%.
- **Guest List:** Mix of statuses. Click a confirmed JP guest → see their full profile, pairings, prep checklist, contract (signed), itinerary.
- **Prep Tracker:** Overdue items highlighted in red. Filter by department. Completion bars per guest.
- **Schedule:** Timeline view of Fri/Sat/Sun. Some slots filled, some empty. Venue conflicts flagged.
- **Staff List:** Liaisons with their guest assignments. Coverage gaps visible.

**Walkthrough narrative:**
"Two weeks out. You log in and see the dashboard. 4 guests are confirmed, but 3 are still just invited — you need to follow up. The prep tracker shows 8 overdue items — click to see which guests and which tasks. Tanaka-san's interpreter hasn't been confirmed yet. The schedule has a conflict in Panel Room 2 on Saturday..."

---

### 4. During-Event View

**Purpose:** Show what the platform looks like during the live convention (Saturday morning).

**What the user sees:**

- **Dashboard:** 10 guests arrived, 2 attending panels RIGHT NOW. 3 transport runs active. Next pickup in 20 minutes.
- **Guest Hub:** Click a guest → see their real-time itinerary for today. Current location (Panel Room 2). Next event in 45 minutes (Autograph Hall). Liaison: Hana Ito (phone number).
- **Transport:** Driver view showing active pickups. Status: waiting at airport for Suzuki-san (flight delayed 30 min). One-click "Picked Up" button.
- **Schedule:** Today's events highlighted. Current events pulsing. Next events upcoming.

**Walkthrough narrative:**
"Saturday morning. The dashboard shows 10 guests have arrived. Tanaka-san is in Panel Room 2 right now — their panel ends in 15 minutes, then they need to get to the Autograph Hall. The transport board shows a driver waiting at Logan Airport — Suzuki-san's flight is delayed. You tap 'Picked Up' when they arrive..."

---

### 5. Post-Event View

**Purpose:** Show what the platform looks like after the convention ends.

**What the user sees:**

- **Dashboard:** All guests departed. 95% prep completion. Convention archived.
- **Analytics:** Return rate by department. First-time vs returning guests. Year-over-year growth chart.
- **Registry:** Guest registry showing multi-year history. "Tanaka Ichiro — attended 2024, 2025, 2026. Dietary: Vegetarian. Prefers Marriott."
- **Archive:** Convention data is read-only. "Anime Boston 2026 — Archived."

**Walkthrough narrative:**
"Convention's over. You archive the year. The registry remembers everything — next year when you start planning, Tanaka-san's preferences are already there. The analytics show your return rate is 78%. Time to start planning 2027..."

---

### 6. Canvas Walkthrough

**Purpose:** Show how the system was built — the canvas view of the GR ontology.

**What the user sees:**

- **System Graph:** All GR concepts as nodes (Guest, Staff, Schedule, Venue, Pairing, Prep Item, Transport, Contract). Relationships as edges. Department boundary around GR.
- **Zoom in:** Click Guest node → see properties (name, type, status, dietary, etc.)
- **Workflow overlay:** Toggle to see the "Guest Confirmed" workflow path: Guest.confirmed → Create Prep Items → Generate Contract → Notify Liaison
- **Data flow overlay:** Toggle to see how guest form data routes to GR (full), PR (non-PII), Transport (pickup details)

**Walkthrough narrative:**
"This is how the system is built. Each circle is a concept — Guests, Staff, Events, Venues. The lines show how they connect. Toggle 'Workflows' to see what happens automatically when a guest gets confirmed. Toggle 'Data Flows' to see where the guest's information goes..."

---

### 7. Navigation

**Purpose:** Define how users move between the three views + canvas.

**Top bar with 4 tabs:**
- 📋 Pre-Event (2 weeks before)
- 🎌 During Event (Saturday morning)
- 📊 Post-Event (after convention)
- 🗺️ How It's Built (canvas walkthrough)

Each tab loads the appropriate seed data state and highlights the relevant features.

---

### 8. Design

**Purpose:** Apply the AB branding for the demo.

- `.theme-ab` class on `<html>` — AB blue + orange
- M PLUS 1 headers, Lato body
- AB logo (loaded from external URL or base64-embedded, NOT in repo as a file)
- "Anime Boston 2026" convention name
- Realistic Japanese + English names in seed data

---

### 9. Acceptance Criteria

- [ ] Demo loads on GitHub Pages without backend
- [ ] All 4 tabs navigate correctly
- [ ] Pre-event, during-event, post-event data states are distinct and realistic
- [ ] Canvas view shows the system graph with overlay toggles
- [ ] AB branding applied (blue/orange, M PLUS 1, convention name)
- [ ] Mobile responsive (convention staff use phones)
- [ ] "Demo Mode" indicator visible but unobtrusive
- [ ] Page loads in <3 seconds
- [ ] No broken links or missing data references
