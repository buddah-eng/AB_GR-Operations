# Year-over-Year Registry

> Ontology concepts with `is_registry = true` persist across convention years. Regular concepts are scoped to a single year.
> Registry tables (guest_registry, vendor_registry) hold the canonical, cross-year identity. Convention-year domain tables reference them via FK.
> Pre-population pulls last year's data for returning entities. Self-service forms show "last year you had X — still correct?"
> Archive after each convention: domain data goes read-only, registry data gets updated, analytics snapshots are captured.

---

## Overview

A convention operations platform that resets to zero every year loses institutional knowledge. The Year-over-Year (YoY) Registry solves this by separating **persistent identity** (a guest who has attended before, a vendor the organization has worked with) from **convention-year state** (that guest's hotel room for AB 2026, that vendor's booth assignment this year).

The `ontology_concepts` table already has an `is_registry` boolean. When `is_registry = true`, the concept's data lives in a registry table that survives year boundaries. Convention-year domain tables (e.g., `guests`, `vendors`) hold FK references to their registry counterpart, inheriting persistent attributes while adding year-specific data.

This design enables pre-population of returning entities, year-over-year analytics, and a clean archive process that preserves history without polluting the active working set.

---

## 1. Registry Concept

### Purpose

Define which ontology concepts persist across convention years and which are scoped to a single year. This distinction drives data modeling, pre-population, and archive behavior.

### Detail

**Registry concepts** (`is_registry = true`):
- Represent entities whose identity and history span multiple conventions.
- Examples: guests (a person who attends year after year), vendors/dealers (a company the org works with repeatedly).
- Registry data answers: "Has this guest attended before? What do we know about them across all years?"

**Domain concepts** (`is_registry = false`, the default):
- Represent year-specific operational data.
- Examples: hotel room assignments, event schedules, pairings, transport runs.
- Domain data answers: "What is this guest's room for AB 2026? Who is their liaison this year?"

**The distinction is set in the ontology:**
```sql
-- In ontology_concepts (already exists in postgres-schema.md)
is_registry  BOOLEAN NOT NULL DEFAULT false
```

When an admin marks a concept as `is_registry = true` in the ontology builder, the platform:
1. Creates (or recognizes) a `<concept>_registry` table for persistent cross-year data.
2. Adds a `registry_id` FK column to the convention-year domain table.
3. Enables pre-population and YoY analytics features for that concept.

### Acceptance Criteria

- [ ] `is_registry` flag is editable in the ontology web builder
- [ ] Setting `is_registry = true` triggers creation of the corresponding registry table
- [ ] Domain table for a registry concept includes a `registry_id` FK to the registry table
- [ ] Non-registry concepts have no registry table and no `registry_id` column

---

## 2. Data Model

### Purpose

Define the registry tables and their relationship to convention-year domain tables.

### Detail

**guest_registry** — persistent guest records across all convention years:

```sql
CREATE TABLE guest_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  TEXT NOT NULL,
  email           TEXT UNIQUE,
  company         TEXT,
  type            TEXT,                -- 'JP', 'NA', etc.
  department      TEXT,
  dietary         TEXT,
  travel_prefs    JSONB DEFAULT '{}',  -- persistent preferences
  notes           JSONB DEFAULT '{}',  -- cross-year notes from staff
  first_attended  INTEGER,             -- convention year (e.g., 2022)
  last_attended   INTEGER,             -- updated after each convention
  attendance_count INTEGER NOT NULL DEFAULT 0,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guest_registry_email ON guest_registry (email);
CREATE INDEX idx_guest_registry_name ON guest_registry (canonical_name);
CREATE INDEX idx_guest_registry_company ON guest_registry (company);
```

**vendor_registry** — persistent vendor/dealer records across all convention years:

```sql
CREATE TABLE vendor_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    TEXT NOT NULL,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  category        TEXT,               -- 'dealer', 'sponsor', 'exhibitor', etc.
  region          TEXT,
  payment_terms   TEXT,
  notes           JSONB DEFAULT '{}',
  first_attended  INTEGER,
  last_attended   INTEGER,
  attendance_count INTEGER NOT NULL DEFAULT 0,
  properties      JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendor_registry_company ON vendor_registry (company_name);
CREATE INDEX idx_vendor_registry_category ON vendor_registry (category);
```

**Convention-year domain tables reference registry via FK:**

```sql
-- The existing guests table gains a registry_id column
ALTER TABLE guests ADD COLUMN registry_id UUID REFERENCES guest_registry(id);
ALTER TABLE guests ADD COLUMN convention_year INTEGER NOT NULL DEFAULT 2026;

CREATE INDEX idx_guests_registry ON guests (registry_id);
CREATE INDEX idx_guests_year ON guests (convention_year);

-- The existing vendors table (if present) gains the same
ALTER TABLE vendors ADD COLUMN registry_id UUID REFERENCES vendor_registry(id);
ALTER TABLE vendors ADD COLUMN convention_year INTEGER NOT NULL DEFAULT 2026;

CREATE INDEX idx_vendors_registry ON vendors (registry_id);
CREATE INDEX idx_vendors_year ON vendors (convention_year);
```

**Relationship:** One registry record can have many convention-year records (one per year attended). The convention-year record holds year-specific data (room assignment, badge number, booth location) while the registry record holds persistent data (dietary preferences, travel preferences, cross-year notes).

### Acceptance Criteria

- [ ] `guest_registry` and `vendor_registry` tables exist with all specified columns
- [ ] Convention-year domain tables have `registry_id` FK and `convention_year` column
- [ ] FK constraint prevents orphaned convention-year records (registry record must exist)
- [ ] A single registry record can have multiple convention-year records (one per year)
- [ ] Registry tables have GIN indexes on JSONB columns (`properties`, `notes`, `travel_prefs`)

---

## 3. Pre-Population

### Purpose

When creating a new convention year, automatically find and pre-fill data for returning entities so that operators do not re-enter known information and guests can confirm rather than re-type.

### Detail

**Operator workflow (new convention year setup):**
1. Admin creates a new convention year (e.g., AB 2027).
2. System queries `guest_registry WHERE last_attended >= 2025` (configurable lookback window).
3. For each matching registry record, the system creates a draft convention-year record in `guests`:
   - `registry_id` = the registry record's ID
   - `convention_year` = 2027
   - `status` = 'draft'
   - Core fields pre-filled from registry: `name`, `type`, `department`, `company`
   - JSONB `properties` pre-filled from registry's persistent preferences
4. Operator reviews drafts, removes non-returning guests, adds new ones.

**Guest self-service workflow:**
1. Guest receives a pre-registration link.
2. Form loads their pre-populated data from the draft record (which came from the registry).
3. Form shows: "Last year you had: Dietary = Vegetarian, Hotel = Marriott. Is this still correct?"
4. Guest confirms or updates each field.
5. On submit, the convention-year record is updated with confirmed data, and `status` changes from `draft` to `confirmed`.
6. If the guest changed persistent preferences (e.g., dietary), the registry record is also updated.

**Pre-population query:**
```sql
-- Find returning guests for a new convention year
SELECT
  gr.id AS registry_id,
  gr.canonical_name,
  gr.email,
  gr.company,
  gr.type,
  gr.department,
  gr.dietary,
  gr.travel_prefs,
  g_last.properties AS last_year_properties
FROM guest_registry gr
LEFT JOIN guests g_last ON g_last.registry_id = gr.id
  AND g_last.convention_year = (
    SELECT MAX(convention_year) FROM guests WHERE registry_id = gr.id
  )
WHERE gr.last_attended >= :lookback_year
ORDER BY gr.canonical_name;
```

**Conflict resolution:**
- If a guest's email matches an existing registry record, link to it (do not create a duplicate).
- If a guest appears to be new (no email match), create a new registry record on first attendance.
- Fuzzy name matching flags potential duplicates for operator review.

### Acceptance Criteria

- [ ] New convention year setup generates draft records for all guests in the lookback window
- [ ] Draft records have `status = 'draft'` and correct `registry_id` FK
- [ ] Pre-filled fields match the registry record's current data
- [ ] Self-service form displays "last year you had X" for each pre-populated field
- [ ] Guest updates to persistent preferences propagate back to the registry record
- [ ] Duplicate detection flags matches by email and fuzzy name match

---

## 4. Analytics Queries

### Purpose

Enable year-over-year analytics: attendance trends, return rates, growth metrics, and cohort analysis.

### Detail

**Guests who attended 3+ years:**
```sql
SELECT
  gr.canonical_name,
  gr.company,
  gr.attendance_count,
  gr.first_attended,
  gr.last_attended
FROM guest_registry gr
WHERE gr.attendance_count >= 3
ORDER BY gr.attendance_count DESC;
```

**Return rate by department:**
```sql
SELECT
  gr.department,
  COUNT(DISTINCT gr.id) AS total_guests,
  COUNT(DISTINCT CASE WHEN gr.attendance_count > 1 THEN gr.id END) AS returning_guests,
  ROUND(
    COUNT(DISTINCT CASE WHEN gr.attendance_count > 1 THEN gr.id END)::NUMERIC
    / NULLIF(COUNT(DISTINCT gr.id), 0) * 100, 1
  ) AS return_rate_pct
FROM guest_registry gr
GROUP BY gr.department
ORDER BY return_rate_pct DESC;
```

**New vs returning vendors for a given year:**
```sql
SELECT
  CASE WHEN vr.attendance_count = 1 THEN 'New' ELSE 'Returning' END AS vendor_status,
  COUNT(*) AS vendor_count
FROM vendors v
JOIN vendor_registry vr ON v.registry_id = vr.id
WHERE v.convention_year = 2026
GROUP BY vendor_status;
```

**Year-over-year attendance growth:**
```sql
SELECT
  g.convention_year,
  COUNT(*) AS total_guests,
  COUNT(*) - LAG(COUNT(*)) OVER (ORDER BY g.convention_year) AS growth,
  ROUND(
    (COUNT(*)::NUMERIC - LAG(COUNT(*)) OVER (ORDER BY g.convention_year))
    / NULLIF(LAG(COUNT(*)) OVER (ORDER BY g.convention_year), 0) * 100, 1
  ) AS growth_pct
FROM guests g
WHERE g.archived = false
GROUP BY g.convention_year
ORDER BY g.convention_year;
```

**Cohort analysis (retention by first-attended year):**
```sql
SELECT
  gr.first_attended AS cohort_year,
  g.convention_year AS attended_year,
  COUNT(DISTINCT gr.id) AS guests_in_cohort
FROM guest_registry gr
JOIN guests g ON g.registry_id = gr.id
WHERE g.archived = false
GROUP BY gr.first_attended, g.convention_year
ORDER BY cohort_year, attended_year;
```

These queries power dashboards built on the platform's page/widget config system. Materialized views are created for expensive aggregations and refreshed nightly.

### Acceptance Criteria

- [ ] "3+ year attendees" query returns correct results validated against manual count
- [ ] Return rate calculation handles departments with zero guests (no division by zero)
- [ ] New vs returning vendor split matches the sum of all vendors for that year
- [ ] YoY growth query handles the first year gracefully (NULL growth, not error)
- [ ] Cohort analysis returns one row per cohort-year/attended-year combination
- [ ] Materialized views refresh nightly and are used by dashboard widgets

---

## 5. Archive Strategy

### Purpose

After each convention ends, transition domain data to read-only, update registry records with the latest information, and capture analytics snapshots for historical reporting.

### Detail

**Archive process (runs after convention close, triggered by admin):**

**Step 1: Update registry records.**
```sql
-- Update guest_registry with latest info from this year's records
UPDATE guest_registry gr
SET
  last_attended = g.convention_year,
  attendance_count = gr.attendance_count + 1,
  dietary = COALESCE(g.properties->>'dietary', gr.dietary),
  travel_prefs = gr.travel_prefs || COALESCE((g.properties->'travel_prefs')::JSONB, '{}'::JSONB),
  updated_at = now()
FROM guests g
WHERE g.registry_id = gr.id
  AND g.convention_year = :current_year
  AND g.archived = false;
```

**Step 2: Capture analytics snapshots.**
- Materialize all analytics queries (section 4) into snapshot tables: `analytics_snapshot_YYYY`.
- These snapshots are immutable — they represent the state at convention close.
```sql
CREATE TABLE analytics_snapshot_2026 AS
SELECT
  'attendance_by_department' AS metric,
  department,
  COUNT(*) AS value
FROM guests
WHERE convention_year = 2026 AND archived = false
GROUP BY department;
-- (Repeated for each analytics query)
```

**Step 3: Archive domain data.**
```sql
-- Mark all convention-year records as archived
UPDATE guests SET archived = true, updated_at = now()
WHERE convention_year = :current_year;

UPDATE vendors SET archived = true, updated_at = now()
WHERE convention_year = :current_year;

-- Convention-year ontology configs can also be versioned/deprecated
-- but the registry ontology (is_registry = true) remains active
```

**Step 4: Verify and lock.**
- Run integrity checks: every archived guest record has a valid `registry_id`, every registry record's `attendance_count` matches the count of linked convention-year records.
- Revoke write permissions on archived convention-year data (Postgres row-level security or application-level enforcement).
- Archived data remains queryable for historical reports but cannot be modified.

**Timeline:**
| Action | Trigger | Duration |
|---|---|---|
| Update registry | Admin initiates post-convention close | Minutes |
| Capture analytics snapshots | Automated after registry update | Minutes |
| Archive domain records | Automated after snapshots | Minutes |
| Integrity verification | Automated after archive | Minutes |
| Revoke write access | Automated after verification | Immediate |

### Acceptance Criteria

- [ ] Registry `last_attended` and `attendance_count` are correct after archive
- [ ] Persistent preferences in the registry reflect the latest convention-year values
- [ ] Analytics snapshot tables are created and contain accurate data
- [ ] Archived domain records have `archived = true` and cannot be modified via the API
- [ ] Archived data remains queryable (read-only) for historical reports
- [ ] Integrity check confirms FK consistency and count accuracy

---

## 6. Test Plan

### 6.1 Registry Lookup

**Purpose:** Confirm that returning entities are correctly identified via the registry.

**Detail:**
1. Create a `guest_registry` record for "Tanaka Ichiro" with `last_attended = 2025`, `attendance_count = 2`.
2. Create convention-year `guests` records for 2024 and 2025, both linked via `registry_id`.
3. Query registry for guests with `last_attended >= 2025`.
4. Verify "Tanaka Ichiro" appears with correct `attendance_count`.
5. Query by email to confirm unique lookup works.

**Acceptance Criteria:**
- [ ] Registry lookup by `last_attended` returns the correct set of returning guests
- [ ] Email-based lookup returns exactly one record (unique constraint enforced)
- [ ] `attendance_count` matches the number of linked convention-year records

### 6.2 Pre-Population Accuracy

**Purpose:** Confirm that pre-populated convention-year records contain the correct data from the registry.

**Detail:**
1. Registry record exists for "Tanaka Ichiro" with `dietary = 'Halal'`, `company = 'TechCorp'`, `travel_prefs = {"hotel_pref": "Marriott"}`.
2. Initiate new convention year setup (AB 2027).
3. Verify a draft `guests` record is created with:
   - `registry_id` pointing to the registry record
   - `convention_year = 2027`
   - `status = 'draft'`
   - `properties` containing dietary, hotel preference
4. Load the self-service form for this guest.
5. Verify form shows "Last year: Dietary = Halal, Hotel = Marriott".
6. Guest changes dietary to "Vegan" and submits.
7. Verify convention-year record updated and registry `dietary` updated to "Vegan".

**Acceptance Criteria:**
- [ ] Draft record fields match registry record fields
- [ ] Self-service form displays pre-populated values with confirmation prompts
- [ ] Guest updates propagate to both the convention-year record and the registry
- [ ] Fields the guest did not change remain unchanged in the registry

### 6.3 Archive Process

**Purpose:** Confirm the full post-convention archive workflow.

**Detail:**
1. Create 10 guest records for convention year 2026, all linked to registry records.
2. Run the archive process.
3. Verify: all 10 `guests` records have `archived = true`.
4. Verify: each linked `guest_registry` record has `last_attended = 2026` and `attendance_count` incremented by 1.
5. Verify: analytics snapshot table exists with correct aggregations.
6. Attempt to UPDATE an archived guest record via the API; verify it is rejected.
7. Attempt to SELECT archived guest records; verify they are returned (read-only access works).

**Acceptance Criteria:**
- [ ] All convention-year records are archived
- [ ] Registry records are updated with correct `last_attended` and `attendance_count`
- [ ] Analytics snapshot tables exist and contain accurate data
- [ ] Write attempts on archived records are rejected
- [ ] Read access to archived records works

### 6.4 Analytics Queries Return Correct Data

**Purpose:** Confirm that all analytics queries produce accurate results.

**Detail:**
1. Seed data: 5 registry records with varying `attendance_count` (1 through 5), across 3 departments.
2. Seed convention-year records for 2024, 2025, and 2026 as appropriate.
3. Run "3+ year attendees" query; verify exactly 3 records returned (counts 3, 4, 5).
4. Run "return rate by department" query; verify percentages match manual calculation.
5. Run "new vs returning vendors" query; verify counts sum to total vendors for the year.
6. Run "YoY growth" query; verify growth numbers match (year2_count - year1_count).
7. Run "cohort analysis" query; verify each cohort-year/attended-year pair has the correct count.

**Acceptance Criteria:**
- [ ] Each query returns the expected row count and values
- [ ] Edge cases handled: single-year data (no growth calc), zero-guest departments, new vendors only
- [ ] Queries execute in < 1 second on datasets up to 10,000 registry records
- [ ] Results match a manually computed spreadsheet for the test dataset
