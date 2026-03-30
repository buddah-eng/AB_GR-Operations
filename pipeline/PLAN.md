# Contract Verification Pipeline — Implementation Plan

## Context

Anime Boston Guest Relations needs a local pipeline to verify guest contracts, validate itineraries/checklists, create Google Calendar events, assign liaisons/interpreters, and flag large group events (GR all-hands). This runs on a local PC accessible via Dispatch (remote from phone). The existing `AB_GR-Operations` codebase is a reference fork only — this pipeline is standalone.

**This year (2026):** Contracts come from unstructured PDFs/docs on a shared drive. User downloads them to a local folder. The pipeline parses these raw files (PDF/Word extraction) into structured data → SQLite → runs verification → outputs JSON. No manual extraction step — the pipeline handles parsing.

**Future years:** Google Sheets becomes the input interface so other GR staff/management can enter data directly in a machine-parsable format. The pipeline reads from Sheets instead of local JSON.

Convention: Anime Boston 2026, April 3–5, Hynes Convention Center, Boston MA.

---

## Prerequisites (assume bare machine)

Before any code, the implementation must:

1. Check for and install if missing: `node` (v20+), `npm`
2. Run `npm install` in `pipeline/`
3. Create `.env` from `.env.example` with placeholder values
4. Initialize the SQLite database via migration script
5. Create `credentials/` directory with `.gitkeep` (Google API creds go here later)

---

## Directory Structure

```
pipeline/
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
│
├── inbox/                            # Drop zone: raw files downloaded from shared drive
│   ├── contracts/                    # Raw contract PDFs/Word docs
│   ├── itineraries/                  # Raw itinerary docs
│   ├── staff/                        # Staff rosters, availability sheets
│   └── other/                        # Any other supporting docs
│
├── contracts/                        # Parsed structured JSON (pipeline writes these)
│   ├── _template.json                # Reference template showing the schema
│   ├── _group-events.json            # GR all-hands, opening ceremony, dept meetings
│   └── guests/                       # One file per guest (e.g. tanaka-yuki.json)
│
├── src/
│   ├── cli.ts                        # Main CLI entry point (Dispatch runs this)
│   │
│   ├── parse/
│   │   ├── pdf-extract.ts            # Extract text from PDF contracts
│   │   ├── docx-extract.ts           # Extract text from Word docs
│   │   ├── contract-parser.ts        # Parse extracted text → structured contract JSON
│   │   ├── itinerary-parser.ts       # Parse itinerary docs → schedule events
│   │   ├── staff-parser.ts           # Parse staff rosters → staff records
│   │   └── parser-utils.ts           # Shared parsing helpers (date normalization, etc.)
│   │
│   ├── db/
│   │   ├── connection.ts             # SQLite connection (better-sqlite3)
│   │   ├── schema.ts                 # CREATE TABLE statements, indexes
│   │   └── seed.ts                   # Load contract JSONs into SQLite
│   │
│   ├── verify/
│   │   ├── engine.ts                 # Orchestrates all verification checks
│   │   ├── appearance-check.ts       # Panels, autographs, photo ops vs contract min/max
│   │   ├── time-check.ts             # Hours/day, required days, blackout windows
│   │   ├── named-event-check.ts      # Required named events exist in schedule
│   │   ├── travel-check.ts           # Travel bookings match contract terms
│   │   ├── accommodation-check.ts    # Hotel bookings match contract terms
│   │   ├── checklist-check.ts        # Prep items progressing, not blocked/overdue
│   │   ├── staff-check.ts            # Liaison + interpreter assigned where required
│   │   └── types.ts                  # VerificationResult, CheckStatus, etc.
│   │
│   ├── calendar/
│   │   ├── client.ts                 # Google Calendar API wrapper
│   │   ├── event-builder.ts          # Schedule data → Calendar event payloads
│   │   └── sync.ts                   # Create/update calendar events, track IDs
│   │
│   ├── assign/
│   │   ├── liaison.ts                # Assign primary + backup liaison per guest
│   │   ├── interpreter.ts            # Assign interpreters for JP/flagged guests
│   │   └── types.ts                  # Assignment types
│   │
│   ├── events/
│   │   └── group-events.ts           # GR all-hands, large group event flagging
│   │
│   ├── export/
│   │   ├── json-writer.ts            # Write verification reports + data as JSON
│   │   └── sheets-bridge.ts          # Google Sheets read/write (future years)
│   │
│   └── util/
│       ├── config.ts                 # Load .env + convention constants
│       └── logger.ts                 # Timestamped logging to stdout + file
│
├── data/
│   ├── output/                       # Pipeline JSON output lands here
│   │   ├── verification/             # Per-guest verification reports
│   │   ├── calendar/                 # Calendar event manifests
│   │   ├── assignments/              # Liaison/interpreter assignment sheets
│   │   └── group-events/             # Large group event summaries
│   └── logs/                         # Run logs
│
└── credentials/                      # Google API creds (gitignored)
    └── .gitkeep
```

---

## SQLite Schema

### Core Tables

```sql
-- Guests
CREATE TABLE guests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK(type IN ('JP','NA','Industry')),
  company       TEXT,
  department    TEXT,
  status        TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Confirmed','Invited','Pending','Cancelled')),
  interpreter_required INTEGER NOT NULL DEFAULT 0,
  special_handling TEXT,
  notes         TEXT,
  contract_file TEXT,            -- path to source JSON
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contract obligations (one row per obligation type per guest)
CREATE TABLE obligations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  category      TEXT NOT NULL,  -- 'appearance','time','named_event','travel','accommodation'
  obligation_type TEXT NOT NULL, -- 'panels','autographs','max_hours_per_day','opening_ceremony', etc.
  min_value     REAL,            -- min count or min hours
  max_value     REAL,            -- max count or max hours
  required_date TEXT,            -- ISO date if date-specific
  required_time TEXT,            -- HH:MM if time-specific
  text_value    TEXT,            -- for string obligations (flight_class, hotel_name, etc.)
  json_extra    TEXT,            -- overflow JSON for complex terms
  UNIQUE(guest_id, category, obligation_type, required_date)
);

-- Schedule events
CREATE TABLE schedule_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id      INTEGER REFERENCES guests(id),  -- NULL for group events
  activity      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  date          TEXT NOT NULL,
  start_time    TEXT,
  end_time      TEXT,
  venue         TEXT,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'Scheduled',
  is_group_event INTEGER NOT NULL DEFAULT 0,
  calendar_event_id TEXT,        -- Google Calendar ID once synced
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Travel
CREATE TABLE travel (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  description   TEXT NOT NULL,
  travel_type   TEXT NOT NULL,
  carrier       TEXT,
  route         TEXT,
  departure_date TEXT,
  arrival_date  TEXT,
  departure_time TEXT,
  arrival_time  TEXT,
  flight_class  TEXT,
  confirmation  TEXT,
  status        TEXT NOT NULL DEFAULT 'Pending',
  notes         TEXT
);

-- Accommodations
CREATE TABLE accommodations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  hotel         TEXT NOT NULL,
  room_type     TEXT,
  check_in      TEXT,
  check_out     TEXT,
  confirmation  TEXT,
  special_requests TEXT,
  status        TEXT NOT NULL DEFAULT 'Pending'
);

-- Staff
CREATE TABLE staff (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT,
  role          TEXT NOT NULL,
  department    TEXT,
  phone         TEXT,
  languages     TEXT,            -- JSON array
  availability  TEXT,            -- JSON: per-day availability
  max_guests    INTEGER DEFAULT 2
);

-- Assignments (staff ↔ guest pairings)
CREATE TABLE assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  staff_id      INTEGER REFERENCES staff(id),  -- NULL = unfilled
  role          TEXT NOT NULL,   -- 'Primary Liaison','Backup Liaison','Primary Interpreter','Backup Interpreter','Security Escort'
  designation   TEXT NOT NULL,   -- 'primary','backup'
  status        TEXT NOT NULL DEFAULT 'Unfilled',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Checklist items
CREATE TABLE checklist_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  item          TEXT NOT NULL,
  owner_role    TEXT NOT NULL,
  due_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'Not Started',
  completed_at  TEXT,
  notes         TEXT
);

-- Group events (GR all-hands, opening ceremony, etc.)
CREATE TABLE group_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  date          TEXT NOT NULL,
  start_time    TEXT,
  end_time      TEXT,
  venue         TEXT,
  description   TEXT,
  attendee_scope TEXT NOT NULL DEFAULT 'all',  -- 'all','jp','na','industry','staff','custom'
  custom_attendees TEXT,          -- JSON array of guest/staff names if scope=custom
  calendar_event_id TEXT,
  is_mandatory  INTEGER NOT NULL DEFAULT 1
);

-- Verification runs
CREATE TABLE verification_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at        TEXT NOT NULL DEFAULT (datetime('now')),
  run_type      TEXT NOT NULL,   -- 'full','contracts','itinerary','checklist','staff'
  total_guests  INTEGER NOT NULL,
  passed        INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  warnings      INTEGER NOT NULL DEFAULT 0,
  summary       TEXT             -- JSON summary
);

-- Per-guest verification results
CREATE TABLE verification_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL REFERENCES verification_runs(id),
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  check_name    TEXT NOT NULL,   -- 'appearance_panels','time_max_hours','named_opening_ceremony', etc.
  status        TEXT NOT NULL,   -- 'pass','fail','warning','skip'
  expected      TEXT,
  actual        TEXT,
  message       TEXT,
  details       TEXT             -- JSON for complex results
);

CREATE INDEX idx_obligations_guest ON obligations(guest_id);
CREATE INDEX idx_schedule_guest ON schedule_events(guest_id);
CREATE INDEX idx_schedule_date ON schedule_events(date);
CREATE INDEX idx_travel_guest ON travel(guest_id);
CREATE INDEX idx_accommodations_guest ON accommodations(guest_id);
CREATE INDEX idx_assignments_guest ON assignments(guest_id);
CREATE INDEX idx_assignments_staff ON assignments(staff_id);
CREATE INDEX idx_checklist_guest ON checklist_items(guest_id);
CREATE INDEX idx_vresults_run ON verification_results(run_id);
CREATE INDEX idx_vresults_guest ON verification_results(guest_id);
```

---

## Contract JSON Schema

Each guest gets a file in `contracts/guests/`. Example: `contracts/guests/tanaka-yuki.json`

```json
{
  "guest": {
    "name": "Tanaka Yuki",
    "type": "JP",
    "company": "Agency ABC",
    "department": "Anime",
    "status": "Confirmed",
    "interpreter_required": true,
    "special_handling": "Needs green room access between events"
  },
  "obligations": {
    "appearances": {
      "panels":             { "min": 2, "max": 4 },
      "autograph_sessions": { "min": 1 },
      "photo_ops":          { "min": 1 },
      "concerts":           {},
      "meet_and_greets":    {},
      "appearances":        {}
    },
    "time": {
      "max_hours_per_day": 8,
      "required_days": ["2026-04-03", "2026-04-04", "2026-04-05"],
      "blackout_times": [
        { "date": "2026-04-04", "start": "12:00", "end": "13:00", "reason": "Lunch break" }
      ]
    },
    "required_events": [
      { "name": "Opening Ceremony", "date": "2026-04-03", "mandatory": true },
      { "name": "GR All-Hands", "date": "2026-04-03", "time": "09:00", "mandatory": true }
    ]
  },
  "terms": {
    "travel": {
      "flight_class": "business",
      "arrival_window": { "earliest": "2026-04-02", "latest": "2026-04-03" },
      "departure_window": { "earliest": "2026-04-05", "latest": "2026-04-06" }
    },
    "accommodations": {
      "room_type": "suite",
      "hotel": "Sheraton Boston",
      "check_in": "2026-04-02",
      "check_out": "2026-04-06"
    }
  },
  "schedule": [
    { "activity": "Tanaka Yuki Panel: Voice Acting in Anime", "event_type": "Panel", "date": "2026-04-03", "start_time": "14:00", "end_time": "15:00", "venue": "Panel Room A", "status": "Confirmed" },
    { "activity": "Tanaka Yuki Autograph Session", "event_type": "Autograph", "date": "2026-04-04", "start_time": "10:00", "end_time": "12:00", "venue": "Autograph Area", "status": "Confirmed" }
  ],
  "travel": [
    { "description": "NRT → BOS", "travel_type": "Flight", "carrier": "JAL", "route": "NRT → JFK → BOS", "departure_date": "2026-04-01", "arrival_date": "2026-04-02", "flight_class": "business", "status": "Confirmed" }
  ],
  "accommodations": [
    { "hotel": "Sheraton Boston", "room_type": "Suite", "check_in": "2026-04-02", "check_out": "2026-04-06", "status": "Confirmed" }
  ],
  "checklist": [
    { "item": "Confirm travel itinerary", "owner_role": "Director", "due_date": "2026-02-15", "status": "Complete" },
    { "item": "Interpreter briefing packet", "owner_role": "Interpreter", "due_date": "2026-03-15", "status": "In Progress" },
    { "item": "Panel topic confirmation", "owner_role": "Liaison", "due_date": "2026-02-28", "status": "Not Started" },
    { "item": "Dietary preferences collected", "owner_role": "Liaison", "due_date": "2026-02-20", "status": "Complete" }
  ]
}
```

Group events file: `contracts/_group-events.json`

```json
{
  "group_events": [
    {
      "name": "GR All-Hands",
      "event_type": "Staff",
      "date": "2026-04-03",
      "start_time": "09:00",
      "end_time": "10:00",
      "venue": "Meeting Room 1",
      "description": "Full GR department meeting - all staff required",
      "attendee_scope": "staff",
      "is_mandatory": true
    },
    {
      "name": "Opening Ceremony",
      "event_type": "Ceremony",
      "date": "2026-04-03",
      "start_time": "18:00",
      "end_time": "19:30",
      "venue": "Main Hall",
      "description": "Convention opening - all guests attend",
      "attendee_scope": "all",
      "is_mandatory": true
    },
    {
      "name": "Guest Welcome Dinner",
      "event_type": "Meal",
      "date": "2026-04-02",
      "start_time": "19:00",
      "end_time": "21:00",
      "venue": "Hotel Restaurant",
      "description": "Pre-convention dinner for all guests and liaisons",
      "attendee_scope": "all",
      "is_mandatory": false
    }
  ]
}
```

---

## Verification Engine

### Check Categories (run in order)

1. **Appearance checks** (`appearance-check.ts`)
   - For each appearance type in contract obligations, count matching `schedule_events` by `event_type`
   - Compare against `min`/`max` — FAIL if below min, WARNING if above max
   - Skip types with no min/max defined

2. **Time checks** (`time-check.ts`)
   - Sum scheduled hours per day (from `start_time`/`end_time`) — FAIL if exceeds `max_hours_per_day`
   - Check `required_days` have at least one event — FAIL if a required day is empty
   - Check no events overlap with `blackout_times` — FAIL if conflict

3. **Named event checks** (`named-event-check.ts`)
   - For each `required_events` entry, find matching `schedule_events` or `group_events` by name + date
   - FAIL if mandatory event not found in schedule

4. **Travel checks** (`travel-check.ts`)
   - Verify travel record exists — FAIL if missing
   - Check `flight_class` matches contract term — WARNING if mismatch
   - Check arrival date within `arrival_window` — FAIL if outside
   - Check departure date within `departure_window` — FAIL if outside

5. **Accommodation checks** (`accommodation-check.ts`)
   - Verify accommodation record exists — FAIL if missing
   - Check hotel matches — WARNING if different
   - Check room type matches — WARNING if downgrade
   - Check dates cover convention + buffer — FAIL if check-in after convention start or check-out before convention end

6. **Checklist checks** (`checklist-check.ts`)
   - Flag items with status "Blocked" — WARNING
   - Flag items past `due_date` and not "Complete" — FAIL
   - Flag items still "Not Started" within 2 weeks of convention — WARNING
   - Compute overall completion percentage

7. **Staff assignment checks** (`staff-check.ts`)
   - Verify Primary Liaison assigned — FAIL if missing
   - Verify Backup Liaison assigned — WARNING if missing
   - If `interpreter_required`: verify Primary Interpreter assigned — FAIL if missing
   - Check for assignment conflicts (same staff double-booked)

### Result Types

```typescript
type CheckStatus = 'pass' | 'fail' | 'warning' | 'skip';

interface CheckResult {
  check_name: string;
  status: CheckStatus;
  expected: string;
  actual: string;
  message: string;
  details?: Record<string, unknown>;
}

interface GuestVerification {
  guest_name: string;
  guest_type: string;
  overall_status: 'pass' | 'fail' | 'warning';
  checks: CheckResult[];
  pass_count: number;
  fail_count: number;
  warning_count: number;
}

interface VerificationReport {
  run_id: number;
  run_at: string;
  convention: string;
  total_guests: number;
  summary: { passed: number; failed: number; warnings: number };
  guests: GuestVerification[];
}
```

---

## Post-Verification: Calendar Sync

Only runs for guests whose verification `overall_status` is `pass` or `warning` (not `fail`).

1. **Build events** — Map each `schedule_events` row to a Google Calendar event payload:
   - Title: `[Guest Name] - Activity` (or just activity name for group events)
   - Time: date + start_time/end_time in `America/New_York`
   - Location: venue
   - Description: event description + guest type + any special handling
   - Attendees: assigned liaison + interpreter emails

2. **Group events** — Create one calendar event per group event, add all relevant attendees based on `attendee_scope`

3. **Sync** — Use Google Calendar API:
   - If `calendar_event_id` is NULL → create event, store ID back in SQLite
   - If `calendar_event_id` exists → update event
   - Track all synced events in `data/output/calendar/` as JSON manifest

---

## Post-Verification: Assignments

### Liaison Assignment (`assign/liaison.ts`)
1. Query unassigned guests (no Primary Liaison in `assignments`)
2. Query available staff with role = 'Liaison' or 'Department Head'
3. Score candidates by:
   - Department match (same department as guest → higher score)
   - Current load (fewer assigned guests → higher score)
   - Availability on guest's required days
4. Assign top candidate as Primary Liaison, second as Backup Liaison
5. Insert into `assignments` table, output to JSON

### Interpreter Assignment (`assign/interpreter.ts`)
1. Query guests where `interpreter_required = 1` and no Primary Interpreter assigned
2. Query staff with role = 'Interpreter'
3. Score by:
   - Language match (JP guests need Japanese speakers)
   - Current load
   - Availability
4. Assign Primary + Backup Interpreter
5. Insert into `assignments`, output to JSON

---

## Large Group Events (`events/group-events.ts`)

1. Load `_group-events.json` into `group_events` table
2. For each group event:
   - Determine attendee list based on `attendee_scope`
   - Cross-reference with individual guest schedules for conflicts
   - Flag any guest missing a mandatory group event from their schedule
   - Add group event to each relevant guest's verification as a named event check
3. Output summary: which guests attend which group events, conflicts, gaps

---

## CLI Entry Points

Single CLI entry point `src/cli.ts` with subcommands:

```
npm run pipeline -- init          # Initialize DB, create dirs, validate env
npm run pipeline -- parse         # Parse raw files from inbox/ → structured JSON in contracts/
npm run pipeline -- parse --type contracts    # Parse only contracts
npm run pipeline -- parse --type itineraries  # Parse only itineraries
npm run pipeline -- parse --type staff        # Parse only staff rosters
npm run pipeline -- import        # Load all contract JSONs into SQLite
npm run pipeline -- verify        # Run full verification, output reports
npm run pipeline -- verify --guest "Tanaka Yuki"   # Single guest
npm run pipeline -- calendar      # Sync verified events to Google Calendar
npm run pipeline -- calendar --dry-run             # Preview without creating
npm run pipeline -- assign        # Run liaison + interpreter assignment
npm run pipeline -- assign --role liaison          # Liaisons only
npm run pipeline -- assign --role interpreter      # Interpreters only
npm run pipeline -- events        # Process group events
npm run pipeline -- full          # Run everything: parse → import → verify → assign → events → calendar
npm run pipeline -- full --dry-run
npm run pipeline -- status        # Show current state: guest count, verification summary, assignment gaps
npm run pipeline -- export        # Re-export all data as JSON to data/output/
npm run pipeline -- export --sheets                # Push to Google Sheets (future)
```

**Dispatch workflow**: User SSHs in via Dispatch → `cd pipeline` → `npm run pipeline -- <command>`

---

## Google Sheets Bridge (future years)

### Output (this year)
- `sheets-bridge.ts` exports a function that writes JSON output to a Google Sheet
- Sheet structure mirrors the contract JSON schema: one sheet per section (Guests, Obligations, Schedule, Travel, Accommodations, Checklist, Assignments, Verification Results)
- Each sheet has headers matching the JSON field names
- This creates the template that future staff will fill in directly

### Input (future years)
- `sheets-bridge.ts` also has a read function that pulls from Google Sheets → JSON → SQLite
- Staff enter data in the same sheet structure
- Pipeline validates on import (Zod schemas catch malformed data)
- Replaces the manual JSON file creation step

---

## JSON Output Structure

```
data/output/
├── verification/
│   ├── report-2026-03-15T10-30-00.json    # Full verification report
│   └── guests/
│       ├── tanaka-yuki.json                # Per-guest detail
│       └── smith-john.json
├── calendar/
│   ├── manifest.json                       # All calendar events + IDs
│   └── events/
│       ├── guest-events.json               # Per-guest calendar events
│       └── group-events.json               # Group calendar events
├── assignments/
│   ├── liaisons.json                       # All liaison assignments
│   ├── interpreters.json                   # All interpreter assignments
│   └── gaps.json                           # Unfilled assignment slots
└── group-events/
    ├── summary.json                        # All group events + attendee lists
    └── conflicts.json                      # Scheduling conflicts with group events
```

---

## Data Flow

```
[Shared Drive: PDFs, Word docs, spreadsheets]
        │ (user downloads to inbox/)
        ▼
[inbox/contracts/]  [inbox/itineraries/]  [inbox/staff/]
        │
        ▼  npm run pipeline -- parse
[contracts/guests/*.json]  +  [contracts/_group-events.json]
  (pipeline extracts + structures the data)
        │
        ▼  npm run pipeline -- import
[SQLite: guests, obligations, schedule_events, travel, accommodations, checklist_items, group_events]
        │
        ▼  npm run pipeline -- verify
[SQLite: verification_runs, verification_results]  →  [data/output/verification/*.json]
        │
        ├──▶  npm run pipeline -- assign
        │     [SQLite: assignments]  →  [data/output/assignments/*.json]
        │
        ├──▶  npm run pipeline -- events
        │     [SQLite: group_events cross-ref]  →  [data/output/group-events/*.json]
        │
        └──▶  npm run pipeline -- calendar
              [Google Calendar API]  →  [data/output/calendar/*.json]
              (only for verified guests)

        ▼  npm run pipeline -- export --sheets (future)
[Google Sheets]  ◄──►  [JSON output]
```

---

## Implementation Order

1. **Scaffolding**: `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, directory structure, `inbox/` folders
2. **Config + Logger**: `src/util/config.ts`, `src/util/logger.ts`
3. **Database**: `src/db/connection.ts`, `src/db/schema.ts` (all CREATE TABLEs)
4. **Contract schema validation**: Zod schemas for the contract JSON format
5. **Document parsers**: `src/parse/pdf-extract.ts`, `docx-extract.ts`, `contract-parser.ts`, `itinerary-parser.ts`, `staff-parser.ts` — reads raw files from `inbox/`, writes structured JSON to `contracts/`
6. **Import/Seed**: `src/db/seed.ts` — read `contracts/guests/*.json`, validate with Zod, insert into SQLite
7. **Verification engine**: `src/verify/types.ts`, then each check file, then `src/verify/engine.ts` orchestrator
8. **Group events**: `src/events/group-events.ts`
9. **Assignment logic**: `src/assign/types.ts`, `src/assign/liaison.ts`, `src/assign/interpreter.ts`
10. **JSON export**: `src/export/json-writer.ts`
11. **CLI**: `src/cli.ts` wiring all subcommands
12. **Calendar client**: `src/calendar/client.ts`, `src/calendar/event-builder.ts`, `src/calendar/sync.ts`
13. **Sheets bridge**: `src/export/sheets-bridge.ts` (output-only for now)
14. **Contract templates**: `_template.json`, sample guest file, `_group-events.json`

---

## Key Dependencies

```json
{
  "better-sqlite3": "^11.0.0",
  "googleapis": "^140.0.0",
  "zod": "^3.23.0",
  "dotenv": "^16.4.0",
  "chalk": "^5.3.0",
  "minimist": "^1.2.8",
  "pdf-parse": "^1.1.1",
  "mammoth": "^1.8.0"
}
```

- `pdf-parse` — extracts text content from PDF files
- `mammoth` — extracts text/structure from Word (.docx) files

Dev: `typescript`, `tsx`, `@types/better-sqlite3`, `@types/node`, `@types/minimist`

---

## Verification Checklist

After implementation, verify by:

1. `npm run pipeline -- init` — DB created, tables exist, inbox/ dirs created
2. Place raw contract PDFs/docs in `inbox/contracts/`
3. `npm run pipeline -- parse` — structured JSON created in `contracts/guests/`
4. `npm run pipeline -- import` — data loads without errors
5. `npm run pipeline -- verify` — verification report generated in `data/output/verification/`
6. `npm run pipeline -- assign` — assignments generated in `data/output/assignments/`
7. `npm run pipeline -- events` — group event summary in `data/output/group-events/`
8. `npm run pipeline -- status` — prints summary to terminal
9. `npm run pipeline -- full --dry-run` — full pipeline without calendar writes
10. `npm run pipeline -- calendar --dry-run` — previews calendar events (requires Google creds for real run)
