# Demo Data Narrative

> Three temporal views (pre-event, during-event, post-event) seeded with authentic Anime Boston data.
> Japanese guest names, Hynes Convention Center venues, real anime convention scheduling, convention departments.
> Canvas walkthrough explains how the system was built using the ontology -- non-technical, for AB staff.
> Driver names visible during/post-event only; pre-event shows vendor/company details.

---

## Overview

The demo tells a story. Three snapshots of the same convention -- six weeks before, the Saturday of, and one week after -- show AB staff what the platform does for them at each stage of the convention lifecycle. The data is fictional but authentic: Japanese voice actors with real-sounding names, Hynes Convention Center room names, anime industry companies, and the actual operational patterns that convention staff recognize from their own experience.

The target audience is Anime Boston's non-technical staff: department directors, coordinators, liaisons, and volunteers. They do not care about database schemas, API endpoints, or ontology tables. They care about their guests, their schedules, their prep checklists, and their driver assignments. Every data point in the demo should make them think "yes, this is what our convention looks like."

A fourth view -- the canvas walkthrough -- shows how the system was built, but in non-technical terms. It explains concepts, properties, relationships, and workflows using language like "this is how we defined what a Guest is" rather than "this is the ontology_concepts table."

**Dependencies:** `platform/demo-architecture.md` (DEMO_MODE flag, localStorage adapter), `platform/demo-deployment.md` (Vercel + Neon hosting), `modules/guest-relations/transport-logistics.md` (driver name visibility rules), `modules/guest-relations/guest-lifecycle.md` (status flow), `shared-services/scheduling-calendar.md` (event types), `shared-services/venue-management.md` (venue data)

**Requirements covered:** R58 (temporal seed data), R11 (authentic AB data), R15 (canvas walkthrough), R7 (driver name visibility rules)

---

## Full Specification

### 1. Temporal View Model

**Purpose:** Define how the three temporal states are structured and switched.

**Detail:**

Each temporal view represents a complete, internally consistent snapshot of convention data at a specific point in time. The seed data is not three separate databases -- it is three sets of Postgres rows distinguished by a `temporal_state` column (or equivalent mechanism in the seed script) that the demo's temporal switcher filters on.

**Temporal states:**

| State | Label | Date Context | Prep Completion |
|-------|-------|-------------|-----------------|
| `pre_event` | "6 Weeks Before" | April 2026 (convention is late May) | 40-50% |
| `during_event` | "Saturday of Convention" | Saturday, May 23, 2026 | 85%+ |
| `post_event` | "1 Week After" | June 1, 2026 | 100% |

**Switching mechanism:** The temporal view switcher is a top-level navigation element (tab bar or segmented control) that filters all data on the current page to the selected temporal state. Switching states does not reload the page -- it re-queries the API with a `temporal_state` filter parameter.

**Data consistency rule:** Every record in a temporal state must be internally consistent with every other record in that same state. A guest marked as `arrived` in during-event must have a transport booking with status `dropped_off` (they got there somehow). A staff member assigned as a liaison in pre-event must still be assigned in during-event and post-event.

**Acceptance Criteria:**
- [ ] Three temporal states are selectable from any page
- [ ] Switching states updates all visible data without page reload
- [ ] Data within each state is internally consistent (no orphan references)
- [ ] Temporal state persists across page navigation within the demo

---

### 2. Guest Seed Data

**Purpose:** Define the fictional guest roster with authentic Japanese and English names.

**Detail:**

**12 guests total:**

| # | Name | Type | Country | Company/Agency | Pre-Event Status | During-Event Status | Post-Event Status |
|---|------|------|---------|---------------|-----------------|-------------------|------------------|
| 1 | Yamamoto Keiko | Voice Actor | JP | Aoni Production | confirmed | attending | departed |
| 2 | Tanaka Hiroshi | Manga Artist | JP | Shueisha | travel_arranged | arrived | departed |
| 3 | Suzuki Rina | Voice Actor | JP | I'm Enterprise | invited | attending | departed |
| 4 | Nakamura Yuto | Director | JP | Bones Inc. | confirmed | arrived | departed |
| 5 | Sarah Chen | Content Creator | NA | Independent | confirmed | attending | departed |
| 6 | Marcus Williams | Cosplay Guest | NA | Independent | travel_arranged | arrived | departed |
| 7 | Emily Rodriguez | Voice Actor (EN dub) | NA | FUNimation | confirmed | attending | departed |
| 8 | David Kim | Content Creator | NA | Independent | invited | arrived | departed |
| 9 | Watanabe Akira | Producer | JP | MAPPA | confirmed | attending | departed |
| 10 | Lisa Nguyen | Cosplay Guest | NA | Independent | draft | confirmed | departed |
| 11 | Ito Sora | Musical Artist | JP | Lantis | travel_arranged | attending | departed |
| 12 | James Park | Industry Rep | NA | Crunchyroll | confirmed | arrived | departed |

**Guest properties per record:**

Each guest record includes:
- `name`, `name_japanese` (kanji for JP guests, e.g., "山本恵子")
- `type` (voice_actor, manga_artist, director, producer, content_creator, cosplay_guest, musical_artist, industry_rep)
- `status` (as above, per temporal state)
- `country`, `company`
- `requires_interpreter` (true for JP guests)
- `dietary` (e.g., "Vegetarian", "Halal", "No restrictions")
- `hotel` (e.g., "Sheraton Boston", "Marriott Copley Place")
- `arrival_date`, `departure_date`
- `contract_status` (per temporal state)
- `prep_completion_pct` (per temporal state)
- `notes` (convention-relevant, e.g., "First time at AB", "Returning guest -- attended 2024, 2025")

**Name authenticity rules:**
- Japanese names use family-name-first order (Yamamoto Keiko, not Keiko Yamamoto)
- Names sound like real people, not placeholders ("Tanaka Hiroshi" not "Test Guest JP 2")
- Companies are real anime industry companies (Bones, MAPPA, Shueisha, FUNimation, Crunchyroll)
- Agencies are realistic (Aoni Production, I'm Enterprise -- real Japanese talent agencies)

**Acceptance Criteria:**
- [ ] 12 guest records seeded with all properties populated
- [ ] Japanese names in family-name-first order
- [ ] Each guest has distinct status progression across all three temporal states
- [ ] Companies and agencies are recognizable anime industry names
- [ ] No placeholder names ("Test User", "Guest 1", etc.)

---

### 3. Staff Seed Data

**Purpose:** Define the staff roster that operates the convention.

**Detail:**

**20 staff members:**

| Role | Count | Names (examples) | Department |
|------|-------|-------------------|------------|
| Director | 3 | Hana Ito (GR), Ryan Cooper (Programming), Mei Zhang (Operations) | GR, Programming, Operations |
| Coordinator | 5 | Alex Torres (GR), Priya Sharma (GR), Jordan Lee (Programming), Casey Brown (Operations), Sam Rivera (Exhibits) | Various |
| Liaison | 6 | Yuki Tanaka, Megan O'Brien, Chris Patel, Dana Flores, Aiden Murphy, Noa Kim | GR (assigned to specific guests) |
| Interpreter | 3 | Akiko Sato, Kenji Mori, Haruka Endo | GR (assigned to JP guests) |
| Volunteer | 3 | Tyler Brooks, Jasmine Wu, Omar Hassan | Various |

**Staff properties per record:**
- `name`, `email` (e.g., `hana.ito@animeboston.org`), `phone`
- `role` (director, coordinator, liaison, interpreter, volunteer)
- `department` (guest_relations, programming, operations, exhibits)
- `languages` (for interpreters: ["English", "Japanese"])
- `assigned_guests` (for liaisons: list of guest IDs)
- `availability` (for volunteers: shift blocks)

**Liaison-to-guest assignments:**
- Yuki Tanaka -- Yamamoto Keiko, Suzuki Rina (JP voice actors)
- Megan O'Brien -- Emily Rodriguez, Sarah Chen (NA guests)
- Chris Patel -- Tanaka Hiroshi, Nakamura Yuto (JP manga/director)
- Dana Flores -- Marcus Williams, Lisa Nguyen (cosplay guests)
- Aiden Murphy -- David Kim, James Park (NA content/industry)
- Noa Kim -- Watanabe Akira, Ito Sora (JP producer/musician)

**Interpreter assignments (JP guests only):**
- Akiko Sato -- Yamamoto Keiko, Tanaka Hiroshi
- Kenji Mori -- Suzuki Rina, Nakamura Yuto
- Haruka Endo -- Watanabe Akira, Ito Sora

**Temporal variation:**

| Aspect | Pre-Event | During-Event | Post-Event |
|--------|-----------|-------------|------------|
| Coverage | 75% -- 2 volunteer slots still open | 100% -- full coverage, active duty | 100% -- wrap-up mode |
| Liaison status | Assigned, prepping | On-site, actively escorting | Submitting feedback |
| Interpreter status | Confirmed for specific events | Interpreting at panels/signings | Post-event debrief notes |

**Acceptance Criteria:**
- [ ] 20 staff records seeded with role, department, and assignments
- [ ] Every JP guest has both a liaison and an interpreter assigned
- [ ] Staff coverage progresses from 75% (pre) to 100% (during/post)
- [ ] Email addresses use realistic `@animeboston.org` domain

---

### 4. Schedule Seed Data

**Purpose:** Define the convention schedule with realistic anime convention event types.

**Detail:**

**30 schedule events across Friday/Saturday/Sunday:**

| Day | Events | Types |
|-----|--------|-------|
| Friday | 8 events | Opening ceremony, 3 panels, 2 autograph sessions, rehearsal, welcome dinner |
| Saturday | 14 events | 5 panels, 3 autograph sessions, 2 photo ops, concert rehearsal, concert, 1 meet & greet, press interview |
| Sunday | 8 events | 3 panels, 2 autograph sessions, closing ceremony, farewell brunch, departure coordination |

**Example events (Saturday):**

| Time | Event | Venue | Guests | Staff |
|------|-------|-------|--------|-------|
| 10:00-11:00 | "Voices Behind the Characters" panel | Ballroom A | Yamamoto Keiko, Emily Rodriguez | Yuki Tanaka (liaison), Akiko Sato (interpreter), 2 volunteers |
| 11:00-12:30 | Yamamoto Keiko autograph session | Autograph Hall | Yamamoto Keiko | Yuki Tanaka, Akiko Sato, 1 volunteer |
| 12:00-13:00 | "Drawing Manga Live" demo | Room 210 | Tanaka Hiroshi | Chris Patel, Akiko Sato |
| 13:00-14:00 | Lunch break (green room) | Green Room A | All JP guests | Interpreters rotate |
| 14:00-15:00 | "Inside MAPPA" industry panel | Ballroom B | Watanabe Akira, Nakamura Yuto | Noa Kim, Kenji Mori |
| 15:00-16:00 | Cosplay guest photo op | Photo Op Room | Marcus Williams, Lisa Nguyen | Dana Flores, 1 volunteer |
| 16:00-17:00 | "Anime in America" roundtable | Room 312 | Sarah Chen, David Kim, James Park | Megan O'Brien, Aiden Murphy |
| 17:00-18:00 | Press interviews | Press Room | Yamamoto Keiko, Watanabe Akira | Yuki Tanaka, Noa Kim, interpreters |
| 19:00-20:00 | Concert sound check | Main Events Hall | Ito Sora | Noa Kim, Haruka Endo |
| 20:00-22:00 | Evening concert | Main Events Hall | Ito Sora | Full operations staff |

**Venues (Hynes Convention Center + hotel):**

| Venue | Type | Capacity | Floor |
|-------|------|----------|-------|
| Ballroom A | Panel/main events | 800 | 2 |
| Ballroom B | Panel/main events | 600 | 2 |
| Room 210 | Panel room | 200 | 2 |
| Room 312 | Panel room | 150 | 3 |
| Main Events Hall | Concert/ceremony | 2000 | 1 |
| Autograph Hall | Autograph sessions | 300 | 1 |
| Photo Op Room | Photo ops | 100 | 1 |
| Green Room A | Guest lounge | 30 | 2 |
| Green Room B | Guest prep/quiet | 15 | 2 |
| Press Room | Interviews | 50 | 3 |
| Sheraton Grand Ballroom | Meals/banquets | 400 | Hotel |

**Temporal variation:**

| Aspect | Pre-Event | During-Event | Post-Event |
|--------|-----------|-------------|------------|
| Schedule status | Draft -- 24 of 30 events confirmed, 6 TBD | Live -- all events scheduled, current events highlighted | Archived -- all events completed |
| Venue conflicts | 2 conflicts flagged (Room 210 double-booked Saturday 12-1pm) | Conflicts resolved | N/A |
| Staff assignment | 80% assigned, some volunteer gaps | 100% assigned, active on-site | Completed |

**Acceptance Criteria:**
- [ ] 30 events seeded across 3 days with times, venues, and guest/staff assignments
- [ ] Venue names match Hynes Convention Center (Ballroom A, Room 210, etc.)
- [ ] Event types reflect real anime convention programming (panels, autographs, concerts)
- [ ] Saturday has the most events (convention peak day)
- [ ] Pre-event schedule shows draft status with some gaps and conflicts

---

### 5. Transport Seed Data

**Purpose:** Define transport bookings with driver name visibility rules that change across temporal states.

**Detail:**

**15 transport bookings:**

| # | Guest | Type | Provider | Pre-Event | During-Event | Post-Event |
|---|-------|------|----------|-----------|-------------|------------|
| 1 | Yamamoto Keiko | Airport pickup (arrival) | Elite Transportation LLC | booked | dropped_off | completed |
| 2 | Tanaka Hiroshi | Airport pickup (arrival) | Elite Transportation LLC | booked | dropped_off | completed |
| 3 | Suzuki Rina | Airport pickup (arrival) | Nihon Travel Co. | requested | picked_up | completed |
| 4 | Nakamura Yuto | Airport pickup (arrival) | Nihon Travel Co. | booked | dropped_off | completed |
| 5 | Watanabe Akira | Airport pickup (arrival) | Elite Transportation LLC | booked | dropped_off | completed |
| 6 | Ito Sora | Airport pickup (arrival) | Nihon Travel Co. | booked | waiting | completed |
| 7 | Sarah Chen | Airport pickup (arrival) | Boston Car Service | booked | dropped_off | completed |
| 8 | Marcus Williams | Airport pickup (arrival) | Volunteer driver | requested | dropped_off | completed |
| 9 | Emily Rodriguez | Airport pickup (arrival) | Boston Car Service | booked | dropped_off | completed |
| 10 | Yamamoto Keiko | Inter-venue (Hynes to Sheraton) | Elite Transportation LLC | not_created | driver_en_route | completed |
| 11 | Tanaka Hiroshi | Inter-venue (Hynes to hotel) | Elite Transportation LLC | not_created | waiting | completed |
| 12 | Ito Sora | Concert venue transfer | Nihon Travel Co. | not_created | driver_en_route | completed |
| 13 | Yamamoto Keiko | Airport dropoff (departure) | Elite Transportation LLC | not_created | not_created | completed |
| 14 | Tanaka Hiroshi | Airport dropoff (departure) | Elite Transportation LLC | not_created | not_created | completed |
| 15 | Sarah Chen | Airport dropoff (departure) | Boston Car Service | not_created | not_created | completed |

**Driver name visibility rules (R7):**

This is a core narrative detail. Driver names follow a strict temporal pattern that reflects real convention operations:

| Temporal State | Driver Name Field | Driver Phone | Driver Plate | Rationale |
|---------------|-------------------|-------------|-------------|-----------|
| **Pre-event** | Empty / "TBD" | Hidden | Hidden | Vendors have not assigned specific drivers yet. The booking is with the company ("Elite Transportation LLC"), not a person. |
| **During-event** | Named driver (e.g., "Tanaka Kenji", "Sarah Mitchell") | Visible | Visible | Vendors assign named drivers from their pool 24-48 hours before or day-of. Staff need driver details for coordination. |
| **Post-event** | Named driver (from completed trip) | Visible | Visible | Historical record of who drove whom. Needed for expense reconciliation and future vendor evaluation. |

**Pre-event transport display:**

```
Booking #1: Yamamoto Keiko
  Provider:  Elite Transportation LLC
  Type:      Airport pickup
  Pickup:    Logan Airport, Terminal E
  Dropoff:   Sheraton Boston Hotel
  Status:    Booked
  Driver:    TBD (assigned by vendor 24-48h before)
  Flight:    JL008 (Narita → Boston)
```

**During-event transport display:**

```
Booking #1: Yamamoto Keiko
  Provider:  Elite Transportation LLC
  Type:      Airport pickup
  Pickup:    Logan Airport, Terminal E
  Dropoff:   Sheraton Boston Hotel
  Status:    Dropped off (completed 2:45 PM)
  Driver:    Tanaka Kenji  |  (617) 555-0142  |  Black Lincoln MKZ, plate: 4RT 829
  Flight:    JL008 — Landed 1:52 PM (on time)
```

**Post-event transport display:**

```
Booking #1: Yamamoto Keiko
  Provider:  Elite Transportation LLC
  Type:      Airport pickup
  Status:    Completed
  Driver:    Tanaka Kenji
  Trip:      Logan Terminal E → Sheraton Boston  |  Completed Fri May 22, 2:45 PM
```

**Named drivers for during/post-event:**

| Booking | Driver Name | Vehicle | Provider |
|---------|-------------|---------|----------|
| 1, 2, 5 | Tanaka Kenji | Black Lincoln MKZ | Elite Transportation LLC |
| 10, 11, 13, 14 | Robert Chen | Black Suburban | Elite Transportation LLC |
| 3, 4, 6 | Yamada Yuki | Silver Toyota Alphard | Nihon Travel Co. |
| 12 | Kimura Masao | Black Toyota Crown | Nihon Travel Co. |
| 7, 9, 15 | Sarah Mitchell | Black Cadillac Escalade | Boston Car Service |
| 8 | Tyler Brooks | Personal vehicle (Honda Civic) | Volunteer |

**Flight data (for airport bookings):**

| Guest | Flight | Route | Pre-Event ETA | During-Event Status |
|-------|--------|-------|--------------|-------------------|
| Yamamoto Keiko | JL008 | NRT-BOS | Fri 1:30 PM | Landed 1:52 PM (on time) |
| Tanaka Hiroshi | NH172 | HND-BOS | Fri 2:15 PM | Landed 2:40 PM (25 min delay) |
| Suzuki Rina | JL008 | NRT-BOS | Fri 1:30 PM | Landed 1:52 PM (on time, same flight as Yamamoto) |
| Nakamura Yuto | UA838 | NRT-ORD-BOS | Thu 6:00 PM | Landed 6:22 PM (on time) |
| Watanabe Akira | DL471 | NRT-DTW-BOS | Fri 11:00 AM | Landed 11:15 AM (on time) |
| Ito Sora | JL006 | NRT-BOS | Sat 10:00 AM | Landed -- waiting for pickup |

**Acceptance Criteria:**
- [ ] 15 transport bookings seeded with provider, status, and flight data
- [ ] Pre-event: driver_name is empty or "TBD" for all bookings
- [ ] During-event: driver_name, driver_phone, and driver_plate populated for active/completed bookings
- [ ] Post-event: driver details preserved in completed trip records
- [ ] Flight data uses realistic airline codes and routes (JL = JAL, NH = ANA, UA = United, DL = Delta)
- [ ] Transport providers are companies, not individuals, in pre-event view

---

### 6. Prep Item Seed Data

**Purpose:** Define per-guest preparation checklists that show progress across temporal states.

**Detail:**

**60 prep items across 12 guests (average 5 per guest):**

Standard prep item categories (generated from templates per guest type):

| Category | Items | Applies To |
|----------|-------|------------|
| Travel | Flight booked, hotel reserved, airport pickup arranged, travel visa confirmed | All guests |
| Contract | Contract sent, contract signed, payment terms confirmed | All guests |
| Convention | Badge prepared, schedule confirmed, green room access set up | All guests |
| JP-specific | Interpreter assigned, dietary preferences noted, bilingual signage ordered | JP guests only |
| Performance | Sound check scheduled, equipment list received, stage layout confirmed | Musical artists only |
| Industry | Meeting room reserved, NDA signed, presentation equipment confirmed | Industry reps only |

**Temporal completion rates:**

| Guest | Pre-Event (%) | During-Event (%) | Post-Event (%) |
|-------|--------------|-----------------|----------------|
| Yamamoto Keiko | 60% (6/10) | 100% (10/10) | 100% |
| Tanaka Hiroshi | 50% (4/8) | 90% (7/8 -- missing farewell gift) | 100% |
| Suzuki Rina | 30% (2/7) | 85% (6/7) | 100% |
| Nakamura Yuto | 70% (5/7) | 100% (7/7) | 100% |
| Sarah Chen | 80% (4/5) | 100% (5/5) | 100% |
| Marcus Williams | 40% (2/5) | 90% (4.5/5) | 100% |
| Emily Rodriguez | 60% (3/5) | 100% (5/5) | 100% |
| David Kim | 20% (1/5) | 80% (4/5) | 100% |
| Watanabe Akira | 70% (5/7) | 100% (7/7) | 100% |
| Lisa Nguyen | 10% (0.5/5) | 70% (3.5/5) | 100% |
| Ito Sora | 50% (4/8) | 90% (7/8 -- sound check pending) | 100% |
| James Park | 60% (3/5) | 100% (5/5) | 100% |

**Pre-event overdue items (flagged red):**
- Suzuki Rina: contract not yet sent (invited status, not confirmed)
- David Kim: flight not booked, hotel not reserved (invited, slow response)
- Lisa Nguyen: still in draft status, most prep items not started
- Tanaka Hiroshi: dietary preferences not confirmed (follow-up needed)

**Overall pre-event prep: ~47% complete (realistic for 6 weeks out)**

**Acceptance Criteria:**
- [ ] 60 prep items seeded across 12 guests
- [ ] Pre-event shows 40-50% overall completion with overdue items flagged
- [ ] During-event shows 85%+ completion
- [ ] Post-event shows 100% completion
- [ ] JP-specific prep items only appear on JP guest records
- [ ] Overdue items have realistic reasons (not just random incompleteness)

---

### 7. Contract Seed Data

**Purpose:** Define contract states across temporal views.

**Detail:**

**12 contracts (one per guest):**

| Temporal State | Contract States |
|---------------|----------------|
| Pre-event | 3 signed (Yamamoto, Nakamura, Chen), 4 sent (Tanaka, Rodriguez, Watanabe, Park), 2 draft (Williams, Kim), 1 template_ready (Nguyen), 2 sent (Suzuki, Ito) |
| During-event | 11 signed, 1 signed late (Nguyen -- confirmed day-of) |
| Post-event | 12 completed and archived |

**Contract details per guest include:**
- Base clauses (appearance agreement, liability waiver, photo/video release)
- Conditional clauses (interpreter requirement clause for JP guests, performance rider for Ito Sora, NDA for industry guests)
- Payment terms (honorarium amount, travel reimbursement cap)

**Acceptance Criteria:**
- [ ] 12 contract records with status varying across temporal states
- [ ] Pre-event shows a realistic mix of signed/sent/draft states
- [ ] During-event shows nearly all signed
- [ ] Conditional clauses applied correctly per guest type

---

### 8. Canvas Walkthrough Narrative

**Purpose:** Define the canvas view content that explains how the system was built using the ontology.

**Detail:**

The canvas walkthrough is a guided tour of the system's architecture, presented in terms that AB non-technical staff can understand. It is NOT a developer documentation page. It answers: "How does this system know what a Guest is, what information to track, and what to do when things change?"

**Walkthrough structure (5 stops):**

**Stop 1: "What We Track" (Concepts)**

Visual: System graph showing all concepts as nodes -- Guest, Staff, Schedule Event, Venue, Transport Booking, Prep Item, Contract, Pairing.

Narrative: "Everything the platform manages is defined as a concept. A Guest is a concept. A Transport Booking is a concept. Each concept has its own set of information fields, its own status flow, and its own rules. Adding a new type of thing to track -- like a Vendor or a Badge -- means defining a new concept, not writing new code."

**Stop 2: "What We Know About Each" (Properties)**

Visual: Click on the Guest node to expand its properties -- name, type, status, country, company, dietary, hotel, etc.

Narrative: "Each concept has properties -- the specific pieces of information we track. For a Guest, that's their name, what type of guest they are, their dietary restrictions, their hotel, their contract status. For a Transport Booking, it's the pickup location, the driver, the flight number. These properties are configured, not coded -- we can add a new field to any concept without touching the software."

**Stop 3: "How Things Connect" (Relationships)**

Visual: Edges appear between nodes -- Guest-to-Pairing, Pairing-to-Staff, Guest-to-Transport Booking, Schedule Event-to-Venue, Guest-to-Prep Item.

Narrative: "Concepts are connected by relationships. A Guest is paired with a Liaison. A Schedule Event happens at a Venue. A Transport Booking is for a Guest. These connections mean that when you look at a Guest's page, you see their assigned liaison, their schedule, their transport bookings, and their prep items -- all linked automatically."

**Stop 4: "What Happens Automatically" (Workflows)**

Visual: Workflow overlay appears. A highlighted path shows: Guest status changes to `confirmed` -- automatically creates prep items, generates contract, notifies liaison.

Narrative: "When a Guest is confirmed, the system automatically creates their prep checklist, generates their contract, and notifies their assigned liaison. These are workflows -- automatic actions triggered by changes. When a flight is delayed, the driver gets notified. When all prep items are complete, the director sees a green checkmark. No one has to remember to do these things manually."

**Stop 5: "Who Sees What" (Permissions)**

Visual: RBAC overlay appears. Different colored halos around nodes show which roles can see which concepts and fields.

Narrative: "Not everyone sees everything. A Liaison sees their assigned guests' details and schedule. A Director sees all guests in their department. A Volunteer sees the schedule and their shift assignments but not contract details or guest phone numbers. The system enforces these rules automatically -- every screen, every export, every search result respects who you are."

**Non-technical language rules:**
- Say "concept" not "ontology_concepts table"
- Say "property" or "field" not "JSONB column"
- Say "connection" or "link" not "foreign key relationship"
- Say "workflow" or "automation" not "domain event subscriber"
- Say "permission" or "access level" not "RBAC data scope filter"
- Say "the system" not "the engine" or "the API"

**Canvas rendering:**
- Force-directed or dagre layout (not a raw grid)
- Smooth animations when expanding nodes or toggling overlays
- Each "stop" can be navigated with Previous/Next buttons or by clicking nodes
- A progress indicator shows which stop the user is on (1/5, 2/5, etc.)

**Acceptance Criteria:**
- [ ] Canvas walkthrough has 5 clearly defined stops
- [ ] Each stop has a visual element (graph, expanded node, overlay) and a narrative text
- [ ] Language is non-technical throughout -- no database jargon, no API references
- [ ] Canvas uses proper layout algorithm (force-directed or dagre), not raw grid
- [ ] Navigation between stops is smooth (Previous/Next or click)
- [ ] Target audience (AB staff: directors, coordinators, liaisons) can understand every sentence

---

### 9. Department and Organization Data

**Purpose:** Define the organizational structure seeded in the demo.

**Detail:**

**Departments:**

| Department | Key | Director | Staff Count | Description |
|------------|-----|----------|-------------|-------------|
| Guest Relations | `guest_relations` | Hana Ito | 8 (director + 2 coordinators + 6 liaisons/interpreters) | Guest logistics, contracts, transport, prep |
| Programming | `programming` | Ryan Cooper | 5 (director + 1 coordinator + 3 volunteers) | Panels, events, schedule |
| Operations | `operations` | Mei Zhang | 5 (director + 1 coordinator + 3 volunteers) | Venue setup, equipment, logistics |
| Exhibits | `exhibits` | (not staffed in demo) | 2 (1 coordinator) | Dealer room, artist alley -- minimal in demo |

**Companies and agencies:**

| Company | Type | Country | Used In |
|---------|------|---------|---------|
| Aoni Production | Talent agency | JP | Yamamoto Keiko's agency |
| I'm Enterprise | Talent agency | JP | Suzuki Rina's agency |
| Shueisha | Publisher | JP | Tanaka Hiroshi's publisher |
| Bones Inc. | Animation studio | JP | Nakamura Yuto's studio |
| MAPPA | Animation studio | JP | Watanabe Akira's studio |
| Lantis | Music label | JP | Ito Sora's label |
| FUNimation | Licensor/dubbing | NA | Emily Rodriguez's employer |
| Crunchyroll | Streaming platform | NA | James Park's employer |
| Elite Transportation LLC | Transport vendor | NA | Airport pickups, inter-venue |
| Nihon Travel Co. | Transport vendor | NA | JP guest pickups (bilingual drivers) |
| Boston Car Service | Transport vendor | NA | NA guest pickups |

**Convention metadata:**

```
Convention: Anime Boston 2026
Venue: Hynes Convention Center, Boston, MA
Dates: May 22-24, 2026 (Fri-Sun)
Hotels: Sheraton Boston, Marriott Copley Place
Expected Attendance: 27,000
```

**Acceptance Criteria:**
- [ ] 4 departments seeded with directors and staff counts
- [ ] Companies are real, recognizable anime industry names
- [ ] Transport vendors are fictional but realistic Boston-area companies
- [ ] Convention metadata (dates, venue, attendance) is consistent across all seed data

---

### 10. Data Consistency Rules

**Purpose:** Define the cross-reference integrity rules that all seed data must satisfy.

**Detail:**

Every seed data record must pass the following consistency checks:

**Forward references (A refers to B, B must exist):**
- Every `guest_id` in a transport booking must match a seeded guest
- Every `guest_id` in a prep item must match a seeded guest
- Every `guest_id` in a pairing must match a seeded guest
- Every `staff_id` in a pairing must match a seeded staff member
- Every `venue_id` in a schedule event must match a seeded venue
- Every `guest_id` in a schedule event's guest list must match a seeded guest

**Backward references (if A exists, B should reference it):**
- Every guest should have at least 1 pairing (liaison assigned)
- Every JP guest should have an interpreter pairing
- Every guest with status `travel_arranged` or later should have at least 1 transport booking
- Every guest should have prep items

**Temporal consistency:**
- A guest cannot be `attending` in during-event if they were `draft` in pre-event (they must have progressed through `invited` and `confirmed` first -- but the pre-event snapshot may show them at `invited` if the progression happened between snapshots)
- A transport booking cannot be `dropped_off` in during-event if the guest is not yet `arrived` or `attending`
- Prep items marked complete in pre-event must still be complete in during-event and post-event (no regression)
- Staff assigned in pre-event must still be assigned in during-event (assignments do not disappear)
- Contract signed in pre-event must still be signed in during-event and post-event

**Name consistency:**
- A guest's name must be identical across all three temporal states
- A staff member's name must be identical across all temporal states
- A driver's name in during-event must match the same driver's name in post-event for the same booking

**Acceptance Criteria:**
- [ ] All forward references resolve (zero orphan IDs)
- [ ] All backward references present (no guests without pairings or prep items)
- [ ] Temporal progression is monotonic (no status regression, no assignment disappearance)
- [ ] Name strings are identical across temporal states for the same entity
- [ ] Automated consistency check script exists and passes against seed data

---

### 11. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Guest data completeness | Data validation | All 12 guests have all required properties populated | Zero null required fields |
| Staff assignment coverage | Data validation | Every guest has a liaison; every JP guest has an interpreter | Zero unassigned guests |
| Transport driver visibility | Data validation | Pre-event: driver_name is null/"TBD"; during/post: driver_name populated | Strict temporal rule enforced |
| Schedule consistency | Data validation | Every event has a venue, time, and at least one guest or staff | Zero incomplete events |
| Prep item progression | Data validation | Pre < during < post completion percentages | Monotonic increase per guest |
| Contract progression | Data validation | Pre: mixed states; during: nearly all signed; post: all completed | Correct state distribution |
| Forward reference integrity | Automated | All foreign key references resolve to existing records | Zero orphan references |
| Backward reference integrity | Automated | All guests have pairings, prep items, and transport bookings | Zero missing backward refs |
| Temporal consistency | Automated | No status regression across pre → during → post | Zero regressions |
| Name authenticity | Manual review | Japanese names in family-first order; no placeholders | Human review passes |
| Canvas narrative clarity | Manual review | Non-technical person reads all 5 stops and understands | Target audience comprehension |
| Canvas layout quality | Visual | Force-directed/dagre layout renders cleanly | No overlapping nodes, readable labels |
| Venue accuracy | Manual review | Venue names match Hynes Convention Center | All venues recognizable |
| Company accuracy | Manual review | Companies are real anime industry names | All companies recognizable to AB staff |

**Coverage target:** 100% on data validation tests (automated). Manual review for narrative quality and authenticity (requires human judgment from someone familiar with anime convention operations).

**TDD approach for seed data scripts:**
1. Write consistency check tests first (forward refs, backward refs, temporal rules)
2. Write seed data SQL/JSON
3. Run checks -- they must pass
4. Iterate until zero violations
