/**
 * GR-Ops Demo Seed Script
 *
 * Seeds the Neon Postgres database with:
 * 1. Ontology concepts, properties, relationships, events, constraints
 * 2. RBAC roles, permissions, data scopes, screen access
 * 3. Form configs, view configs, page configs, workflow configs
 * 4. Operational data: venues, staff, guests, schedule events,
 *    pairings, prep items, transport bookings, guest-schedule links
 *
 * Usage:
 *   npx tsx src/db/seed-demo.ts
 *
 * Requires DATABASE_URL in environment (or reads from ../web/.env.local).
 */

import { Pool } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// 1. Load DATABASE_URL
// ---------------------------------------------------------------------------

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Try to read from web/.env.local
  const envPath = resolve(__dirname, "../../../web/.env.local");
  try {
    const envContent = readFileSync(envPath, "utf-8");
    const match = envContent.match(/^DATABASE_URL="([^"]+)"/m);
    if (match) {
      return match[1];
    }
  } catch {
    // fall through
  }

  throw new Error(
    "DATABASE_URL not found. Set it in environment or ensure web/.env.local exists."
  );
}

// ---------------------------------------------------------------------------
// 2. Seed sections
// ---------------------------------------------------------------------------

interface SeedResult {
  section: string;
  rowsAffected: number;
}

const results: SeedResult[] = [];

async function runSection(
  pool: Pool,
  section: string,
  sql: string
): Promise<void> {
  try {
    const res = await pool.query(sql);
    const rows =
      typeof res.rowCount === "number"
        ? res.rowCount
        : Array.isArray(res)
          ? res.reduce((sum, r) => sum + (r.rowCount ?? 0), 0)
          : 0;
    results.push({ section, rowsAffected: rows });
    console.log(`  [OK] ${section} (${rows} rows)`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [ERR] ${section}: ${msg}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 3. SQL statements
// ---------------------------------------------------------------------------

// --- 3a. Ontology Concepts ---
const ONTOLOGY_CONCEPTS = `
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES
  ('guest',    'Guest',     'Guests',     'pi pi-users',       'Invited convention guests -- VAs, musicians, artists, industry reps'),
  ('staff',    'Staff',     'Staff',      'pi pi-id-card',     'Convention staff -- liaisons, interpreters, coordinators, volunteers'),
  ('schedule', 'Event',     'Schedule',   'pi pi-calendar',    'Scheduled convention activities -- panels, signings, photo ops, meals'),
  ('venue',    'Venue',     'Venues',     'pi pi-map-marker',  'Convention venues -- meeting rooms, halls, outdoor spaces'),
  ('pairing',  'Pairing',   'Pairings',   'pi pi-link',        'Guest-to-staff assignment with a role (liaison, interpreter, escort)'),
  ('prep',     'Prep Item', 'Prep Tracker','pi pi-check-square','Pre-convention tasks -- hotel, contract, dietary, travel confirmation'),
  ('transport','Transport',  'Transport',  'pi pi-car',         'Guest transport bookings -- airport, hotel, inter-venue'),
  ('contract', 'Contract',  'Contracts',  'pi pi-file',        'Guest contracts -- appearance agreements, NDAs, payment terms')
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO ontology_concepts (key, name, plural_name, icon, description, is_config)
VALUES
  ('convention','Convention','Conventions','pi pi-globe','Convention metadata -- dates, venue, year, branding', true)
ON CONFLICT (key, version) DO NOTHING;

INSERT INTO ontology_concepts (key, name, plural_name, icon, description, is_registry)
VALUES
  ('guest_registry','Guest Registry','Guest Registry','pi pi-book','Cross-year guest history -- tracks attendance, preferences, notes across conventions', true)
ON CONFLICT (key, version) DO NOTHING;
`;

// --- 3b. Ontology Properties ---
// Uses WHERE NOT EXISTS because the UNIQUE constraint includes nullable owner_department
// and NULL != NULL in SQL, so ON CONFLICT won't match for re-runs.
const ONTOLOGY_PROPERTIES = `
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column, options, description)
SELECT v.concept_key, v.key, v.label, v.type, v.required, v.sort_order, v.pg_col, v.options::jsonb, v.descr
FROM (VALUES
  -- Guest properties
  ('guest','name','Name','text',true,10,'name',NULL,NULL),
  ('guest','type','Type','select',true,20,'type','[{"value":"EN","label":"English-speaking"},{"value":"JP","label":"Japanese-speaking"},{"value":"Industry","label":"Industry"},{"value":"Musical","label":"Musical Act"},{"value":"Artist","label":"Artist"}]',NULL),
  ('guest','department','Department','select',true,30,'department','[{"value":"Anime","label":"Anime"},{"value":"Gaming","label":"Gaming"},{"value":"Music","label":"Music"},{"value":"Cosplay","label":"Cosplay"},{"value":"Panels","label":"Panels"},{"value":"Artists","label":"Artists"},{"value":"Industry","label":"Industry"}]',NULL),
  ('guest','status','Status','status',true,40,'status','[{"value":"draft","label":"Draft","color":"gray"},{"value":"Wishlist","label":"Wishlist","color":"blue"},{"value":"Contacted","label":"Contacted","color":"yellow"},{"value":"Confirmed","label":"Confirmed","color":"green"},{"value":"Declined","label":"Declined","color":"red"},{"value":"Cancelled","label":"Cancelled","color":"red"}]',NULL),
  ('guest','company','Company / Agency','text',false,50,'company',NULL,NULL),
  ('guest','interpreterRequired','Interpreter Required','checkbox',false,60,NULL,NULL,'Whether this guest needs a Japanese interpreter'),
  ('guest','email','Email','email',false,70,NULL,NULL,NULL),
  ('guest','phone','Phone','phone',false,80,NULL,NULL,NULL),
  ('guest','bio','Bio','rich_text',false,90,NULL,NULL,NULL),
  ('guest','specialHandling','Special Handling','multi_select',false,100,NULL,'[{"value":"VIP","label":"VIP Treatment"},{"value":"Green Room","label":"Green Room Access"},{"value":"Security","label":"Extra Security"},{"value":"Dietary","label":"Special Dietary Needs"}]',NULL),
  -- Staff properties
  ('staff','name','Name','text',true,10,'name',NULL,NULL),
  ('staff','email','Email','email',false,20,'email',NULL,NULL),
  ('staff','role','Role','select',true,30,NULL,'[{"value":"Main Liaison","label":"Main Liaison"},{"value":"Backup Liaison","label":"Backup Liaison"},{"value":"Interpreter","label":"Interpreter"},{"value":"Security Escort","label":"Security Escort"},{"value":"Department Head","label":"Department Head"},{"value":"Volunteer","label":"Volunteer"}]',NULL),
  ('staff','department','Department','select',true,40,'department','[{"value":"Anime","label":"Anime"},{"value":"Gaming","label":"Gaming"},{"value":"Music","label":"Music"},{"value":"Cosplay","label":"Cosplay"},{"value":"Panels","label":"Panels"},{"value":"Artists","label":"Artists"},{"value":"Industry","label":"Industry"}]',NULL),
  ('staff','phone','Phone','phone',false,50,'phone',NULL,NULL),
  ('staff','lineId','LINE ID','text',false,60,NULL,NULL,NULL),
  ('staff','availability','Availability','text',false,70,NULL,NULL,NULL),
  ('staff','reportsTo','Reports To','text',false,80,NULL,NULL,NULL),
  -- Schedule Event properties
  ('schedule','name','Activity','text',true,10,'name',NULL,NULL),
  ('schedule','eventType','Event Type','select',true,20,'event_type','[{"value":"Panel","label":"Panel"},{"value":"Autograph Session","label":"Autograph Session"},{"value":"Photo Op","label":"Photo Op"},{"value":"Meal","label":"Meal"},{"value":"Photoshoot","label":"Photoshoot"},{"value":"Interview","label":"Interview"},{"value":"Rehearsal","label":"Rehearsal"},{"value":"Meet & Greet","label":"Meet & Greet"},{"value":"Other","label":"Other"}]',NULL),
  ('schedule','startTime','Start Time','datetime',true,30,'start_time',NULL,NULL),
  ('schedule','endTime','End Time','datetime',true,40,'end_time',NULL,NULL),
  ('schedule','venue','Venue','relation',false,50,NULL,NULL,NULL),
  ('schedule','guestId','Guest','relation',false,60,NULL,NULL,NULL),
  ('schedule','status','Status','status',true,70,'status','[{"value":"draft","label":"Draft","color":"gray"},{"value":"confirmed","label":"Confirmed","color":"green"},{"value":"cancelled","label":"Cancelled","color":"red"}]',NULL),
  ('schedule','description','Description','rich_text',false,80,NULL,NULL,NULL),
  -- Prep Item properties
  ('prep','name','Task','text',true,10,'name',NULL,NULL),
  ('prep','guestId','Guest','relation',true,20,NULL,NULL,NULL),
  ('prep','status','Status','status',true,30,'status','[{"value":"incomplete","label":"Incomplete","color":"red"},{"value":"in_progress","label":"In Progress","color":"yellow"},{"value":"complete","label":"Complete","color":"green"},{"value":"na","label":"N/A","color":"gray"}]',NULL),
  ('prep','dueDate','Due Date','date',false,40,'due_date',NULL,NULL),
  ('prep','owner','Owner','text',false,50,NULL,NULL,NULL)
) AS v(concept_key, key, label, type, required, sort_order, pg_col, options, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM ontology_properties op
  WHERE op.concept_key = v.concept_key AND op.key = v.key AND op.version = 1
);
`;

// --- 3c. Ontology Relationships ---
const ONTOLOGY_RELATIONSHIPS = `
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES
  ('guest', 'pairing',        'pairings',   'Staff Pairings',   'has-many', 'guest'),
  ('staff', 'pairing',        'pairings',   'Guest Assignments','has-many', 'staff'),
  ('guest', 'schedule',       'schedule',   'Schedule',         'has-many', 'guests'),
  ('guest', 'prep',           'prepItems',  'Prep Items',       'has-many', 'guest'),
  ('guest', 'transport',      'transport',  'Transport',        'has-many', 'guest'),
  ('guest', 'contract',       'contracts',  'Contracts',        'has-many', 'guest'),
  ('schedule', 'venue',       'venue',      'Venue',            'has-one',  'events'),
  ('venue', 'schedule',       'events',     'Events',           'has-many', 'venue'),
  ('guest', 'guest_registry', 'registry',   'Registry Entry',   'has-one',  'appearances')
ON CONFLICT (source_concept_key, key, version) DO NOTHING;
`;

// --- 3d. Ontology Events ---
const ONTOLOGY_EVENTS = `
INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type)
VALUES
  ('guest',    'created',  'guest.created',    'on_create'),
  ('guest',    'updated',  'guest.updated',    'on_update'),
  ('guest',    'deleted',  'guest.deleted',    'on_delete'),
  ('schedule', 'created',  'schedule.created', 'on_create'),
  ('schedule', 'updated',  'schedule.updated', 'on_update')
ON CONFLICT (concept_key, event_key, version) DO NOTHING;

INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type, changed_fields)
VALUES
  ('guest',     'status_changed',  'guest.status_changed',     'on_field_change', ARRAY['status']),
  ('prep',      'completed',       'prep.completed',           'on_field_change', ARRAY['status']),
  ('transport', 'status_changed',  'transport.status_changed', 'on_field_change', ARRAY['status'])
ON CONFLICT (concept_key, event_key, version) DO NOTHING;
`;

// --- 3e. Ontology Constraints ---
const ONTOLOGY_CONSTRAINTS = `
INSERT INTO ontology_constraints (concept_key, name, condition, defaults, required_fields, description)
VALUES (
  'guest',
  'JP Guest',
  '{"type": "field", "field": "type", "operator": "eq", "value": "JP"}',
  '{"interpreterRequired": true}',
  ARRAY['interpreterRequired'],
  'Japanese-speaking guests automatically require an interpreter'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;

INSERT INTO ontology_constraints (concept_key, name, condition, defaults, description)
VALUES (
  'guest',
  'VIP Guest',
  '{"type": "field", "field": "specialHandling", "operator": "contains", "value": "VIP"}',
  '{"greenRoomRequired": true}',
  'VIP guests automatically get green room access'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;
`;

// --- 3f. RBAC Roles ---
const RBAC_ROLES = `
INSERT INTO roles (key, name, description, priority, is_operational) VALUES
  ('director',        'Director',        'Full access to all concepts and data',          10, true),
  ('department_head', 'Department Head', 'Full access within their department',            20, true),
  ('coordinator',     'Coordinator',     'Cross-department coordination, read-mostly',     30, true),
  ('liaison',         'Liaison',         'Manages assigned guests and their activities',   40, true),
  ('interpreter',     'Interpreter',     'Assigned to JP guests, limited write access',    45, true),
  ('volunteer',       'Volunteer',       'Task execution, minimal data access',            50, true),
  ('viewer',          'Viewer',          'Read-only access to non-sensitive data',        100, false)
ON CONFLICT (key) DO NOTHING;
`;

// --- 3g. Demo User ---
const DEMO_USER = `
INSERT INTO users (email, name, role_key, department)
VALUES ('director@animeboston.org', 'Convention Director', 'director', NULL)
ON CONFLICT (email) DO NOTHING;
`;

// --- 3h. Permissions ---
const PERMISSIONS = `
-- Director: full access to all concepts
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES
  ('director', 'guest', true, true, true, true,
    ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling'],
    ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling']),
  ('director', 'staff', true, true, true, true,
    ARRAY['name','email','role','department','phone','lineId','availability','reportsTo'],
    ARRAY['name','email','role','department','phone','lineId','availability','reportsTo']),
  ('director', 'schedule', true, true, true, true,
    ARRAY['name','eventType','startTime','endTime','venue','guestId','status','description'],
    ARRAY['name','eventType','startTime','endTime','venue','guestId','status','description']),
  ('director', 'prep', true, true, true, true,
    ARRAY['name','guestId','status','dueDate','owner'],
    ARRAY['name','guestId','status','dueDate','owner'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('director', 'pairing', true, true, true, true,
    ARRAY['guestId','staffId','role']),
  ('director', 'transport', true, true, true, true,
    ARRAY['guestId','bookingType','status','pickupLocation','dropoffLocation','scheduledTime','driverName','flightNumber']),
  ('director', 'venue', true, true, true, true,
    ARRAY['name','type','capacity','floor','building','equipment','notes']),
  ('director', 'contract', true, true, true, true,
    ARRAY['guestId','type','status','signedDate','terms'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

-- Department Head
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES
  ('department_head', 'guest', true, true, true, false,
    ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling'],
    ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling']),
  ('department_head', 'staff', true, true, true, false,
    ARRAY['name','email','role','department','phone','lineId','availability','reportsTo'],
    ARRAY['name','email','role','department','phone','lineId','availability','reportsTo'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('department_head', 'schedule', true, true, true, false,
    ARRAY['name','eventType','startTime','endTime','venue','guestId','status','description']),
  ('department_head', 'prep', true, true, true, false,
    ARRAY['name','guestId','status','dueDate','owner']),
  ('department_head', 'pairing', true, true, true, false,
    ARRAY['guestId','staffId','role']),
  ('department_head', 'transport', true, true, true, false,
    ARRAY['guestId','bookingType','status','pickupLocation','dropoffLocation','scheduledTime','driverName','flightNumber'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

-- Liaison
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES
  ('liaison', 'guest', true, false, true, false,
    ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling'],
    ARRAY['status','bio','specialHandling'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('liaison', 'staff', true, false, false, false,
    ARRAY['name','email','role','department','phone']),
  ('liaison', 'schedule', true, true, true, false,
    ARRAY['name','eventType','startTime','endTime','venue','guestId','status','description']),
  ('liaison', 'prep', true, false, true, false,
    ARRAY['name','guestId','status','dueDate','owner']),
  ('liaison', 'pairing', true, false, false, false,
    ARRAY['guestId','staffId','role']),
  ('liaison', 'transport', true, true, true, false,
    ARRAY['guestId','bookingType','status','pickupLocation','dropoffLocation','scheduledTime','flightNumber'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

-- Volunteer
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('volunteer', 'guest', true, false, false, false,
    ARRAY['name','type','department','status']),
  ('volunteer', 'schedule', true, false, false, false,
    ARRAY['name','eventType','startTime','endTime','venue','status'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES
  ('volunteer', 'prep', true, false, true, false,
    ARRAY['name','guestId','status','dueDate','owner'],
    ARRAY['status'])
ON CONFLICT (role_key, concept_key) DO NOTHING;

-- Viewer
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES
  ('viewer', 'guest', true, false, false, false,
    ARRAY['name','type','department','status','company']),
  ('viewer', 'schedule', true, false, false, false,
    ARRAY['name','eventType','startTime','endTime','venue','status']),
  ('viewer', 'staff', true, false, false, false,
    ARRAY['name','role','department'])
ON CONFLICT (role_key, concept_key) DO NOTHING;
`;

// --- 3i. Data Scopes ---
const DATA_SCOPES = `
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES
  ('director',  'guest',    'all'),
  ('director',  'staff',    'all'),
  ('director',  'schedule', 'all'),
  ('director',  'prep',     'all'),
  ('volunteer', 'guest',    'all'),
  ('volunteer', 'schedule', 'all'),
  ('viewer',    'guest',    'all'),
  ('viewer',    'schedule', 'all')
ON CONFLICT (role_key, concept_key) DO NOTHING;

INSERT INTO data_scopes (role_key, concept_key, scope_type, field, value)
VALUES
  ('department_head', 'guest', 'department', 'department', NULL),
  ('department_head', 'staff', 'department', 'department', NULL)
ON CONFLICT (role_key, concept_key) DO NOTHING;

INSERT INTO data_scopes (role_key, concept_key, scope_type, relation_path)
VALUES
  ('liaison', 'guest', 'relation', 'pairings.staff')
ON CONFLICT (role_key, concept_key) DO NOTHING;
`;

// --- 3j. Screen Access ---
const SCREEN_ACCESS = `
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('director', 'dashboard', true),
  ('director', 'guests', true),
  ('director', 'staff', true),
  ('director', 'schedule', true),
  ('director', 'prep-tracker', true),
  ('director', 'workflows', true),
  ('director', 'settings', true),
  ('director', 'travel', true),
  ('director', 'venues', true),
  ('director', 'pairings', true),
  ('director', 'canvas', true),
  ('liaison', 'dashboard', true),
  ('liaison', 'guests', true),
  ('liaison', 'schedule', true),
  ('liaison', 'prep-tracker', true),
  ('liaison', 'travel', true),
  ('liaison', 'pairings', true),
  ('volunteer', 'dashboard', true),
  ('volunteer', 'schedule', true),
  ('volunteer', 'prep-tracker', true),
  ('viewer', 'dashboard', true),
  ('viewer', 'guests', true),
  ('viewer', 'schedule', true)
ON CONFLICT (role_key, page_slug) DO NOTHING;
`;

// --- 3k. Form Configs ---
const FORM_CONFIGS = `
INSERT INTO form_configs (concept_key, name, layout, fields, steps)
VALUES (
  'guest',
  'Guest Intake Form',
  'wizard',
  '[
    {"propertyKey": "name", "groupName": "basics", "colSpan": 2},
    {"propertyKey": "type", "groupName": "basics", "colSpan": 1},
    {"propertyKey": "department", "groupName": "basics", "colSpan": 1},
    {"propertyKey": "company", "groupName": "basics", "colSpan": 2},
    {"propertyKey": "status", "groupName": "status", "colSpan": 1},
    {"propertyKey": "interpreterRequired", "groupName": "status", "colSpan": 1,
     "showIf": {"type": "field", "field": "type", "operator": "eq", "value": "JP"}},
    {"propertyKey": "email", "groupName": "contact", "colSpan": 1},
    {"propertyKey": "phone", "groupName": "contact", "colSpan": 1},
    {"propertyKey": "bio", "groupName": "details", "colSpan": 2},
    {"propertyKey": "specialHandling", "groupName": "details", "colSpan": 2}
  ]',
  '[
    {"key": "basics", "label": "Basic Info", "description": "Guest identity and classification"},
    {"key": "status", "label": "Status", "description": "Confirmation status and requirements"},
    {"key": "contact", "label": "Contact", "description": "Contact information (encrypted at rest)"},
    {"key": "details", "label": "Details", "description": "Bio and special handling requirements"}
  ]'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;

INSERT INTO form_configs (concept_key, name, layout, fields)
VALUES (
  'staff',
  'Staff Entry Form',
  'two-column',
  '[
    {"propertyKey": "name", "colSpan": 2},
    {"propertyKey": "email", "colSpan": 1},
    {"propertyKey": "phone", "colSpan": 1},
    {"propertyKey": "role", "colSpan": 1},
    {"propertyKey": "department", "colSpan": 1},
    {"propertyKey": "lineId", "colSpan": 1},
    {"propertyKey": "availability", "colSpan": 1},
    {"propertyKey": "reportsTo", "colSpan": 2}
  ]'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;

INSERT INTO form_configs (concept_key, name, layout, fields)
VALUES (
  'schedule',
  'Schedule Event Form',
  'two-column',
  '[
    {"propertyKey": "name", "colSpan": 2},
    {"propertyKey": "eventType", "colSpan": 1},
    {"propertyKey": "status", "colSpan": 1},
    {"propertyKey": "startTime", "colSpan": 1},
    {"propertyKey": "endTime", "colSpan": 1},
    {"propertyKey": "venue", "colSpan": 1, "autocompleteSource": "venue"},
    {"propertyKey": "guestId", "colSpan": 1, "autocompleteSource": "guest"},
    {"propertyKey": "description", "colSpan": 2}
  ]'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;
`;

// --- 3l. View Configs ---
const VIEW_CONFIGS = `
INSERT INTO view_configs (concept_key, name, view_type, columns, sort, row_action, filters, presets)
VALUES (
  'guest',
  'All Guests',
  'table',
  '[
    {"key": "name", "label": "Name", "sortable": true, "width": 200},
    {"key": "type", "label": "Type", "sortable": true, "width": 120},
    {"key": "department", "label": "Department", "sortable": true, "width": 120},
    {"key": "status", "label": "Status", "sortable": true, "width": 120},
    {"key": "company", "label": "Company", "sortable": true, "width": 150},
    {"key": "interpreterRequired", "label": "Interpreter", "sortable": true, "width": 100}
  ]',
  '{"key": "name", "direction": "asc"}',
  'navigate_to_detail',
  '[]',
  '[
    {"key": "confirmed", "label": "Confirmed Only", "filters": [{"field": "status", "operator": "eq", "value": "Confirmed"}]},
    {"key": "jp", "label": "JP Guests", "filters": [{"field": "type", "operator": "eq", "value": "JP"}]},
    {"key": "draft", "label": "Drafts", "filters": [{"field": "status", "operator": "eq", "value": "draft"}]}
  ]'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;

INSERT INTO view_configs (concept_key, name, view_type, group_by, columns, sort)
VALUES (
  'guest',
  'Guest Pipeline',
  'kanban',
  'status',
  '[
    {"key": "name", "label": "Name"},
    {"key": "type", "label": "Type"},
    {"key": "department", "label": "Department"},
    {"key": "company", "label": "Company"}
  ]',
  '{"key": "name", "direction": "asc"}'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;

INSERT INTO view_configs (concept_key, name, view_type, timeline_start, timeline_end, columns, sort)
VALUES (
  'schedule',
  'Convention Schedule',
  'timeline',
  'startTime',
  'endTime',
  '[
    {"key": "name", "label": "Activity"},
    {"key": "eventType", "label": "Type"},
    {"key": "venue", "label": "Venue"},
    {"key": "status", "label": "Status"}
  ]',
  '{"key": "startTime", "direction": "asc"}'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;

INSERT INTO view_configs (concept_key, name, view_type, columns, sort, filters)
VALUES (
  'prep',
  'Prep Tracker',
  'table',
  '[
    {"key": "name", "label": "Task", "sortable": true},
    {"key": "guestId", "label": "Guest", "sortable": true},
    {"key": "status", "label": "Status", "sortable": true},
    {"key": "dueDate", "label": "Due Date", "sortable": true},
    {"key": "owner", "label": "Owner", "sortable": true}
  ]',
  '{"key": "dueDate", "direction": "asc"}',
  '[{"field": "status", "operator": "neq", "value": "complete"}]'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;

INSERT INTO view_configs (concept_key, name, view_type, columns, sort, row_action)
VALUES (
  'staff',
  'Staff Directory',
  'table',
  '[
    {"key": "name", "label": "Name", "sortable": true},
    {"key": "email", "label": "Email", "sortable": true},
    {"key": "role", "label": "Role", "sortable": true},
    {"key": "department", "label": "Department", "sortable": true},
    {"key": "phone", "label": "Phone"}
  ]',
  '{"key": "name", "direction": "asc"}',
  'inline_edit'
)
ON CONFLICT (concept_key, name, version) DO NOTHING;
`;

// --- 3m. Page Configs ---
const PAGE_CONFIGS = `
INSERT INTO page_configs (name, slug, widgets, breakpoints)
VALUES (
  'Operations Dashboard',
  'dashboard',
  '[
    {"type": "stat_card", "title": "Total Guests", "conceptKey": "guest", "aggregation": "count"},
    {"type": "stat_card", "title": "Confirmed", "conceptKey": "guest", "aggregation": "count", "filter": {"field": "status", "value": "Confirmed"}},
    {"type": "stat_card", "title": "Prep Completion", "conceptKey": "prep", "aggregation": "percentage", "filter": {"field": "status", "value": "complete"}},
    {"type": "data_table", "title": "Recent Guests", "conceptKey": "guest", "limit": 5, "sort": {"key": "created_at", "direction": "desc"}},
    {"type": "prep_progress", "title": "Prep Tracker Progress", "conceptKey": "prep"},
    {"type": "timeline_preview", "title": "Upcoming Events", "conceptKey": "schedule", "limit": 10}
  ]',
  '{"desktop": {"columns": 3}, "tablet": {"columns": 2}, "mobile": {"columns": 1}}'
)
ON CONFLICT (slug, version) DO NOTHING;
`;

// --- 3n. Workflow Configs ---
const WORKFLOW_CONFIGS = `
INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled)
VALUES
  (
    'Guest Confirmed - Create Prep Items',
    'When a guest is confirmed, create standard prep items',
    '{"eventPattern": "guest.status_changed", "conceptKey": "guest", "triggerType": "on_field_change", "changedFields": ["status"]}',
    '{"type": "field", "field": "status", "operator": "eq", "value": "Confirmed"}',
    '[
      {
        "type": "create_record",
        "config": {
          "conceptKey": "prep",
          "records": [
            {"name": "Book Hotel", "status": "incomplete"},
            {"name": "Confirm Dietary Requirements", "status": "incomplete"},
            {"name": "Generate Contract", "status": "incomplete"},
            {"name": "Arrange Airport Transport", "status": "incomplete"},
            {"name": "Confirm Autograph Session Schedule", "status": "incomplete"},
            {"name": "Brief Liaison on Guest Preferences", "status": "incomplete"}
          ]
        }
      },
      {
        "type": "send_notification",
        "config": {
          "channel": "in_app",
          "recipientRole": "liaison",
          "subject": "Guest Confirmed",
          "body": "{{record.name}} has been confirmed. Prep items have been created."
        }
      }
    ]',
    true
  ),
  (
    'JP Guest - Require Interpreter',
    'Auto-flag interpreter requirement for Japanese-speaking guests',
    '{"eventPattern": "guest.created", "conceptKey": "guest", "triggerType": "on_create"}',
    '{"type": "field", "field": "type", "operator": "eq", "value": "JP"}',
    '[{"type": "update_record", "config": {"patch": {"interpreterRequired": true}}}]',
    true
  ),
  (
    'Guest Confirmed - Generate Contract',
    'Auto-generate appearance contract when guest is confirmed',
    '{"eventPattern": "guest.status_changed", "conceptKey": "guest", "triggerType": "on_field_change", "changedFields": ["status"]}',
    '{"type": "field", "field": "status", "operator": "eq", "value": "Confirmed"}',
    '[
      {"type": "generate_document", "config": {"templateName": "appearance_contract", "outputFormat": "pdf"}},
      {"type": "send_notification", "config": {"channel": "email", "recipientRole": "liaison", "subject": "Contract Generated for {{record.name}}", "body": "The appearance contract for {{record.name}} has been generated and is ready for review."}}
    ]',
    true
  ),
  (
    'Daily Overdue Prep Check',
    'Check for overdue prep items every morning at 8 AM',
    '{"eventPattern": "scheduled", "triggerType": "scheduled", "schedule": "0 8 * * *"}',
    NULL,
    '[{"type": "send_notification", "config": {"channel": "in_app", "recipientRole": "coordinator", "subject": "Overdue Prep Items", "body": "There are prep items past their due date. Please review the prep tracker."}}]',
    true
  ),
  (
    'Transport Status Update',
    'Notify liaison when transport status changes',
    '{"eventPattern": "transport.status_changed", "conceptKey": "transport", "triggerType": "on_field_change", "changedFields": ["status"]}',
    NULL,
    '[{"type": "send_notification", "config": {"channel": "in_app", "recipientRole": "liaison", "subject": "Transport Update", "body": "Transport booking status changed to {{record.status}}."}}]',
    true
  )
ON CONFLICT (name, version) DO NOTHING;
`;

// --- 3o. Venues ---
const VENUES = `
INSERT INTO venues (name, type, capacity, floor, building)
SELECT v.name, v.type, v.capacity, v.floor, v.building
FROM (VALUES
  ('Main Events Hall A',  'ballroom',     2000, '1st', 'Hynes Convention Center'),
  ('Main Events Hall B',  'ballroom',     1500, '1st', 'Hynes Convention Center'),
  ('Panel Room 1',        'meeting_room',  200, '2nd', 'Hynes Convention Center'),
  ('Panel Room 2',        'meeting_room',  150, '2nd', 'Hynes Convention Center'),
  ('Panel Room 3',        'meeting_room',  100, '2nd', 'Hynes Convention Center'),
  ('Autograph Hall',      'ballroom',      500, '1st', 'Hynes Convention Center'),
  ('Press Room',          'meeting_room',   50, '3rd', 'Hynes Convention Center'),
  ('Green Room',          'breakout',       30, '3rd', 'Hynes Convention Center'),
  ('Restaurant (Hotel)',  'other',          80, '1st', 'Sheraton Boston'),
  ('Lobby Meeting Point', 'lobby',         100, '1st', 'Hynes Convention Center')
) AS v(name, type, capacity, floor, building)
WHERE NOT EXISTS (SELECT 1 FROM venues WHERE venues.name = v.name);
`;

// --- 3p. Staff ---
const STAFF = `
INSERT INTO staff (name, email, role_key, department, phone, properties)
SELECT v.name, v.email, v.role_key, v.department, v.phone, v.properties::jsonb
FROM (VALUES
  ('Alex Director',     'alex@con.org',     'director',        NULL,      '555-0100', '{"reportsTo":"Board"}'),
  ('Jordan Anime Head', 'jordan@con.org',   'department_head', 'Anime',   '555-0101', '{"reportsTo":"Alex Director"}'),
  ('Sam Gaming Head',   'sam@con.org',      'department_head', 'Gaming',  '555-0102', '{"reportsTo":"Alex Director"}'),
  ('Pat Music Head',    'pat@con.org',      'department_head', 'Music',   '555-0103', '{"reportsTo":"Alex Director"}'),
  ('Robin Liaison',     'robin@con.org',    'liaison',         'Anime',   '555-0201', '{"reportsTo":"Jordan Anime Head"}'),
  ('Casey Liaison',     'casey@con.org',    'liaison',         'Anime',   '555-0202', '{"reportsTo":"Jordan Anime Head"}'),
  ('Morgan Liaison',    'morgan@con.org',   'liaison',         'Gaming',  '555-0203', '{"reportsTo":"Sam Gaming Head"}'),
  ('Riley Liaison',     'riley@con.org',    'liaison',         'Music',   '555-0204', '{"reportsTo":"Pat Music Head"}'),
  ('Haruki Interpreter','haruki@con.org',   'interpreter',     'Anime',   '555-0301', '{"languages":["ja","en"],"lineId":"haruki_line"}'),
  ('Yuki Interpreter',  'yuki@con.org',     'interpreter',     'Anime',   '555-0302', '{"languages":["ja","en"],"lineId":"yuki_line"}'),
  ('Taylor Security',   'taylor@con.org',   'volunteer',       'Anime',   '555-0401', '{"role":"Security Escort"}'),
  ('Jamie Volunteer',   'jamie@con.org',    'volunteer',       'Anime',   '555-0402', '{}'),
  ('Drew Volunteer',    'drew@con.org',     'volunteer',       'Gaming',  '555-0403', '{}'),
  ('Avery Volunteer',   'avery@con.org',    'volunteer',       'Music',   '555-0404', '{}'),
  ('Quinn Coordinator', 'quinn@con.org',    'coordinator',     NULL,      '555-0501', '{"reportsTo":"Alex Director"}'),
  ('Blake Coordinator', 'blake@con.org',    'coordinator',     NULL,      '555-0502', '{"reportsTo":"Alex Director"}'),
  ('Reese Logistics',   'reese@con.org',    'coordinator',     NULL,      '555-0503', '{"role":"Transport Coordinator"}'),
  ('Skyler AV',         'skyler@con.org',   'volunteer',       NULL,      '555-0504', '{"role":"AV Tech"}'),
  ('Dakota Runner',     'dakota@con.org',   'volunteer',       NULL,      '555-0505', '{"role":"Runner"}'),
  ('Emery Social',      'emery@con.org',    'volunteer',       NULL,      '555-0506', '{"role":"Social Media"}')
) AS v(name, email, role_key, department, phone, properties)
WHERE NOT EXISTS (SELECT 1 FROM staff WHERE staff.email = v.email);
`;

// --- 3q. Guests ---
const GUESTS = `
INSERT INTO guests (name, type, department, status, company, properties)
SELECT v.name, v.type, v.department, v.status, v.company, v.properties::jsonb
FROM (VALUES
  ('Tanaka Yuto',       'JP',       'Anime',   'Confirmed', 'Sigma Seven',     '{"interpreterRequired":true,"bio":"Voice actor known for anime roles","specialHandling":["VIP"]}'),
  ('Sato Hana',         'JP',       'Anime',   'Confirmed', 'Aoni Production', '{"interpreterRequired":true,"bio":"Voice actress and singer"}'),
  ('Suzuki Riku',       'JP',       'Anime',   'Contacted', 'I''m Enterprise', '{"interpreterRequired":true}'),
  ('Mike Johnson',      'EN',       'Anime',   'Confirmed', 'Funimation',      '{"bio":"English voice actor, known for dub roles"}'),
  ('Sarah Chen',        'EN',       'Anime',   'Confirmed', 'VIZ Media',       '{"bio":"Voice director and actress"}'),
  ('David Park',        'EN',       'Gaming',  'Confirmed', 'Indie Studio',    '{"bio":"Indie game developer and streamer"}'),
  ('Yamada Mei',        'JP',       'Music',   'Confirmed', 'Lantis',          '{"interpreterRequired":true,"bio":"Anisong artist","specialHandling":["VIP","Green Room"]}'),
  ('DJ Matsumoto',      'JP',       'Music',   'Wishlist',  'Avex',            '{"interpreterRequired":true}'),
  ('Emily Roberts',     'EN',       'Cosplay', 'Confirmed', 'Independent',     '{"bio":"Professional cosplayer and costume designer"}'),
  ('Carlos Mendez',     'Industry', 'Industry','Confirmed', 'Crunchyroll',     '{"bio":"Director of Partnerships at Crunchyroll"}'),
  ('Lisa Watanabe',     'EN',       'Artists', 'Confirmed', 'Independent',     '{"bio":"Manga-style illustrator and character designer"}'),
  ('James O''Brien',    'EN',       'Panels',  'Contacted', 'Podcast Network', '{"bio":"Anime podcast host with 200k subscribers"}')
) AS v(name, type, department, status, company, properties)
WHERE NOT EXISTS (SELECT 1 FROM guests WHERE guests.name = v.name);
`;

// --- 3r. Schedule Events ---
const SCHEDULE_EVENTS = `
INSERT INTO schedule_events (name, event_type, venue_id, start_time, end_time, status, properties)
SELECT v.name, v.event_type,
  (SELECT id FROM venues WHERE venues.name = v.venue_name LIMIT 1),
  v.start_time::timestamptz, v.end_time::timestamptz, v.status, v.properties::jsonb
FROM (VALUES
  ('Opening Ceremony',                    'Panel',             'Main Events Hall A', '2026-05-22 10:00:00-04', '2026-05-22 11:00:00-04', 'confirmed', '{"description":"Convention opening with guest introductions"}'),
  ('Tanaka Yuto Q&A Panel',               'Panel',             'Panel Room 1',       '2026-05-22 13:00:00-04', '2026-05-22 14:00:00-04', 'confirmed', '{}'),
  ('Autograph Session - Block 1',         'Autograph Session', 'Autograph Hall',     '2026-05-22 14:30:00-04', '2026-05-22 16:00:00-04', 'confirmed', '{}'),
  ('Guest Welcome Dinner',                'Meal',              'Restaurant (Hotel)', '2026-05-22 18:00:00-04', '2026-05-22 20:00:00-04', 'confirmed', '{"description":"Welcome dinner for all confirmed guests"}'),
  ('Yamada Mei Concert',                  'Panel',             'Main Events Hall A', '2026-05-22 20:00:00-04', '2026-05-22 21:30:00-04', 'confirmed', '{"description":"Live anisong performance"}'),
  ('David Park - Game Dev Talk',          'Panel',             'Panel Room 2',       '2026-05-23 10:00:00-04', '2026-05-23 11:00:00-04', 'confirmed', '{}'),
  ('Photo Op Session',                    'Photo Op',          'Press Room',         '2026-05-23 11:30:00-04', '2026-05-23 13:00:00-04', 'confirmed', '{}'),
  ('Sato Hana & Mike Johnson Dub Panel',  'Panel',             'Panel Room 1',       '2026-05-23 14:00:00-04', '2026-05-23 15:00:00-04', 'confirmed', '{"description":"EN vs JP dubbing discussion"}'),
  ('Cosplay Construction Workshop',       'Panel',             'Panel Room 3',       '2026-05-23 15:30:00-04', '2026-05-23 17:00:00-04', 'confirmed', '{}'),
  ('Closing Ceremony',                    'Panel',             'Main Events Hall A', '2026-05-24 16:00:00-04', '2026-05-24 17:00:00-04', 'confirmed', '{"description":"Convention closing with guest farewells"}')
) AS v(name, event_type, venue_name, start_time, end_time, status, properties)
WHERE NOT EXISTS (SELECT 1 FROM schedule_events WHERE schedule_events.name = v.name);
`;

// --- 3s. Pairings ---
const PAIRINGS = `
INSERT INTO pairings (guest_id, staff_id, role)
SELECT g.id, s.id, v.role
FROM (VALUES
  ('Tanaka Yuto',   'Robin Liaison',      'Main Liaison'),
  ('Tanaka Yuto',   'Haruki Interpreter', 'Interpreter'),
  ('Sato Hana',     'Casey Liaison',      'Main Liaison'),
  ('Sato Hana',     'Yuki Interpreter',   'Interpreter'),
  ('Mike Johnson',  'Robin Liaison',      'Backup Liaison'),
  ('Sarah Chen',    'Casey Liaison',      'Backup Liaison'),
  ('David Park',    'Morgan Liaison',     'Main Liaison'),
  ('Yamada Mei',    'Riley Liaison',      'Main Liaison'),
  ('Yamada Mei',    'Haruki Interpreter', 'Interpreter'),
  ('Yamada Mei',    'Taylor Security',    'Security Escort'),
  ('Emily Roberts', 'Casey Liaison',      'Main Liaison'),
  ('Carlos Mendez', 'Quinn Coordinator',  'Main Liaison')
) AS v(guest_name, staff_name, role)
JOIN guests g ON g.name = v.guest_name
JOIN staff s ON s.name = v.staff_name
WHERE NOT EXISTS (
  SELECT 1 FROM pairings p
  WHERE p.guest_id = g.id AND p.staff_id = s.id AND p.role = v.role
);
`;

// --- 3t. Prep Items ---
const PREP_ITEMS = `
WITH confirmed_guests AS (
  SELECT id, name FROM guests WHERE status = 'Confirmed'
)
INSERT INTO prep_items (name, guest_id, status, due_date)
SELECT task.name, g.id, 'incomplete', '2026-05-01'
FROM confirmed_guests g
CROSS JOIN (VALUES
  ('Book Hotel'),
  ('Confirm Dietary Requirements'),
  ('Generate Appearance Contract'),
  ('Arrange Airport Transport'),
  ('Confirm Autograph Session'),
  ('Brief Liaison on Preferences'),
  ('Send Welcome Packet')
) AS task(name)
WHERE NOT EXISTS (
  SELECT 1 FROM prep_items pi WHERE pi.guest_id = g.id AND pi.name = task.name
);
`;

// --- 3t2. Prep Item Status Updates ---
const PREP_ITEM_UPDATES = `
UPDATE prep_items
SET status = 'complete'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Tanaka Yuto' LIMIT 1)
  AND name IN ('Book Hotel', 'Confirm Dietary Requirements');

UPDATE prep_items
SET status = 'in_progress'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Tanaka Yuto' LIMIT 1)
  AND name = 'Generate Appearance Contract';

UPDATE prep_items
SET status = 'complete'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Sato Hana' LIMIT 1)
  AND name = 'Book Hotel';

UPDATE prep_items
SET status = 'complete'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Mike Johnson' LIMIT 1)
  AND name IN ('Book Hotel', 'Confirm Dietary Requirements', 'Generate Appearance Contract');

UPDATE prep_items
SET status = 'in_progress'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Mike Johnson' LIMIT 1)
  AND name = 'Arrange Airport Transport';

UPDATE prep_items
SET status = 'complete'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Yamada Mei' LIMIT 1)
  AND name IN ('Book Hotel', 'Generate Appearance Contract');

UPDATE prep_items
SET status = 'in_progress'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Yamada Mei' LIMIT 1)
  AND name = 'Confirm Dietary Requirements';
`;

// --- 3u. Transport Bookings ---
const TRANSPORT_BOOKINGS = `
INSERT INTO transport_bookings (guest_id, booking_type, status, pickup_location, dropoff_location, scheduled_time, flight_number)
SELECT g.id, v.booking_type, v.status, v.pickup, v.dropoff, v.sched::timestamptz, v.flight
FROM (VALUES
  ('Tanaka Yuto',   'arrival',     'confirmed', 'Logan Airport Terminal E', 'Sheraton Boston Hotel',    '2026-05-21 14:30:00-04', 'JL006'),
  ('Tanaka Yuto',   'departure',   'requested', 'Sheraton Boston Hotel',    'Logan Airport Terminal E', '2026-05-25 10:00:00-04', 'JL005'),
  ('Sato Hana',     'arrival',     'confirmed', 'Logan Airport Terminal E', 'Sheraton Boston Hotel',    '2026-05-21 16:00:00-04', 'NH108'),
  ('Sato Hana',     'departure',   'requested', 'Sheraton Boston Hotel',    'Logan Airport Terminal E', '2026-05-25 08:00:00-04', 'NH109'),
  ('Yamada Mei',    'arrival',     'requested', 'Logan Airport Terminal E', 'Sheraton Boston Hotel',    '2026-05-21 12:00:00-04', 'DL456'),
  ('Yamada Mei',    'departure',   'requested', 'Sheraton Boston Hotel',    'Logan Airport Terminal E', '2026-05-25 14:00:00-04', 'DL457'),
  ('Mike Johnson',  'arrival',     'confirmed', 'Logan Airport Terminal B', 'Sheraton Boston Hotel',    '2026-05-21 18:00:00-04', 'AA1234'),
  ('Mike Johnson',  'departure',   'confirmed', 'Sheraton Boston Hotel',    'Logan Airport Terminal B', '2026-05-25 12:00:00-04', 'AA1235'),
  ('Sarah Chen',    'arrival',     'confirmed', 'Logan Airport Terminal C', 'Sheraton Boston Hotel',    '2026-05-21 15:00:00-04', 'UA789'),
  ('David Park',    'arrival',     'requested', 'Logan Airport Terminal B', 'Sheraton Boston Hotel',    '2026-05-21 16:30:00-04', 'DL123'),
  ('Emily Roberts', 'arrival',     'confirmed', 'Logan Airport Terminal A', 'Sheraton Boston Hotel',    '2026-05-21 11:00:00-04', 'SW456'),
  ('Carlos Mendez', 'arrival',     'confirmed', 'Logan Airport Terminal C', 'Sheraton Boston Hotel',    '2026-05-21 17:00:00-04', 'UA234'),
  ('Lisa Watanabe', 'arrival',     'requested', 'Logan Airport Terminal B', 'Sheraton Boston Hotel',    '2026-05-21 13:00:00-04', 'JB567'),
  ('Tanaka Yuto',   'inter_venue', 'confirmed', 'Sheraton Boston Hotel',    'Hynes Convention Center',  '2026-05-22 09:00:00-04', NULL),
  ('Sato Hana',     'inter_venue', 'confirmed', 'Sheraton Boston Hotel',    'Hynes Convention Center',  '2026-05-22 09:00:00-04', NULL),
  ('Yamada Mei',    'inter_venue', 'confirmed', 'Sheraton Boston Hotel',    'Hynes Convention Center',  '2026-05-22 09:00:00-04', NULL)
) AS v(guest_name, booking_type, status, pickup, dropoff, sched, flight)
JOIN guests g ON g.name = v.guest_name
WHERE NOT EXISTS (
  SELECT 1 FROM transport_bookings tb
  WHERE tb.guest_id = g.id AND tb.booking_type = v.booking_type AND tb.scheduled_time = v.sched::timestamptz
);
`;

// --- 3v. Guest-Schedule Events ---
const GUEST_SCHEDULE_EVENTS = `
INSERT INTO guest_schedule_events (guest_id, schedule_event_id, role) VALUES
  -- Opening Ceremony
  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Opening Ceremony' LIMIT 1), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Sato Hana' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Opening Ceremony' LIMIT 1), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Mike Johnson' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Opening Ceremony' LIMIT 1), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Yamada Mei' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Opening Ceremony' LIMIT 1), 'panelist'),

  -- Tanaka Yuto Q&A
  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Tanaka Yuto Q&A Panel' LIMIT 1), 'panelist'),

  -- Yamada Mei Concert
  ((SELECT id FROM guests WHERE name = 'Yamada Mei' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Yamada Mei Concert' LIMIT 1), 'performer'),

  -- David Park Game Dev Talk
  ((SELECT id FROM guests WHERE name = 'David Park' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'David Park - Game Dev Talk' LIMIT 1), 'panelist'),

  -- Dub Panel
  ((SELECT id FROM guests WHERE name = 'Sato Hana' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Sato Hana & Mike Johnson Dub Panel' LIMIT 1), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Mike Johnson' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Sato Hana & Mike Johnson Dub Panel' LIMIT 1), 'panelist'),

  -- Cosplay Workshop
  ((SELECT id FROM guests WHERE name = 'Emily Roberts' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Cosplay Construction Workshop' LIMIT 1), 'panelist'),

  -- Closing Ceremony
  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Closing Ceremony' LIMIT 1), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Yamada Mei' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Closing Ceremony' LIMIT 1), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Mike Johnson' LIMIT 1),
   (SELECT id FROM schedule_events WHERE name = 'Closing Ceremony' LIMIT 1), 'panelist')
ON CONFLICT (guest_id, schedule_event_id) DO NOTHING;
`;

// --- 3w. Verification query ---
const VERIFICATION_QUERY = `
SELECT 'ontology_concepts' AS table_name, count(*)::int AS row_count FROM ontology_concepts WHERE status = 'active'
UNION ALL SELECT 'ontology_properties', count(*)::int FROM ontology_properties WHERE status = 'active'
UNION ALL SELECT 'ontology_relationships', count(*)::int FROM ontology_relationships WHERE status = 'active'
UNION ALL SELECT 'ontology_events', count(*)::int FROM ontology_events WHERE status = 'active'
UNION ALL SELECT 'ontology_constraints', count(*)::int FROM ontology_constraints WHERE status = 'active'
UNION ALL SELECT 'roles', count(*)::int FROM roles
UNION ALL SELECT 'users', count(*)::int FROM users
UNION ALL SELECT 'permissions', count(*)::int FROM permissions
UNION ALL SELECT 'data_scopes', count(*)::int FROM data_scopes
UNION ALL SELECT 'screen_access', count(*)::int FROM screen_access
UNION ALL SELECT 'form_configs', count(*)::int FROM form_configs WHERE status = 'active'
UNION ALL SELECT 'view_configs', count(*)::int FROM view_configs WHERE status = 'active'
UNION ALL SELECT 'page_configs', count(*)::int FROM page_configs WHERE status = 'active'
UNION ALL SELECT 'workflow_configs', count(*)::int FROM workflow_configs WHERE status = 'active'
UNION ALL SELECT 'venues', count(*)::int FROM venues WHERE NOT archived
UNION ALL SELECT 'staff', count(*)::int FROM staff WHERE NOT archived
UNION ALL SELECT 'guests', count(*)::int FROM guests WHERE NOT archived
UNION ALL SELECT 'schedule_events', count(*)::int FROM schedule_events WHERE NOT archived
UNION ALL SELECT 'pairings', count(*)::int FROM pairings WHERE NOT archived
UNION ALL SELECT 'prep_items', count(*)::int FROM prep_items WHERE NOT archived
UNION ALL SELECT 'transport_bookings', count(*)::int FROM transport_bookings WHERE NOT archived
UNION ALL SELECT 'guest_schedule_events', count(*)::int FROM guest_schedule_events WHERE NOT archived
ORDER BY table_name;
`;

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const connectionString = loadDatabaseUrl();
  console.log(
    `Connecting to: ${connectionString.replace(/:[^@]+@/, ":****@")}`
  );

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15_000,
  });

  try {
    // Test connection
    const connTest = await pool.query("SELECT 1 AS ok");
    if (connTest.rows[0]?.ok !== 1) {
      throw new Error("Connection test failed");
    }
    console.log("Connected successfully.\n");

    // Run seed sections in order
    console.log("--- Seeding Ontology ---");
    await runSection(pool, "ontology_concepts", ONTOLOGY_CONCEPTS);
    await runSection(pool, "ontology_properties", ONTOLOGY_PROPERTIES);
    await runSection(pool, "ontology_relationships", ONTOLOGY_RELATIONSHIPS);
    await runSection(pool, "ontology_events", ONTOLOGY_EVENTS);
    await runSection(pool, "ontology_constraints", ONTOLOGY_CONSTRAINTS);

    console.log("\n--- Seeding RBAC ---");
    await runSection(pool, "roles", RBAC_ROLES);
    await runSection(pool, "users (demo director)", DEMO_USER);
    await runSection(pool, "permissions", PERMISSIONS);
    await runSection(pool, "data_scopes", DATA_SCOPES);
    await runSection(pool, "screen_access", SCREEN_ACCESS);

    console.log("\n--- Seeding Config ---");
    await runSection(pool, "form_configs", FORM_CONFIGS);
    await runSection(pool, "view_configs", VIEW_CONFIGS);
    await runSection(pool, "page_configs", PAGE_CONFIGS);
    await runSection(pool, "workflow_configs", WORKFLOW_CONFIGS);

    console.log("\n--- Seeding Operational Data ---");
    await runSection(pool, "venues", VENUES);
    await runSection(pool, "staff", STAFF);
    await runSection(pool, "guests", GUESTS);
    await runSection(pool, "schedule_events", SCHEDULE_EVENTS);
    await runSection(pool, "pairings", PAIRINGS);
    await runSection(pool, "prep_items", PREP_ITEMS);
    await runSection(pool, "prep_item_updates", PREP_ITEM_UPDATES);
    await runSection(pool, "transport_bookings", TRANSPORT_BOOKINGS);
    await runSection(pool, "guest_schedule_events", GUEST_SCHEDULE_EVENTS);

    // Verification
    console.log("\n--- Verification ---");
    const verification = await pool.query(VERIFICATION_QUERY);
    console.log("\nTable                    | Rows");
    console.log("-------------------------|------");
    for (const row of verification.rows) {
      const name = String(row.table_name).padEnd(25);
      console.log(`${name}| ${row.row_count}`);
    }

    console.log("\nSeed complete.");
  } catch (err) {
    console.error("\nSeed FAILED:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
