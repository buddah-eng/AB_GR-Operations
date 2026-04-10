# RBAC for Agents

> How role-based access control constrains agent behavior in GR-Ops.
> Agents are not special. They operate under the same RBAC model as human users.
> This document covers role definitions, permission enforcement, data scoping,
> and how to configure agent identity.

---

## Core Principle

**Agents get roles, not privileges.** Every agent is bound to a user account with a role. The API enforces RBAC on every request, regardless of whether the caller is a human in a browser or an LLM making HTTP calls. There is no "agent mode" or "bypass" -- the same permission checks run for all callers.

---

## 1. Agent Roles

### Director Agent

**Use case:** Full-access operational agent. Setup, configuration, auditing, corrective action across all departments.

| Capability | Access |
|-----------|--------|
| Guest | CRUD all fields, all rows |
| Staff | CRUD all fields, all rows |
| Schedule | CRUD all fields, all rows |
| Prep Items | CRUD all fields, all rows |
| Pairings | CRUD all rows |
| Transport | CRUD all rows |
| Venues | CRUD all rows |
| Contracts | CRUD all rows |
| Config/Settings | Full access |
| Data scope | `all` -- sees everything |

**When to use:** Convention setup, system audits, cross-department coordination, emergency fixes.

**Risk level:** High. A director agent can modify or delete any record. Use with explicit iteration limits and human-in-the-loop confirmation for destructive operations.

```
X-Dev-Email: agent-director@yourcon.org
X-Dev-Role: director
```

### Department Head Agent

**Use case:** Department-scoped management agent. Can manage guests, staff, and schedule within a single department.

| Capability | Access |
|-----------|--------|
| Guest | CRUD, department-filtered rows, all fields |
| Staff | CRUD, department-filtered rows, all fields |
| Schedule | CRUD, department-filtered rows |
| Prep Items | CRUD, department-filtered rows |
| Pairings | CRUD, department-filtered rows |
| Transport | CRUD, department-filtered rows |
| Venues | View only |
| Data scope | `department` -- only rows matching user's department |

**When to use:** Department-specific gap analysis, staff assignment within a department, prep tracking for department guests.

```
X-Dev-Email: agent-anime-head@yourcon.org
X-Dev-Role: department_head
```

### Liaison Agent

**Use case:** Guest-specific operations agent. Manages prep, transport, and schedule for assigned guests only.

| Capability | Access |
|-----------|--------|
| Guest | View + Edit assigned guests only; editable fields limited to: status, bio, specialHandling |
| Staff | View basic info (name, email, role, department, phone) |
| Schedule | View + Create + Edit |
| Prep Items | View + Edit status only |
| Pairings | View only (their own) |
| Transport | View + Create + Edit |
| Data scope | `relation` -- only guests paired with this user via pairings table |

**When to use:** Per-guest operational workflows, guest relations monitoring, prep tracking for assigned guests.

**Important:** A liaison agent can only see guests it is paired with. If you create a liaison agent, you must first create pairing records linking the agent's user account to the relevant guests.

```
X-Dev-Email: agent-liaison-anime@yourcon.org
X-Dev-Role: liaison
```

### Volunteer Agent

**Use case:** Task execution agent with minimal access. Can view basic guest info and update prep item status.

| Capability | Access |
|-----------|--------|
| Guest | View only: name, type, department, status |
| Staff | No access |
| Schedule | View only: name, eventType, startTime, endTime, venue, status |
| Prep Items | View all + Edit status field only |
| Pairings | No access |
| Transport | No access |
| Data scope | `all` (but field-filtered -- only sees non-sensitive fields) |

**When to use:** Automated prep item status updates, schedule monitoring, simple reporting.

```
X-Dev-Email: agent-volunteer@yourcon.org
X-Dev-Role: volunteer
```

### Viewer Agent

**Use case:** Read-only monitoring and reporting agent. Cannot modify anything.

| Capability | Access |
|-----------|--------|
| Guest | View only: name, type, department, status, company |
| Staff | View only: name, role, department |
| Schedule | View only: name, eventType, startTime, endTime, venue, status |
| Prep Items | No access |
| Data scope | `all` (heavily field-filtered) |

**When to use:** Dashboard monitoring, report generation, status aggregation.

```
X-Dev-Email: agent-viewer@yourcon.org
X-Dev-Role: viewer
```

---

## 2. Setting Up an Agent User

Each agent needs a user account in the GR-Ops database. Create it via SQL or the admin API:

### Via SQL

```sql
INSERT INTO users (email, name, role_key, department)
VALUES (
  'agent-liaison-anime@yourcon.org',
  'Anime Liaison Agent',
  'liaison',
  'Anime'
);
```

### Key Fields

| Field | Purpose | Example |
|-------|---------|---------|
| `email` | Unique identifier, used in `X-Dev-Email` header | `agent-liaison-anime@yourcon.org` |
| `name` | Display name for audit logs | `Anime Liaison Agent` |
| `role_key` | References the `roles` table, determines permissions | `liaison` |
| `department` | Used for department-scoped data access | `Anime` |

### For Liaison Agents: Create Pairings

A liaison agent can only see guests it is paired with. After creating the user, you must create pairing records:

```sql
-- Find the staff record for this agent (or create one)
INSERT INTO staff (name, email, role_key, department, phone, properties, staff_type)
VALUES ('Anime Liaison Agent', 'agent-liaison-anime@yourcon.org', 'liaison', 'Anime', '', '{}', 'staff')
RETURNING id;

-- Pair the agent-staff with each guest it should manage
INSERT INTO pairings (guest_id, staff_id, role)
VALUES
  ('<guest-uuid-1>', '<agent-staff-uuid>', 'Main Liaison'),
  ('<guest-uuid-2>', '<agent-staff-uuid>', 'Main Liaison');
```

---

## 3. How RBAC Is Enforced

### Request Flow

```
Agent sends HTTP request
    |
    v
API reads X-Dev-Email and X-Dev-Role headers
    |
    v
Resolve user record from email
    |
    v
Load permissions for role_key + concept_key
    |
    +-- can_view / can_create / can_edit / can_delete
    |
    v
Apply data scope (all / department / relation)
    |
    +-- Filter rows the user can access
    |
    v
Apply field filter (visible_properties / editable_properties)
    |
    +-- Strip non-visible fields from response
    +-- Reject edits to non-editable fields
    |
    v
Return filtered response
```

### Three Layers of Enforcement

#### Layer 1: CRUD Gates

Each permission row has four booleans:

```sql
SELECT can_view, can_create, can_edit, can_delete
FROM permissions
WHERE role_key = 'liaison' AND concept_key = 'guest';
-- Returns: true, false, true, false
-- Liaison can VIEW and EDIT guests, but cannot CREATE or DELETE
```

If the gate is `false`, the API returns `403 Forbidden`.

#### Layer 2: Data Scoping (Row-Level)

Data scopes control which rows a role can access:

| Scope Type | SQL Equivalent | Example |
|-----------|----------------|---------|
| `all` | No WHERE clause | Director sees all guests |
| `department` | `WHERE department = user.department` | Dept head sees only their department's guests |
| `relation` | `WHERE id IN (SELECT guest_id FROM pairings WHERE staff_id = user.staff_id)` | Liaison sees only paired guests |
| `field` | `WHERE field = value` | Custom scoping |

The scope is applied transparently -- the agent receives only the rows it is authorized to see.

#### Layer 3: Field Filtering (Column-Level)

Each permission row defines which fields are visible and which are editable:

```sql
-- Volunteer can see these guest fields:
visible_properties = ARRAY['name', 'type', 'department', 'status']

-- Volunteer cannot edit any guest fields (no editable_properties defined)
```

Fields not in `visible_properties` are stripped from the API response. Attempts to write fields not in `editable_properties` are silently ignored or rejected.

---

## 4. Permission Matrix

Complete permission matrix for all agent roles:

### Guest Concept

| Operation | Director | Dept Head | Liaison | Volunteer | Viewer |
|-----------|----------|-----------|---------|-----------|--------|
| View | All fields, all rows | All fields, dept rows | All fields, assigned rows | name/type/dept/status, all rows | name/type/dept/status/company, all rows |
| Create | Yes | Yes (dept) | No | No | No |
| Edit | All fields | All fields (dept) | status/bio/specialHandling (assigned) | No | No |
| Delete | Yes | No | No | No | No |

### Staff Concept

| Operation | Director | Dept Head | Liaison | Volunteer | Viewer |
|-----------|----------|-----------|---------|-----------|--------|
| View | All fields | All fields (dept) | name/email/role/dept/phone | No | name/role/dept |
| Create | Yes | Yes (dept) | No | No | No |
| Edit | All fields | All fields (dept) | No | No | No |
| Delete | Yes | No | No | No | No |

### Schedule Concept

| Operation | Director | Dept Head | Liaison | Volunteer | Viewer |
|-----------|----------|-----------|---------|-----------|--------|
| View | All | All (dept) | All | name/type/time/venue/status | name/type/time/venue/status |
| Create | Yes | Yes (dept) | Yes | No | No |
| Edit | Yes | Yes (dept) | Yes | No | No |
| Delete | Yes | No | No | No | No |

### Prep Items Concept

| Operation | Director | Dept Head | Liaison | Volunteer | Viewer |
|-----------|----------|-----------|---------|-----------|--------|
| View | All | All (dept) | All (assigned guests) | All | No |
| Create | Yes | Yes (dept) | No | No | No |
| Edit | All fields | All fields (dept) | Status only | Status only | No |
| Delete | Yes | No | No | No | No |

### Pairings Concept

| Operation | Director | Dept Head | Liaison | Volunteer | Viewer |
|-----------|----------|-----------|---------|-----------|--------|
| View | All | All (dept) | Own pairings | No | No |
| Create | Yes | Yes (dept) | No | No | No |
| Edit | Yes | Yes (dept) | No | No | No |
| Delete | Yes | No | No | No | No |

### Transport Concept

| Operation | Director | Dept Head | Liaison | Volunteer | Viewer |
|-----------|----------|-----------|---------|-----------|--------|
| View | All | All (dept) | Assigned guests | No | No |
| Create | Yes | Yes (dept) | Yes | No | No |
| Edit | Yes | Yes (dept) | Yes | No | No |
| Delete | Yes | No | No | No | No |

---

## 5. Choosing the Right Role for Your Agent

Follow the principle of least privilege:

| Agent Task | Recommended Role | Why |
|-----------|-----------------|-----|
| Full convention setup | `director` | Needs CRUD on all concepts |
| Department operations | `department_head` | Scoped to one department |
| Guest monitoring and prep | `liaison` | Only needs assigned guests |
| Prep status updates | `volunteer` | Only needs to update prep status |
| Dashboard reporting | `viewer` | Read-only is sufficient |
| Cross-department audit | `coordinator` | Read access across departments |
| Schedule conflict detection | `coordinator` | Read-only schedule access |
| Transport audit | `coordinator` | Read-only transport access |

### Decision Tree

```
Does the agent need to CREATE records?
  |
  +-- Yes: Does it need to create across departments?
  |         +-- Yes: director
  |         +-- No: department_head
  |
  +-- No: Does the agent need to EDIT records?
           +-- Yes: What records?
           |         +-- Prep status only: volunteer
           |         +-- Assigned guest data: liaison
           |         +-- Department data: department_head
           |
           +-- No: viewer
```

---

## 6. Security Considerations

### Agent API Keys

In production, replace the dev headers with proper authentication:

| Environment | Authentication Method |
|-------------|---------------------|
| Development | `X-Dev-Email` + `X-Dev-Role` headers |
| Production | Firebase Auth JWT token (contains role claim) |

For production agents, create a Firebase service account, assign it a role, and use the JWT token in the `Authorization: Bearer <token>` header.

### Audit Trail

All agent actions are logged. The audit trail records:
- Timestamp
- User email (agent identity)
- Role
- Action (CRUD operation)
- Concept and record ID
- Before/after values (for updates)

### Rate Limiting

Agents should self-rate-limit to avoid overwhelming the API:
- Maximum 10 requests per second
- Maximum 100 requests per minute
- Add exponential backoff on 429 (Too Many Requests) responses

### Data Sensitivity

Some fields contain PII (personally identifiable information):
- Guest email, phone, dietary requirements
- Staff email, phone

Agents operating under `volunteer` or `viewer` roles cannot see these fields (filtered by `visible_properties`). Director and liaison agents can see PII -- ensure agent logs do not persist PII unnecessarily.

---

## 7. Testing Agent Permissions

Verify your agent's effective permissions by calling the API and checking the response:

```bash
# Test what a liaison sees for guests
curl -X POST https://your-grops.vercel.app/api/action \
  -H "Content-Type: application/json" \
  -H "X-Dev-Email: agent-liaison-anime@yourcon.org" \
  -H "X-Dev-Role: liaison" \
  -d '{"action": "getGuestList"}'

# Verify: Response should only contain guests paired with this liaison
# Verify: Each guest record should contain all visible fields for liaison role

# Test that a volunteer cannot create a guest
curl -X POST https://your-grops.vercel.app/api/domains/guest \
  -H "Content-Type: application/json" \
  -H "X-Dev-Email: agent-volunteer@yourcon.org" \
  -H "X-Dev-Role: volunteer" \
  -d '{"name": "Test Guest", "type": "NA", "department": "Anime"}'

# Expected: 403 Forbidden (volunteer has can_create=false for guest)
```

### Permission Check Endpoint

Use the `getUserRole` action to verify the agent's effective role:

```bash
curl -X POST https://your-grops.vercel.app/api/action \
  -H "Content-Type: application/json" \
  -H "X-Dev-Email: agent-liaison-anime@yourcon.org" \
  -H "X-Dev-Role: liaison" \
  -d '{"action": "getUserRole"}'

# Response: {"success": true, "data": {"role": "director"}}
# Note: In demo mode, this always returns "director".
# In production, it returns the authenticated user's actual role.
```
