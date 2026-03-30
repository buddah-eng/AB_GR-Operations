# Contract Verification Pipeline -- Implementation Plan

## Context

Anime Boston Guest Relations needs a local pipeline to verify guest contracts, validate itineraries/checklists, create Google Calendar events, suggest liaison/interpreter assignments, and flag large group events (GR all-hands). This runs on a local PC accessible via Dispatch (remote from phone). The existing `AB_GR-Operations` codebase is a reference fork only -- this pipeline is standalone.

**This year (2026):** Contracts come from unstructured PDFs/docs on a shared drive. User downloads them to a local folder. Claude Code subagents extract structured data from raw files (PDF/Word) into candidate JSON. User reviews and edits the candidate JSON, then imports approved files into SQLite for verification and downstream processing.

**Future years:** Google Sheets becomes the input interface so other GR staff/management can enter data directly in a machine-parsable format. The pipeline reads from Sheets instead of local JSON.

Convention: Anime Boston 2026, April 3-5, Hynes Convention Center, Boston MA.

---

## Implementation Phases

### Phase 1 -- Core Pipeline (ship first)
- Scaffolding (project structure, config, logger)
- SQLite schema + source document registry
- Raw text extraction (pdf-parse, mammoth)
- Claude Code subagent extraction to candidate JSON
- Manual review/edit step (candidate -> approved)
- Import approved JSON into SQLite
- Verification engine (all checks)
- JSON report export

### Phase 2 -- Group Events + Operational Awareness
- Group event processing + conflict detection
- Status summaries (terminal dashboard)
- Assignment suggestions (not automatic commitments)

### Phase 3 -- Calendar Integration
- Calendar dry-run (preview without creating)
- Calendar real sync (only after guest has `approved` status)

### Phase 4 -- Sheets Bridge (future years)
- Google Sheets export (creates the template)
- Google Sheets import (replaces manual JSON entry)

---

## Prerequisites (assume bare machine)

Before any code, the implementation must:

1. Check for and install if missing: `node` (v20+), `npm`
2. Run `npm install` in `pipeline/`
3. Create `.env` from `.env.example` with placeholder values
4. Initialize the SQLite database via migration script
5. Create `credentials/` directory with `.gitkeep` (Google API creds go here in Phase 3)

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
├── contracts/                        # Structured JSON (Claude extracts, user reviews)
│   ├── _template.json                # Reference template showing the schema
│   ├── _group-events.json            # GR all-hands, opening ceremony, dept meetings
│   ├── candidates/                   # Claude-generated JSON (pending review)
│   └── approved/                     # User-reviewed JSON (ready for import)
│
├── src/
│   ├── cli.ts                        # Main CLI entry point (Dispatch runs this)
│   │
│   ├── parse/
│   │   ├── extract.ts                # Read raw file bytes (PDF via pdf-parse, DOCX via mammoth)
│   │   ├── prompts.ts                # Extraction prompts per doc type + target schema
│   │   ├── validate.ts               # Zod-validate extracted JSON, report errors
│   │   └── orchestrator.ts           # Walk inbox/, extract text, write to staging for Claude Code
│   │
│   ├── db/
│   │   ├── connection.ts             # SQLite connection (better-sqlite3)
│   │   ├── schema.ts                 # CREATE TABLE statements, indexes
│   │   ├── registry.ts               # Source document registry (track file -> guest mapping)
│   │   └── seed.ts                   # Load approved JSONs into SQLite
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
│   ├── calendar/                     # Phase 3
│   │   ├── client.ts                 # Google Calendar API wrapper
│   │   ├── event-builder.ts          # Schedule data -> Calendar event payloads
│   │   └── sync.ts                   # Create/update calendar events, track IDs
│   │
│   ├── assign/
│   │   ├── suggest.ts                # Generate assignment suggestions with scoring rationale
│   │   └── types.ts                  # Assignment types
│   │
│   ├── events/
│   │   └── group-events.ts           # GR all-hands, large group event flagging
│   │
│   ├── export/
│   │   ├── json-writer.ts            # Write verification reports + data as JSON
│   │   └── sheets-bridge.ts          # Google Sheets read/write (Phase 4)
│   │
│   └── util/
│       ├── config.ts                 # Load .env + convention constants
│       └── logger.ts                 # Timestamped logging to stdout + file
│
├── data/
│   ├── staging/                      # Extracted text + prompt files for Claude Code
│   ├── output/                       # Pipeline JSON output lands here
│   │   ├── verification/             # Per-guest verification reports
│   │   ├── calendar/                 # Calendar event manifests (Phase 3)
│   │   ├── assignments/              # Assignment suggestions (Phase 2)
│   │   └── group-events/             # Large group event summaries (Phase 2)
│   └── logs/                         # Run logs
│
└── credentials/                      # Google API creds (gitignored, Phase 3)
    └── .gitkeep
```

---

## SQLite Schema

### Core Tables

```sql
-- Source document registry (tracks every raw file through the pipeline)
CREATE TABLE source_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL,
  filepath      TEXT NOT NULL UNIQUE,
  doc_type      TEXT NOT NULL CHECK(doc_type IN ('contract','itinerary','staff','other')),
  file_hash     TEXT,                -- SHA-256 for change detection on re-parse
  status        TEXT NOT NULL DEFAULT 'registered'
                CHECK(status IN ('registered','extracted','candidate','approved','imported','failed')),
  guest_id      INTEGER REFERENCES guests(id),  -- linked after import
  candidate_path TEXT,               -- path to candidate JSON
  approved_path  TEXT,               -- path to approved JSON
  extracted_at  TEXT,
  approved_at   TEXT,
  imported_at   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Guests
CREATE TABLE guests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  type          TEXT NOT NULL CHECK(type IN ('JP','NA','Industry')),
  company       TEXT,
  department    TEXT,
  status        TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Confirmed','Invited','Pending','Cancelled')),
  approval_status TEXT NOT NULL DEFAULT 'pending'
                CHECK(approval_status IN ('pending','approved','needs_review')),
  interpreter_required INTEGER NOT NULL DEFAULT 0,
  special_handling TEXT,
  notes         TEXT,
  contract_file TEXT,            -- path to approved JSON
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
  calendar_event_id TEXT,        -- Google Calendar ID once synced (Phase 3)
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

-- Assignment suggestions (staff <-> guest pairings, pending human decision)
CREATE TABLE assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  staff_id      INTEGER REFERENCES staff(id),  -- NULL = unfilled
  role          TEXT NOT NULL,   -- 'Primary Liaison','Backup Liaison','Primary Interpreter','Backup Interpreter','Security Escort'
  designation   TEXT NOT NULL,   -- 'primary','backup'
  status        TEXT NOT NULL DEFAULT 'Suggested'
                CHECK(status IN ('Suggested','Accepted','Rejected','Unfilled')),
  score         REAL,            -- scoring rationale for the suggestion
  score_details TEXT,            -- JSON: breakdown of scoring factors
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

CREATE INDEX idx_source_docs_status ON source_documents(status);
CREATE INDEX idx_source_docs_guest ON source_documents(guest_id);
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

Each guest gets a file in `contracts/`. Example: `contracts/approved/tanaka-yuki.json`

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
    { "description": "NRT -> BOS", "travel_type": "Flight", "carrier": "JAL", "route": "NRT -> JFK -> BOS", "departure_date": "2026-04-01", "arrival_date": "2026-04-02", "flight_class": "business", "status": "Confirmed" }
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

## Claude Code Subagent Parsing

The parsing layer uses Claude Code subagents to extract structured data from raw documents. Instead of calling the Anthropic API programmatically, the pipeline prepares extraction jobs and Claude Code processes them directly in the terminal.

### Flow

1. **Register source documents** (`registry.ts`): User drops files in `inbox/`. Running `pipeline -- register` walks `inbox/`, hashes each file, and inserts a row in `source_documents` with status `registered`.

2. **Extract raw text** (`extract.ts`): `pdf-parse` for PDFs, `mammoth` for .docx. Writes plain text to `data/staging/<filename>.txt`. Updates registry status to `extracted`.

3. **Generate extraction prompts** (`prompts.ts`, `orchestrator.ts`): The pipeline writes a prompt file to `data/staging/<filename>.prompt.md` containing:
   - The extracted text
   - The target JSON schema (from `_template.json`)
   - Field-level mapping instructions (e.g. "map 'autograph signing' to event_type: 'Autograph'")
   - Convention context (dates, venue, timezone)
   - Output path for the candidate JSON

4. **Claude Code extraction**: User runs Claude Code in the `pipeline/` directory. Claude Code reads the prompt files from `data/staging/`, generates structured JSON, and writes candidates to `contracts/candidates/<guest-slug>.json`. This can be done interactively (one file at a time with review) or in batch via `claude --print` subprocesses.

5. **Validate candidate** (`validate.ts`): `pipeline -- validate` runs Zod validation on each candidate JSON. Files that fail get a `<guest-slug>._errors.json` sidecar with the specific Zod issues so the user (or Claude Code) can fix and re-validate.

6. **Manual review + approve**: User inspects `contracts/candidates/`, edits as needed, then runs `pipeline -- approve <guest-slug>` (or `--all` for candidates that pass validation) to move files to `contracts/approved/`. Registry status updates to `approved`.

7. **Import**: `pipeline -- import` loads only `approved/` files into SQLite. Registry status updates to `imported`.

### Prompt strategy

Prompts live in `src/parse/prompts.ts` and are written to disk per file:

- **Contract prompt**: Extracts guest info, obligations (appearance counts, time limits, required events), travel/accommodation terms, and checklist items. Normalizes dates to ISO 8601, maps appearance types to the enum, flags ambiguous terms in a `_notes` field.
- **Itinerary prompt**: Extracts schedule events with activity, type, date, time, venue. Handles multi-day grids, free-form agendas, and tabular formats.
- **Staff roster prompt**: Extracts name, role, department, languages, availability. Handles spreadsheet-style exports and free-form lists.

All prompts embed the Zod schema as a JSON Schema block so Claude knows the exact output shape.

---

## Verification Engine

### Check Categories (run in order)

1. **Appearance checks** (`appearance-check.ts`)
   - For each appearance type in contract obligations, count matching `schedule_events` by `event_type`
   - Compare against `min`/`max` -- FAIL if below min, WARNING if above max
   - Skip types with no min/max defined

2. **Time checks** (`time-check.ts`)
   - Sum scheduled hours per day (from `start_time`/`end_time`) -- FAIL if exceeds `max_hours_per_day`
   - Check `required_days` have at least one event -- FAIL if a required day is empty
   - Check no events overlap with `blackout_times` -- FAIL if conflict

3. **Named event checks** (`named-event-check.ts`)
   - For each `required_events` entry, find matching `schedule_events` or `group_events` by name + date
   - FAIL if mandatory event not found in schedule

4. **Travel checks** (`travel-check.ts`)
   - Verify travel record exists -- FAIL if missing
   - Check `flight_class` matches contract term -- WARNING if mismatch
   - Check arrival date within `arrival_window` -- FAIL if outside
   - Check departure date within `departure_window` -- FAIL if outside

5. **Accommodation checks** (`accommodation-check.ts`)
   - Verify accommodation record exists -- FAIL if missing
   - Check hotel matches -- WARNING if different
   - Check room type matches -- WARNING if downgrade
   - Check dates cover convention + buffer -- FAIL if check-in after convention start or check-out before convention end

6. **Checklist checks** (`checklist-check.ts`)
   - Flag items with status "Blocked" -- WARNING
   - Flag items past `due_date` and not "Complete" -- FAIL
   - Flag items still "Not Started" within 2 weeks of convention -- WARNING
   - Compute overall completion percentage

7. **Staff assignment checks** (`staff-check.ts`)
   - Verify Primary Liaison assigned (Accepted status) -- FAIL if missing
   - Verify Backup Liaison assigned -- WARNING if missing
   - If `interpreter_required`: verify Primary Interpreter assigned (Accepted) -- FAIL if missing
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

## Assignment Suggestions (Phase 2)

Assignments are **suggestions**, not automatic commitments. The pipeline scores candidates and outputs ranked recommendations. A human accepts or rejects each one.

### Liaison Suggestions (`assign/suggest.ts`)
1. Query guests with no accepted Primary Liaison
2. Query available staff with role = 'Liaison' or 'Department Head'
3. Score candidates by:
   - Department match (same department as guest -> higher score)
   - Current load (fewer assigned guests -> higher score)
   - Availability on guest's required days
4. Output ranked suggestions with score breakdown
5. Insert into `assignments` with status = `Suggested`

### Interpreter Suggestions
1. Query guests where `interpreter_required = 1` and no accepted Primary Interpreter
2. Query staff with role = 'Interpreter'
3. Score by:
   - Language match (JP guests need Japanese speakers)
   - Current load
   - Availability
4. Output ranked suggestions with score breakdown
5. Insert into `assignments` with status = `Suggested`

### Accepting/Rejecting
- `pipeline -- assign --accept <id>` updates status to `Accepted`
- `pipeline -- assign --reject <id>` updates status to `Rejected`
- Only `Accepted` assignments feed into verification checks and calendar sync

---

## Large Group Events (Phase 2) (`events/group-events.ts`)

1. Load `_group-events.json` into `group_events` table
2. For each group event:
   - Determine attendee list based on `attendee_scope`
   - Cross-reference with individual guest schedules for conflicts
   - Flag any guest missing a mandatory group event from their schedule
   - Add group event to each relevant guest's verification as a named event check
3. Output summary: which guests attend which group events, conflicts, gaps

---

## Calendar Sync (Phase 3)

Calendar sync is gated: only runs for guests whose `approval_status` is `approved` AND whose verification `overall_status` is `pass` or `warning` (not `fail`).

### Dry-run first
`pipeline -- calendar --dry-run` previews all events that would be created without touching the API. This is the default until the user explicitly runs a real sync.

### Build events
Map each `schedule_events` row to a Google Calendar event payload:
- Title: `[Guest Name] - Activity` (or just activity name for group events)
- Time: date + start_time/end_time in `America/New_York`
- Location: venue
- Description: event description + guest type + any special handling
- Attendees: accepted liaison + interpreter emails

### Group events
Create one calendar event per group event, add all relevant attendees based on `attendee_scope`.

### Sync
Use Google Calendar API:
- If `calendar_event_id` is NULL -> create event, store ID back in SQLite
- If `calendar_event_id` exists -> update event
- Track all synced events in `data/output/calendar/` as JSON manifest

---

## CLI Entry Points

Single CLI entry point `src/cli.ts` with subcommands:

```
# Phase 1
npm run pipeline -- init                              # Initialize DB, create dirs, validate env
npm run pipeline -- register                          # Register raw files from inbox/ in source_documents
npm run pipeline -- extract                           # Extract raw text from registered files to staging
npm run pipeline -- extract --file "contract.pdf"     # Extract single file
npm run pipeline -- validate                          # Zod-validate all candidate JSONs
npm run pipeline -- validate --file "tanaka-yuki"     # Validate single candidate
npm run pipeline -- approve tanaka-yuki               # Move candidate to approved
npm run pipeline -- approve --all                     # Approve all passing candidates
npm run pipeline -- import                            # Load approved JSONs into SQLite
npm run pipeline -- verify                            # Run full verification, output reports
npm run pipeline -- verify --guest "Tanaka Yuki"      # Single guest
npm run pipeline -- export                            # Re-export all data as JSON to data/output/

# Phase 2
npm run pipeline -- events                            # Process group events
npm run pipeline -- status                            # Terminal dashboard: guests, verification, gaps
npm run pipeline -- assign                            # Generate assignment suggestions
npm run pipeline -- assign --accept <id>              # Accept a suggestion
npm run pipeline -- assign --reject <id>              # Reject a suggestion

# Phase 3
npm run pipeline -- calendar --dry-run                # Preview calendar events
npm run pipeline -- calendar                          # Sync to Google Calendar (approved guests only)

# Phase 4
npm run pipeline -- export --sheets                   # Push to Google Sheets

# Convenience
npm run pipeline -- full --dry-run                    # Run Phase 1 + 2 end-to-end (no calendar writes)
```

**Dispatch workflow**: User SSHs in via Dispatch -> `cd pipeline` -> `npm run pipeline -- <command>`

**Claude Code workflow**: User runs `claude` in `pipeline/` dir. Claude Code reads prompt files from `data/staging/`, generates candidate JSON to `contracts/candidates/`, and the user reviews interactively or approves via CLI.

---

## Data Flow

```
[Shared Drive: PDFs, Word docs, spreadsheets]
        | (user downloads to inbox/)
        v
[inbox/contracts/]  [inbox/itineraries/]  [inbox/staff/]
        |
        v  npm run pipeline -- register
[SQLite: source_documents table tracks each file]
        |
        v  npm run pipeline -- extract
[data/staging/*.txt + *.prompt.md]
  (raw text extracted, prompt files generated)
        |
        v  Claude Code reads prompts, generates structured JSON
[contracts/candidates/*.json]
        |
        v  npm run pipeline -- validate
[Zod checks, _errors.json sidecars for failures]
        |
        v  User reviews, edits, then: npm run pipeline -- approve
[contracts/approved/*.json]
        |
        v  npm run pipeline -- import
[SQLite: guests, obligations, schedule_events, travel,
         accommodations, checklist_items, group_events]
        |
        v  npm run pipeline -- verify
[SQLite: verification_runs, verification_results]
  -> [data/output/verification/*.json]
        |
        |--- npm run pipeline -- assign  (Phase 2)
        |    [suggestions in data/output/assignments/*.json]
        |
        |--- npm run pipeline -- events  (Phase 2)
        |    [data/output/group-events/*.json]
        |
        '--- npm run pipeline -- calendar --dry-run  (Phase 3)
             npm run pipeline -- calendar             (Phase 3, approved only)
             [Google Calendar API] -> [data/output/calendar/*.json]
```

---

## Google Sheets Bridge (Phase 4)

### Output (this year, if time permits)
- `sheets-bridge.ts` exports a function that writes JSON output to a Google Sheet
- Sheet structure mirrors the contract JSON schema: one sheet per section (Guests, Obligations, Schedule, Travel, Accommodations, Checklist, Assignments, Verification Results)
- Each sheet has headers matching the JSON field names
- This creates the template that future staff will fill in directly

### Input (future years)
- `sheets-bridge.ts` also has a read function that pulls from Google Sheets -> JSON -> SQLite
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
├── assignments/                            # Phase 2
│   ├── suggestions.json                    # All suggestions with scores
│   ├── accepted.json                       # Accepted assignments
│   └── gaps.json                           # Unfilled assignment slots
├── group-events/                           # Phase 2
│   ├── summary.json                        # All group events + attendee lists
│   └── conflicts.json                      # Scheduling conflicts
└── calendar/                               # Phase 3
    ├── manifest.json                       # All calendar events + IDs
    └── events/
        ├── guest-events.json
        └── group-events.json
```

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

- `pdf-parse` -- extracts raw text from PDF files (staged for Claude Code extraction)
- `mammoth` -- extracts raw text from Word (.docx) files (staged for Claude Code extraction)

Dev: `typescript`, `tsx`, `@types/better-sqlite3`, `@types/node`, `@types/minimist`

---

## Verification Checklist

After implementation, verify by phase:

### Phase 1
1. `npm run pipeline -- init` -- DB created, tables exist, dirs created
2. Place raw contract PDFs/docs in `inbox/contracts/`
3. `npm run pipeline -- register` -- files appear in `source_documents`
4. `npm run pipeline -- extract` -- text + prompt files in `data/staging/`
5. Claude Code generates candidate JSON from prompt files
6. `npm run pipeline -- validate` -- candidates pass Zod checks
7. `npm run pipeline -- approve --all` -- files move to `contracts/approved/`
8. `npm run pipeline -- import` -- data loads without errors
9. `npm run pipeline -- verify` -- verification report in `data/output/verification/`

### Phase 2
10. `npm run pipeline -- events` -- group event summary in `data/output/group-events/`
11. `npm run pipeline -- status` -- prints summary to terminal
12. `npm run pipeline -- assign` -- suggestions in `data/output/assignments/`
13. `npm run pipeline -- assign --accept <id>` -- assignment accepted

### Phase 3
14. `npm run pipeline -- calendar --dry-run` -- previews calendar events
15. `npm run pipeline -- calendar` -- creates events (requires Google creds)
