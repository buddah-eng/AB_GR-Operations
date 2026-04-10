# Seeding the Ontology

> The ontology defines what your convention manages. Concepts are entity types.
> Properties are fields on those concepts. Relationships connect concepts together.
> This is the most important step -- everything else (RBAC, forms, views, workflows) depends on a well-defined ontology.
> You can use SQL inserts, the API, or the ontology web builder.

---

## What the Ontology Is

The ontology is your convention's data model, stored in five Postgres tables:

| Table | What It Defines | Example |
|-------|----------------|---------|
| `ontology_concepts` | Entity types | Guest, Staff, Schedule Event, Venue |
| `ontology_properties` | Fields on each entity | Guest.name, Guest.status, Guest.type |
| `ontology_relationships` | Connections between entities | Guest has-many Pairings, Event has-one Venue |
| `ontology_events` | Domain events entities emit | guest.created, guest.status_changed |
| `ontology_constraints` | Conditional rules | JP Guest requires interpreter |

The engine reads these tables at startup, caches them, and uses them to drive everything: the API validates against the ontology, forms render from it, views display it, RBAC filters by it.

---

## Core Concepts to Define

For a typical convention guest relations department, you need at minimum these concepts:

### 1. Guest

The primary entity. Represents an invited guest (voice actor, musician, artist, industry representative, etc.).

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES (
  'guest',
  'Guest',
  'Guests',
  'pi pi-users',
  'Invited convention guests -- VAs, musicians, artists, industry reps'
);
```

### 2. Staff

Convention staff members -- liaisons, interpreters, coordinators, volunteers.

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES (
  'staff',
  'Staff',
  'Staff',
  'pi pi-id-card',
  'Convention staff -- liaisons, interpreters, coordinators, volunteers'
);
```

### 3. Schedule Event

A scheduled activity during the convention -- panels, autograph sessions, photo ops, meals.

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES (
  'schedule',
  'Event',
  'Schedule',
  'pi pi-calendar',
  'Scheduled convention activities -- panels, signings, photo ops, meals'
);
```

### 4. Venue

Physical locations within the convention center.

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES (
  'venue',
  'Venue',
  'Venues',
  'pi pi-map-marker',
  'Convention venues -- meeting rooms, halls, outdoor spaces'
);
```

### 5. Pairing

Links a guest to a staff member with a role (main liaison, backup, interpreter, security).

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES (
  'pairing',
  'Pairing',
  'Pairings',
  'pi pi-link',
  'Guest-to-staff assignment with a role (liaison, interpreter, escort)'
);
```

### 6. Prep Item

A task that must be completed for a guest before the convention -- hotel booking, contract signing, dietary confirmation.

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES (
  'prep',
  'Prep Item',
  'Prep Tracker',
  'pi pi-check-square',
  'Pre-convention tasks -- hotel, contract, dietary, travel confirmation'
);
```

### 7. Transport

Guest transportation -- airport pickups, hotel transfers, inter-venue transport.

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES (
  'transport',
  'Transport',
  'Transport',
  'pi pi-car',
  'Guest transport bookings -- airport, hotel, inter-venue'
);
```

### 8. Contract

Guest contracts and agreements.

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description)
VALUES (
  'contract',
  'Contract',
  'Contracts',
  'pi pi-file',
  'Guest contracts -- appearance agreements, NDAs, payment terms'
);
```

### 9. Convention (Optional)

Metadata about the convention itself. Useful for multi-year tracking.

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description, is_config)
VALUES (
  'convention',
  'Convention',
  'Conventions',
  'pi pi-globe',
  'Convention metadata -- dates, venue, year, branding',
  true
);
```

### 10. Guest Registry (Optional)

Year-over-year guest history. Uses the `is_registry` flag to indicate persistent cross-year data.

```sql
INSERT INTO ontology_concepts (key, name, plural_name, icon, description, is_registry)
VALUES (
  'guest_registry',
  'Guest Registry',
  'Guest Registry',
  'pi pi-book',
  'Cross-year guest history -- tracks attendance, preferences, notes across conventions',
  true
);
```

---

## Properties for Each Concept

Properties define the fields on each concept. Each property has a type, and optionally has validation rules, options (for select fields), and display settings.

### 17 Available Property Types

| Type | Postgres Storage | UI Input | Example |
|------|-----------------|----------|---------|
| `text` | TEXT or JSONB | Text input | Name, company |
| `rich_text` | JSONB | Rich text editor | Bio, notes |
| `number` | INTEGER/NUMERIC or JSONB | Number input | Capacity, count |
| `select` | TEXT or JSONB | Dropdown | Status, type, department |
| `multi_select` | TEXT[] or JSONB | Multi-select | Skills, languages |
| `date` | DATE or JSONB | Date picker | Due date, event date |
| `datetime` | TIMESTAMPTZ or JSONB | Datetime picker | Start time, end time |
| `checkbox` | BOOLEAN or JSONB | Toggle | Interpreter required, VIP |
| `url` | JSONB | URL input | Website, social media |
| `email` | TEXT or JSONB | Email input | Contact email |
| `phone` | JSONB | Phone input | Contact phone |
| `relation` | UUID FK or JSONB | Autocomplete | Guest ID, venue ID |
| `formula` | JSONB (computed) | Read-only | Calculated fields |
| `rollup` | JSONB (computed) | Read-only | Aggregated values |
| `files` | JSONB | File upload | Photos, documents |
| `people` | JSONB | People picker | Assigned staff |
| `status` | TEXT or JSONB | Status badge | Workflow status |

### Guest Properties

```sql
-- Guest: name (typed column — stored in guests.name)
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('guest', 'name', 'Name', 'text', true, 10, 'name');

-- Guest: type (typed column — stored in guests.type)
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column, options)
VALUES ('guest', 'type', 'Type', 'select', true, 20, 'type',
  '[{"value":"EN","label":"English-speaking"},{"value":"JP","label":"Japanese-speaking"},{"value":"Industry","label":"Industry"},{"value":"Musical","label":"Musical Act"},{"value":"Artist","label":"Artist"}]'
);

-- Guest: department
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column, options)
VALUES ('guest', 'department', 'Department', 'select', true, 30, 'department',
  '[{"value":"Anime","label":"Anime"},{"value":"Gaming","label":"Gaming"},{"value":"Music","label":"Music"},{"value":"Cosplay","label":"Cosplay"},{"value":"Panels","label":"Panels"},{"value":"Artists","label":"Artists"},{"value":"Industry","label":"Industry"}]'
);

-- Guest: status
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column, options)
VALUES ('guest', 'status', 'Status', 'status', true, 40, 'status',
  '[{"value":"draft","label":"Draft","color":"gray"},{"value":"Wishlist","label":"Wishlist","color":"blue"},{"value":"Contacted","label":"Contacted","color":"yellow"},{"value":"Confirmed","label":"Confirmed","color":"green"},{"value":"Declined","label":"Declined","color":"red"},{"value":"Cancelled","label":"Cancelled","color":"red"}]'
);

-- Guest: company
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('guest', 'company', 'Company / Agency', 'text', false, 50, 'company');

-- Guest: interpreterRequired (JSONB — stored in guests.properties)
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, description)
VALUES ('guest', 'interpreterRequired', 'Interpreter Required', 'checkbox', false, 60,
  'Whether this guest needs a Japanese interpreter');

-- Guest: email (JSONB — stored in guests.properties, encrypted at rest)
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('guest', 'email', 'Email', 'email', false, 70);

-- Guest: phone (JSONB)
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('guest', 'phone', 'Phone', 'phone', false, 80);

-- Guest: bio (JSONB)
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('guest', 'bio', 'Bio', 'rich_text', false, 90);

-- Guest: specialHandling (JSONB)
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, options)
VALUES ('guest', 'specialHandling', 'Special Handling', 'multi_select', false, 100,
  '[{"value":"VIP","label":"VIP Treatment"},{"value":"Green Room","label":"Green Room Access"},{"value":"Security","label":"Extra Security"},{"value":"Dietary","label":"Special Dietary Needs"}]'
);
```

### Staff Properties

```sql
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('staff', 'name', 'Name', 'text', true, 10, 'name');

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('staff', 'email', 'Email', 'email', false, 20, 'email');

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, options)
VALUES ('staff', 'role', 'Role', 'select', true, 30,
  '[{"value":"Main Liaison","label":"Main Liaison"},{"value":"Backup Liaison","label":"Backup Liaison"},{"value":"Interpreter","label":"Interpreter"},{"value":"Security Escort","label":"Security Escort"},{"value":"Department Head","label":"Department Head"},{"value":"Volunteer","label":"Volunteer"}]'
);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column, options)
VALUES ('staff', 'department', 'Department', 'select', true, 40, 'department',
  '[{"value":"Anime","label":"Anime"},{"value":"Gaming","label":"Gaming"},{"value":"Music","label":"Music"},{"value":"Cosplay","label":"Cosplay"},{"value":"Panels","label":"Panels"},{"value":"Artists","label":"Artists"},{"value":"Industry","label":"Industry"}]'
);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('staff', 'phone', 'Phone', 'phone', false, 50, 'phone');

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('staff', 'lineId', 'LINE ID', 'text', false, 60);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('staff', 'availability', 'Availability', 'text', false, 70);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('staff', 'reportsTo', 'Reports To', 'text', false, 80);
```

### Schedule Event Properties

```sql
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('schedule', 'name', 'Activity', 'text', true, 10, 'name');

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column, options)
VALUES ('schedule', 'eventType', 'Event Type', 'select', true, 20, 'event_type',
  '[{"value":"Panel","label":"Panel"},{"value":"Autograph Session","label":"Autograph Session"},{"value":"Photo Op","label":"Photo Op"},{"value":"Meal","label":"Meal"},{"value":"Photoshoot","label":"Photoshoot"},{"value":"Interview","label":"Interview"},{"value":"Rehearsal","label":"Rehearsal"},{"value":"Meet & Greet","label":"Meet & Greet"},{"value":"Other","label":"Other"}]'
);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('schedule', 'startTime', 'Start Time', 'datetime', true, 30, 'start_time');

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('schedule', 'endTime', 'End Time', 'datetime', true, 40, 'end_time');

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('schedule', 'venue', 'Venue', 'relation', false, 50);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('schedule', 'guestId', 'Guest', 'relation', false, 60);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column, options)
VALUES ('schedule', 'status', 'Status', 'status', true, 70, 'status',
  '[{"value":"draft","label":"Draft","color":"gray"},{"value":"confirmed","label":"Confirmed","color":"green"},{"value":"cancelled","label":"Cancelled","color":"red"}]'
);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('schedule', 'description', 'Description', 'rich_text', false, 80);
```

### Prep Item Properties

```sql
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('prep', 'name', 'Task', 'text', true, 10, 'name');

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('prep', 'guestId', 'Guest', 'relation', true, 20);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column, options)
VALUES ('prep', 'status', 'Status', 'status', true, 30, 'status',
  '[{"value":"incomplete","label":"Incomplete","color":"red"},{"value":"in_progress","label":"In Progress","color":"yellow"},{"value":"complete","label":"Complete","color":"green"},{"value":"na","label":"N/A","color":"gray"}]'
);

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, postgres_column)
VALUES ('prep', 'dueDate', 'Due Date', 'date', false, 40, 'due_date');

INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('prep', 'owner', 'Owner', 'text', false, 50);
```

---

## Relationships

Relationships define how concepts connect to each other.

```sql
-- Guest has-many Pairings
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('guest', 'pairing', 'pairings', 'Staff Pairings', 'has-many', 'guest');

-- Staff has-many Pairings
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('staff', 'pairing', 'pairings', 'Guest Assignments', 'has-many', 'staff');

-- Guest has-many Schedule Events (via junction table)
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('guest', 'schedule', 'schedule', 'Schedule', 'has-many', 'guests');

-- Guest has-many Prep Items
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('guest', 'prep', 'prepItems', 'Prep Items', 'has-many', 'guest');

-- Guest has-many Transport Bookings
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('guest', 'transport', 'transport', 'Transport', 'has-many', 'guest');

-- Guest has-many Contracts
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('guest', 'contract', 'contracts', 'Contracts', 'has-many', 'guest');

-- Schedule Event has-one Venue
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('schedule', 'venue', 'venue', 'Venue', 'has-one', 'events');

-- Venue has-many Schedule Events
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('venue', 'schedule', 'events', 'Events', 'has-many', 'venue');

-- Guest has-one Guest Registry entry (optional, for YoY tracking)
INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key)
VALUES ('guest', 'guest_registry', 'registry', 'Registry Entry', 'has-one', 'appearances');
```

---

## Domain Events

Define what events each concept can emit. These are used by the workflow engine.

```sql
-- Guest events
INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type)
VALUES ('guest', 'created', 'guest.created', 'on_create');

INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type, changed_fields)
VALUES ('guest', 'status_changed', 'guest.status_changed', 'on_field_change', ARRAY['status']);

INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type)
VALUES ('guest', 'updated', 'guest.updated', 'on_update');

INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type)
VALUES ('guest', 'deleted', 'guest.deleted', 'on_delete');

-- Schedule events
INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type)
VALUES ('schedule', 'created', 'schedule.created', 'on_create');

INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type)
VALUES ('schedule', 'updated', 'schedule.updated', 'on_update');

-- Prep item events
INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type, changed_fields)
VALUES ('prep', 'completed', 'prep.completed', 'on_field_change', ARRAY['status']);

-- Transport events
INSERT INTO ontology_events (concept_key, event_key, full_event_name, trigger_type, changed_fields)
VALUES ('transport', 'status_changed', 'transport.status_changed', 'on_field_change', ARRAY['status']);
```

---

## Constraints

Constraints add conditional rules to concepts. When the condition matches, additional defaults or required fields are applied.

```sql
-- JP Guest constraint: if type = 'JP', interpreter is required
INSERT INTO ontology_constraints (concept_key, name, condition, defaults, required_fields, description)
VALUES (
  'guest',
  'JP Guest',
  '{"type": "field", "field": "type", "operator": "eq", "value": "JP"}',
  '{"interpreterRequired": true}',
  ARRAY['interpreterRequired'],
  'Japanese-speaking guests automatically require an interpreter'
);

-- VIP Guest constraint: if specialHandling includes 'VIP', green room required
INSERT INTO ontology_constraints (concept_key, name, condition, defaults, description)
VALUES (
  'guest',
  'VIP Guest',
  '{"type": "field", "field": "specialHandling", "operator": "contains", "value": "VIP"}',
  '{"greenRoomRequired": true}',
  'VIP guests automatically get green room access'
);
```

---

## Concept Inheritance (Advanced)

A concept can extend another concept using the `extends` field. The child inherits all properties and constraints from the parent. This is useful for specialized subtypes.

```sql
-- VIP Guest extends Guest
INSERT INTO ontology_concepts (key, name, plural_name, extends, icon, description)
VALUES (
  'vip_guest',
  'VIP Guest',
  'VIP Guests',
  'guest',
  'pi pi-star',
  'VIP guests with enhanced handling requirements'
);

-- Add VIP-specific properties (in addition to inherited Guest properties)
INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order)
VALUES ('vip_guest', 'greenRoomRequired', 'Green Room Required', 'checkbox', true, 200);
```

The ontology loader resolves inheritance at load time -- child concepts get all parent properties merged with their own, and child properties with the same key override the parent's.

---

## Using the Ontology Web Builder (Alternative)

Instead of SQL inserts, you can use the ontology web builder in the running application. Navigate to the Settings page and use the builder interface to define concepts, properties, and relationships visually. The builder writes to the same Postgres tables.

The builder is available at:
- `/builder/form/:conceptKey` -- form configuration builder
- `/builder/view/:conceptKey` -- view configuration builder
- `/builder/workflow/:id` -- workflow builder

---

## Verification

After seeding the ontology, verify it loaded correctly:

```sql
-- Count concepts
SELECT count(*) FROM ontology_concepts WHERE status = 'active';

-- List all concepts with property counts
SELECT c.key, c.name, count(p.id) AS property_count
FROM ontology_concepts c
LEFT JOIN ontology_properties p ON p.concept_key = c.key AND p.status = 'active'
WHERE c.status = 'active'
GROUP BY c.key, c.name
ORDER BY c.name;

-- List relationships
SELECT source_concept_key, key, cardinality, target_concept_key
FROM ontology_relationships
WHERE status = 'active'
ORDER BY source_concept_key;

-- Verify via the API
curl http://localhost:8080/api/ontology | jq '.data.concepts | length'
```

---

## Next Step

[04-configure-rbac.md -- Configuring Roles and Permissions](04-configure-rbac.md)
