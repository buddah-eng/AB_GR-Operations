# Configuring Roles and Permissions

> RBAC is deny-by-default. If no permission row exists for a role+concept pair, the answer is "no."
> Roles are data rows, not code. The engine reads them from Postgres at runtime.
> Three layers of access control: CRUD gates, data scoping (row-level), and field filtering (column-level).

---

## 1. Define Roles

Roles define who people are in the system. Each role has a priority (lower number = higher access) and an `is_operational` flag indicating whether this role participates in staffing and scheduling.

```sql
INSERT INTO roles (key, name, description, priority, is_operational) VALUES
  ('director',        'Director',        'Full access to all concepts and data',          10, true),
  ('department_head', 'Department Head', 'Full access within their department',            20, true),
  ('coordinator',     'Coordinator',     'Cross-department coordination, read-mostly',     30, true),
  ('liaison',         'Liaison',         'Manages assigned guests and their activities',   40, true),
  ('interpreter',     'Interpreter',     'Assigned to JP guests, limited write access',    45, true),
  ('volunteer',       'Volunteer',       'Task execution, minimal data access',            50, true),
  ('viewer',          'Viewer',          'Read-only access to non-sensitive data',        100, false);
```

**Priority matters:** When a user holds multiple roles, the role with the lowest priority number (highest authority) is used for permission evaluation.

---

## 2. Create User Accounts

Users are linked to roles via the `role_key` column. Each user also has a department, which is used for department-scoped data access.

```sql
-- Admin/director account (first user — use your Firebase Auth email)
INSERT INTO users (email, name, role_key, department)
VALUES ('director@yourcon.org', 'Convention Director', 'director', NULL);

-- Department heads
INSERT INTO users (email, name, role_key, department) VALUES
  ('anime.head@yourcon.org', 'Anime Dept Head', 'department_head', 'Anime'),
  ('gaming.head@yourcon.org', 'Gaming Dept Head', 'department_head', 'Gaming'),
  ('music.head@yourcon.org', 'Music Dept Head', 'department_head', 'Music');

-- Liaisons
INSERT INTO users (email, name, role_key, department) VALUES
  ('liaison.1@yourcon.org', 'Liaison A', 'liaison', 'Anime'),
  ('liaison.2@yourcon.org', 'Liaison B', 'liaison', 'Gaming');

-- Volunteers
INSERT INTO users (email, name, role_key, department) VALUES
  ('volunteer.1@yourcon.org', 'Volunteer A', 'volunteer', 'Anime');
```

---

## 3. Configure Permissions

Each permission row defines what a role can do with a specific concept. The four CRUD booleans (`can_view`, `can_create`, `can_edit`, `can_delete`) gate operations. The `visible_properties` and `editable_properties` arrays control field-level access.

### Director (Full Access)

Directors can do everything on every concept and see all fields.

```sql
-- Director: guests (full CRUD, all fields)
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES ('director', 'guest', true, true, true, true,
  ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling'],
  ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling']
);

-- Director: staff
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES ('director', 'staff', true, true, true, true,
  ARRAY['name','email','role','department','phone','lineId','availability','reportsTo'],
  ARRAY['name','email','role','department','phone','lineId','availability','reportsTo']
);

-- Director: schedule
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES ('director', 'schedule', true, true, true, true,
  ARRAY['name','eventType','startTime','endTime','venue','guestId','status','description'],
  ARRAY['name','eventType','startTime','endTime','venue','guestId','status','description']
);

-- Director: prep items
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES ('director', 'prep', true, true, true, true,
  ARRAY['name','guestId','status','dueDate','owner'],
  ARRAY['name','guestId','status','dueDate','owner']
);

-- Director: pairings
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('director', 'pairing', true, true, true, true,
  ARRAY['guestId','staffId','role']
);

-- Director: transport
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('director', 'transport', true, true, true, true,
  ARRAY['guestId','bookingType','status','pickupLocation','dropoffLocation','scheduledTime','driverName','flightNumber']
);

-- Director: venue
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('director', 'venue', true, true, true, true,
  ARRAY['name','type','capacity','floor','building','equipment','notes']
);

-- Director: contract
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('director', 'contract', true, true, true, true,
  ARRAY['guestId','type','status','signedDate','terms']
);
```

### Department Head (Full Access Within Department)

Department heads can CRUD most things but are scoped to their department (via data scopes in the next section).

```sql
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES ('department_head', 'guest', true, true, true, false,
  ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling'],
  ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES ('department_head', 'staff', true, true, true, false,
  ARRAY['name','email','role','department','phone','lineId','availability','reportsTo'],
  ARRAY['name','email','role','department','phone','lineId','availability','reportsTo']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('department_head', 'schedule', true, true, true, false,
  ARRAY['name','eventType','startTime','endTime','venue','guestId','status','description']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('department_head', 'prep', true, true, true, false,
  ARRAY['name','guestId','status','dueDate','owner']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('department_head', 'pairing', true, true, true, false,
  ARRAY['guestId','staffId','role']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('department_head', 'transport', true, true, true, false,
  ARRAY['guestId','bookingType','status','pickupLocation','dropoffLocation','scheduledTime','driverName','flightNumber']
);
```

### Liaison (Assigned Guests Only)

Liaisons can view and edit their assigned guests, but cannot delete or create new guests. They can create schedule events and prep items.

```sql
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES ('liaison', 'guest', true, false, true, false,
  ARRAY['name','type','department','status','company','interpreterRequired','email','phone','bio','specialHandling'],
  ARRAY['status','bio','specialHandling']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('liaison', 'staff', true, false, false, false,
  ARRAY['name','email','role','department','phone']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('liaison', 'schedule', true, true, true, false,
  ARRAY['name','eventType','startTime','endTime','venue','guestId','status','description']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('liaison', 'prep', true, false, true, false,
  ARRAY['name','guestId','status','dueDate','owner']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('liaison', 'pairing', true, false, false, false,
  ARRAY['guestId','staffId','role']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('liaison', 'transport', true, true, true, false,
  ARRAY['guestId','bookingType','status','pickupLocation','dropoffLocation','scheduledTime','flightNumber']
);
```

### Volunteer (Minimal Access)

Volunteers can view limited guest information and update assigned prep items.

```sql
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('volunteer', 'guest', true, false, false, false,
  ARRAY['name','type','department','status']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('volunteer', 'schedule', true, false, false, false,
  ARRAY['name','eventType','startTime','endTime','venue','status']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties, editable_properties)
VALUES ('volunteer', 'prep', true, false, true, false,
  ARRAY['name','guestId','status','dueDate','owner'],
  ARRAY['status']
);
```

### Viewer (Read-Only)

Viewers can see basic information but cannot modify anything.

```sql
INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('viewer', 'guest', true, false, false, false,
  ARRAY['name','type','department','status','company']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('viewer', 'schedule', true, false, false, false,
  ARRAY['name','eventType','startTime','endTime','venue','status']
);

INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete, visible_properties)
VALUES ('viewer', 'staff', true, false, false, false,
  ARRAY['name','role','department']
);
```

---

## 4. Configure Data Scopes

Data scopes control which rows a role can access. There are four scope types:

| Scope Type | Effect | Use Case |
|------------|--------|----------|
| `all` | No row-level restriction | Directors see everything |
| `department` | Rows where a field matches the user's department | Department heads see only their department's data |
| `relation` | Rows where a relation column references the current user | Liaisons see only guests they are assigned to |
| `field` | Rows where a specific field equals a specific value | Custom scoping |

```sql
-- Director: sees all data (no restriction)
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES ('director', 'guest', 'all');
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES ('director', 'staff', 'all');
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES ('director', 'schedule', 'all');
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES ('director', 'prep', 'all');

-- Department head: department-scoped
INSERT INTO data_scopes (role_key, concept_key, scope_type, field, value)
VALUES ('department_head', 'guest', 'department', 'department', NULL);
-- Note: value=NULL means "use the authenticated user's department at query time"

INSERT INTO data_scopes (role_key, concept_key, scope_type, field, value)
VALUES ('department_head', 'staff', 'department', 'department', NULL);

-- Liaison: relation-scoped (only guests they are paired with)
INSERT INTO data_scopes (role_key, concept_key, scope_type, relation_path)
VALUES ('liaison', 'guest', 'relation', 'pairings.staff');

-- Volunteer: sees all guests (limited fields already restricted by permissions)
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES ('volunteer', 'guest', 'all');
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES ('volunteer', 'schedule', 'all');

-- Viewer: sees all (no write permissions anyway)
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES ('viewer', 'guest', 'all');
INSERT INTO data_scopes (role_key, concept_key, scope_type)
VALUES ('viewer', 'schedule', 'all');
```

---

## 5. Configure Screen Access

Screen access controls which pages appear in the sidebar navigation for each role. This is a UI-level gate only -- server-side RBAC is the real enforcement layer.

```sql
-- Director: all pages visible
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
  ('director', 'canvas', true);

-- Liaison: operational pages only
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('liaison', 'dashboard', true),
  ('liaison', 'guests', true),
  ('liaison', 'schedule', true),
  ('liaison', 'prep-tracker', true),
  ('liaison', 'travel', true),
  ('liaison', 'pairings', true);

-- Volunteer: minimal pages
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('volunteer', 'dashboard', true),
  ('volunteer', 'schedule', true),
  ('volunteer', 'prep-tracker', true);

-- Viewer: read-only pages
INSERT INTO screen_access (role_key, page_slug, visible) VALUES
  ('viewer', 'dashboard', true),
  ('viewer', 'guests', true),
  ('viewer', 'schedule', true);
```

---

## Permission Matrix Summary

| Concept | Director | Dept Head | Coordinator | Liaison | Interpreter | Volunteer | Viewer |
|---------|----------|-----------|-------------|---------|-------------|-----------|--------|
| **Guest** | CRUD + all fields | CRUD (dept) | View all | View+Edit (assigned) | View (assigned) | View (name, status) | View (basic) |
| **Staff** | CRUD + all fields | CRUD (dept) | View all | View (basic) | View (basic) | -- | View (basic) |
| **Schedule** | CRUD | CRUD (dept) | View all | View+Create+Edit | View (assigned) | View | View |
| **Prep Items** | CRUD | CRUD (dept) | View all | View+Edit | -- | Edit status only | -- |
| **Pairings** | CRUD | CRUD (dept) | View | View | View | -- | -- |
| **Transport** | CRUD | CRUD (dept) | View | View+Create+Edit | -- | -- | -- |
| **Venues** | CRUD | View | View | -- | -- | -- | -- |
| **Settings** | Full access | -- | -- | -- | -- | -- | -- |

---

## Verification

```sql
-- Count permissions per role
SELECT role_key, count(*) AS permission_count
FROM permissions
GROUP BY role_key
ORDER BY role_key;

-- Verify a specific permission
SELECT can_view, can_create, can_edit, can_delete, visible_properties
FROM permissions
WHERE role_key = 'volunteer' AND concept_key = 'guest';

-- Verify data scopes
SELECT role_key, concept_key, scope_type, relation_path, field
FROM data_scopes
ORDER BY role_key, concept_key;

-- Test via the API (as director)
curl -H "Authorization: Bearer <token>" \
  http://localhost:8080/api/domains/guest | jq '.data | length'
```

---

## Next Step

[05-build-forms-views.md -- Building Forms and Views](05-build-forms-views.md)
