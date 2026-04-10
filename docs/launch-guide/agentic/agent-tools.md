# Agent Tool Definitions

> Every GR-Ops API endpoint defined as a callable agent tool.
> Each tool includes name, description, parameters, response shape, and required role.
> Definitions are compatible with OpenAI function calling, Anthropic tool use, and MCP tool schemas.

---

## Response Envelope

All endpoints return this envelope:

```json
{
  "success": true,
  "data": "<tool-specific response>",
  "error": "<string, only when success=false>"
}
```

Agents should always check `success` before processing `data`.

---

## Authentication Headers

Every request must include:

```
Content-Type: application/json
X-Dev-Email: <agent-user-email>
X-Dev-Role: <role-key>
```

The `X-Dev-Role` determines what the agent can see and do. See `agent-rbac.md` for details.

---

## Tool Catalog

### 1. `list_guests`

Retrieve all guests with summary stats (staff count, prep completion).

**Endpoint:** `POST /api/action`
**Body:** `{"action": "getGuestList"}`
**Required role:** `viewer` or higher

```json
{
  "name": "list_guests",
  "description": "Returns all guests with summary statistics including staff assignment count and prep completion percentage. Use this to get an overview of all guests and identify gaps.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": [
    {
      "guestId": "uuid",
      "id": "uuid",
      "name": "Tanaka Ichiro",
      "type": "JP",
      "department": "Anime",
      "status": "Confirmed",
      "company": "Sunrise Studios",
      "interpreterRequired": true,
      "bio": "...",
      "staffCount": 2,
      "prepPercent": 60,
      "prepTotal": 5,
      "prepComplete": 3,
      "rowVersion": 0
    }
  ]
}
```

---

### 2. `get_guest_detail`

Retrieve full guest profile including pairings, schedule, prep items, and transport.

**Endpoint:** `POST /api/action`
**Body:** `{"action": "getGuestDetail", "params": {"guestId": "<uuid>"}}`
**Required role:** `volunteer` or higher (field visibility varies by role)

```json
{
  "name": "get_guest_detail",
  "description": "Returns the complete profile for a single guest, including their staff pairings, schedule events, prep checklist items, and transport bookings. Use this after list_guests to drill into a specific guest.",
  "parameters": {
    "type": "object",
    "properties": {
      "guestId": {
        "type": "string",
        "description": "UUID of the guest to retrieve"
      }
    },
    "required": ["guestId"]
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": {
    "guest": {
      "id": "uuid",
      "name": "Tanaka Ichiro",
      "type": "JP",
      "department": "Anime",
      "status": "Confirmed",
      "company": "Sunrise Studios",
      "interpreterRequired": true,
      "bio": "...",
      "dietary": "None",
      "pronouns": "he/him"
    },
    "pairings": [
      {
        "pairingId": "uuid",
        "staffId": "uuid",
        "staffName": "Kevin Nakamura",
        "staffEmail": "kevin@animeboston.org",
        "role": "Main Liaison",
        "rowVersion": 0
      }
    ],
    "schedule": [
      {
        "eventId": "uuid",
        "activity": "Voice Acting Masterclass",
        "eventType": "Panel",
        "date": "2026-04-03",
        "startTime": "13:00",
        "endTime": "14:30",
        "venue": "Panel Room 1",
        "status": "Confirmed"
      }
    ],
    "prepTracker": [
      {
        "prep_id": "uuid",
        "item": "Confirm flight itinerary",
        "status": "Complete",
        "guestName": "Tanaka Ichiro",
        "owner": "Kevin Nakamura",
        "dueDate": "2026-03-15"
      }
    ],
    "travel": [
      {
        "id": "uuid",
        "bookingType": "arrival",
        "status": "Confirmed",
        "pickupLocation": "Boston Logan Airport (Terminal E)",
        "dropoffLocation": "Sheraton Boston Hotel",
        "scheduledTime": "2026-04-02T15:30:00",
        "driverName": "Mike Sullivan",
        "flightNumber": "NH7010"
      }
    ],
    "violations": [],
    "accommodations": [],
    "dietary": [],
    "autographs": []
  }
}
```

---

### 3. `create_guest`

Create a new guest record.

**Endpoint:** `POST /api/domains/guest`
**Required role:** `department_head` or higher

```json
{
  "name": "create_guest",
  "description": "Creates a new guest record. Required fields: name, type, department. Status defaults to 'draft'. Use this when onboarding a new convention guest.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Full name of the guest"
      },
      "type": {
        "type": "string",
        "enum": ["JP", "NA", "Industry"],
        "description": "Guest type: JP (Japanese), NA (North American), Industry"
      },
      "department": {
        "type": "string",
        "enum": ["Anime", "Gaming", "Music", "Cosplay", "Panels", "Artists", "Industry"],
        "description": "Department this guest belongs to"
      },
      "status": {
        "type": "string",
        "enum": ["draft", "invited", "confirmed", "travel_arranged", "arrived", "cancelled"],
        "description": "Guest status. Defaults to 'draft'"
      },
      "company": {
        "type": "string",
        "description": "Company or agency affiliation"
      },
      "properties": {
        "type": "object",
        "description": "Additional properties stored as JSONB",
        "properties": {
          "interpreter_required": {"type": "boolean"},
          "bio": {"type": "string"},
          "dietary": {"type": "string"},
          "pronouns": {"type": "string"}
        }
      }
    },
    "required": ["name", "type", "department"]
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "New Guest",
    "type": "NA",
    "department": "Anime",
    "status": "draft"
  }
}
```

---

### 4. `update_guest`

Update an existing guest record.

**Endpoint:** `PUT /api/domains/guest/{id}`
**Required role:** `liaison` or higher (editable fields vary by role)

```json
{
  "name": "update_guest",
  "description": "Updates fields on an existing guest record. Only include the fields you want to change. Liaisons can only edit status, bio, and specialHandling.",
  "parameters": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "UUID of the guest to update"
      },
      "name": {"type": "string"},
      "type": {"type": "string", "enum": ["JP", "NA", "Industry"]},
      "department": {"type": "string"},
      "status": {"type": "string", "enum": ["draft", "invited", "confirmed", "travel_arranged", "arrived", "cancelled"]},
      "company": {"type": "string"},
      "properties": {
        "type": "object",
        "properties": {
          "interpreter_required": {"type": "boolean"},
          "bio": {"type": "string"},
          "dietary": {"type": "string"},
          "pronouns": {"type": "string"}
        }
      }
    },
    "required": ["id"]
  }
}
```

---

### 5. `list_staff`

Retrieve all staff members.

**Endpoint:** `POST /api/action`
**Body:** `{"action": "getStaffList"}`
**Required role:** `liaison` or higher

```json
{
  "name": "list_staff",
  "description": "Returns all convention staff members with their roles, departments, and contact info. Use this to find available liaisons, interpreters, or coordinators for assignment.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": [
    {
      "staffId": "uuid",
      "id": "uuid",
      "name": "Kevin Nakamura",
      "email": "kevin@animeboston.org",
      "role": "Liaison",
      "department": "Anime",
      "phone": "617-555-0102",
      "availability": "Available",
      "rowVersion": 0
    }
  ]
}
```

---

### 6. `create_pairing`

Assign a staff member to a guest with a specific role.

**Endpoint:** `POST /api/domains/pairing`
**Required role:** `department_head` or higher

```json
{
  "name": "create_pairing",
  "description": "Creates a staff-to-guest assignment. Each pairing has a role: Main Liaison, Backup Liaison, Interpreter, or Security Escort. Use this to assign staff to guests.",
  "parameters": {
    "type": "object",
    "properties": {
      "guest_id": {
        "type": "string",
        "description": "UUID of the guest"
      },
      "staff_id": {
        "type": "string",
        "description": "UUID of the staff member"
      },
      "role": {
        "type": "string",
        "enum": ["Main Liaison", "Backup Liaison", "Interpreter", "Security Escort"],
        "description": "The role this staff member plays for this guest"
      }
    },
    "required": ["guest_id", "staff_id", "role"]
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "guest_id": "uuid",
    "staff_id": "uuid",
    "role": "Main Liaison"
  }
}
```

---

### 7. `list_schedule`

Retrieve all schedule events with guest and venue information.

**Endpoint:** `POST /api/action`
**Body:** `{"action": "getScheduleList"}`
**Required role:** `volunteer` or higher

```json
{
  "name": "list_schedule",
  "description": "Returns all scheduled convention events with guest names, venues, times, and statuses. Each row is a guest-event combination -- multi-guest events produce multiple rows. Use this for schedule overview and conflict detection.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": [
    {
      "eventId": "uuid",
      "id": "uuid",
      "activity": "Opening Ceremony",
      "eventType": "Panel",
      "date": "2026-04-03",
      "startTime": "10:00",
      "endTime": "11:00",
      "venue": "Main Events Hall A",
      "guestId": "uuid",
      "guestName": "Tanaka Ichiro",
      "status": "Confirmed",
      "rowVersion": 0
    }
  ]
}
```

---

### 8. `create_event`

Create a new schedule event.

**Endpoint:** `POST /api/domains/schedule`
**Required role:** `liaison` or higher

```json
{
  "name": "create_event",
  "description": "Creates a new schedule event. Requires activity name, event type, date, and time. Optionally assign a venue and guest. Use this to add panels, autograph sessions, meals, or other events to the convention schedule.",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Activity name (e.g., 'VA Panel with Tanaka')"
      },
      "event_type": {
        "type": "string",
        "enum": ["Panel", "Autograph Session", "Photo Op", "Meal", "Photoshoot", "Interview", "Rehearsal", "Meet & Greet", "Other"],
        "description": "Type of event"
      },
      "date": {
        "type": "string",
        "description": "Event date in YYYY-MM-DD format"
      },
      "start_time": {
        "type": "string",
        "description": "Start time in HH:MM format (24-hour)"
      },
      "end_time": {
        "type": "string",
        "description": "End time in HH:MM format (24-hour)"
      },
      "venue_id": {
        "type": "string",
        "description": "UUID of the venue (from get_config venues list)"
      },
      "status": {
        "type": "string",
        "enum": ["draft", "confirmed", "cancelled"],
        "description": "Event status. Defaults to 'draft'"
      }
    },
    "required": ["name", "event_type", "date", "start_time", "end_time"]
  }
}
```

---

### 9. `list_prep_items`

Retrieve all prep items across all guests.

**Endpoint:** `POST /api/action`
**Body:** `{"action": "getPrepItems"}`
**Required role:** `volunteer` or higher

```json
{
  "name": "list_prep_items",
  "description": "Returns all pre-convention preparation items with their status, due dates, owners, and associated guest names. Use this to track prep completion and identify overdue items.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "label": "Confirm flight itinerary",
      "guestName": "Tanaka Ichiro",
      "guestId": "uuid",
      "dueDate": "2026-03-15",
      "status": "Complete",
      "owner": "Kevin Nakamura"
    }
  ]
}
```

---

### 10. `update_prep_item`

Update a prep item's status or other fields.

**Endpoint:** `PUT /api/domains/prep/{id}`
**Required role:** `volunteer` or higher (volunteers can only update `status`)

```json
{
  "name": "update_prep_item",
  "description": "Updates a prep item. Most commonly used to change status to 'complete', 'in_progress', or 'incomplete'. Volunteers can only update the status field.",
  "parameters": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "UUID of the prep item to update"
      },
      "status": {
        "type": "string",
        "enum": ["incomplete", "in_progress", "complete"],
        "description": "New status for the prep item"
      },
      "name": {
        "type": "string",
        "description": "Task name"
      },
      "due_date": {
        "type": "string",
        "description": "Due date in YYYY-MM-DD format"
      },
      "properties": {
        "type": "object",
        "properties": {
          "owner": {"type": "string", "description": "Name of the person responsible"}
        }
      }
    },
    "required": ["id"]
  }
}
```

---

### 11. `get_dashboard`

Retrieve the operational dashboard summary.

**Endpoint:** `POST /api/action`
**Body:** `{"action": "getDashboardData"}`
**Required role:** `volunteer` or higher

```json
{
  "name": "get_dashboard",
  "description": "Returns a comprehensive operational summary: guest counts by status and department, prep completion stats including overdue count, schedule overview with today's events, and staffing coverage showing which guests lack liaisons or interpreters. This is the primary observation tool -- start every agent loop here.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": {
    "guests": {
      "total": 12,
      "confirmed": 8,
      "byStatus": {"Confirmed": 6, "Travel Arranged": 2, "Invited": 1, "Draft": 1, "Arrived": 2},
      "byDepartment": {"Anime": 3, "Music": 3, "Industry": 2, "Cosplay": 1, "Gaming": 1, "Panels": 1, "Artists": 1}
    },
    "schedule": {
      "total": 17,
      "confirmed": 17,
      "todayEvents": [
        {
          "eventId": "uuid",
          "activity": "Opening Ceremony",
          "eventType": "Panel",
          "startTime": "10:00",
          "endTime": "11:00",
          "guestName": "Tanaka Ichiro",
          "venue": "Main Events Hall A",
          "status": "Confirmed"
        }
      ],
      "byType": {"Panel": 10, "Autograph Session": 2, "Other": 3, "Meal": 1, "Interview": 1}
    },
    "prep": {
      "total": 60,
      "completed": 35,
      "percentComplete": 58,
      "overdue": 3,
      "inProgress": 8
    },
    "staffing": {
      "total": 20,
      "guestsWithLiaison": 9,
      "coverage": [
        {
          "guestId": "uuid",
          "guestName": "Tanaka Ichiro",
          "hasLiaison": true,
          "interpreterRequired": true,
          "hasInterpreter": true
        }
      ]
    },
    "violations": {"total": 0, "items": []},
    "pendingChanges": {"total": 0, "items": []}
  }
}
```

---

### 12. `get_ontology`

Retrieve the full data model definition.

**Endpoint:** `GET /api/ontology`
**Required role:** `viewer` or higher

```json
{
  "name": "get_ontology",
  "description": "Returns the complete ontology: all concepts (entity types), their properties (fields), and relationships (connections between concepts). Use this to understand what data exists in the system and how it is structured. Essential for setup agents.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": {
    "version": "1.0.0",
    "concepts": [
      {
        "key": "guest",
        "label": "Guest",
        "pluralLabel": "Guests",
        "icon": "pi pi-users",
        "description": "Invited convention guests",
        "properties": [
          {
            "key": "name",
            "label": "Guest Name",
            "type": "text",
            "required": true,
            "sortOrder": 1,
            "options": null
          },
          {
            "key": "type",
            "label": "Guest Type",
            "type": "select",
            "required": true,
            "sortOrder": 2,
            "options": [
              {"value": "JP", "label": "Japanese"},
              {"value": "NA", "label": "North American"},
              {"value": "Industry", "label": "Industry"}
            ]
          }
        ],
        "relationships": [
          {
            "key": "has_pairings",
            "label": "Staff Assignments",
            "targetConcept": "pairing",
            "cardinality": "has-many",
            "inverseKey": "for_guest"
          }
        ]
      }
    ]
  }
}
```

---

### 13. `get_config`

Retrieve convention configuration data.

**Endpoint:** `GET /api/config`
**Required role:** `viewer` or higher

```json
{
  "name": "get_config",
  "description": "Returns convention configuration: departments, roles, event types, venues, and convention metadata (name, dates, venue). Use this to get valid option values for creating/updating records.",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

**Response shape:**
```json
{
  "success": true,
  "data": {
    "departments": [
      {"department_name": "Anime"},
      {"department_name": "Gaming"}
    ],
    "roles": [
      {"role_name": "Director", "key": "director", "priority": 100}
    ],
    "eventTypes": [
      {"type_name": "Panel"},
      {"type_name": "Autograph Session"}
    ],
    "venues": [
      {"venue_name": "Main Events Hall A", "id": "uuid", "type": "ballroom", "capacity": 1200}
    ],
    "convention": {
      "name": "Anime Boston 2026",
      "startDate": "2026-04-03",
      "endDate": "2026-04-05",
      "venue": "Hynes Convention Center"
    }
  }
}
```

---

## Combined Tool Array (Copy-Paste Ready)

For LLM function calling registration, use this complete array:

```json
[
  {
    "name": "list_guests",
    "description": "Returns all guests with summary statistics including staff assignment count and prep completion percentage.",
    "parameters": {"type": "object", "properties": {}, "required": []}
  },
  {
    "name": "get_guest_detail",
    "description": "Returns the complete profile for a single guest including pairings, schedule, prep items, and transport.",
    "parameters": {
      "type": "object",
      "properties": {
        "guestId": {"type": "string", "description": "UUID of the guest"}
      },
      "required": ["guestId"]
    }
  },
  {
    "name": "create_guest",
    "description": "Creates a new guest record with name, type, and department.",
    "parameters": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "type": {"type": "string", "enum": ["JP", "NA", "Industry"]},
        "department": {"type": "string", "enum": ["Anime", "Gaming", "Music", "Cosplay", "Panels", "Artists", "Industry"]},
        "status": {"type": "string", "enum": ["draft", "invited", "confirmed", "travel_arranged", "arrived", "cancelled"]},
        "company": {"type": "string"},
        "properties": {"type": "object"}
      },
      "required": ["name", "type", "department"]
    }
  },
  {
    "name": "update_guest",
    "description": "Updates fields on an existing guest record.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "type": {"type": "string"},
        "department": {"type": "string"},
        "status": {"type": "string"},
        "company": {"type": "string"},
        "properties": {"type": "object"}
      },
      "required": ["id"]
    }
  },
  {
    "name": "list_staff",
    "description": "Returns all staff members with roles, departments, and contact info.",
    "parameters": {"type": "object", "properties": {}, "required": []}
  },
  {
    "name": "create_pairing",
    "description": "Assigns a staff member to a guest with a role (Main Liaison, Backup Liaison, Interpreter, Security Escort).",
    "parameters": {
      "type": "object",
      "properties": {
        "guest_id": {"type": "string"},
        "staff_id": {"type": "string"},
        "role": {"type": "string", "enum": ["Main Liaison", "Backup Liaison", "Interpreter", "Security Escort"]}
      },
      "required": ["guest_id", "staff_id", "role"]
    }
  },
  {
    "name": "list_schedule",
    "description": "Returns all scheduled events with guest names, venues, times, and statuses.",
    "parameters": {"type": "object", "properties": {}, "required": []}
  },
  {
    "name": "create_event",
    "description": "Creates a new schedule event (panel, autograph session, meal, etc.).",
    "parameters": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "event_type": {"type": "string", "enum": ["Panel", "Autograph Session", "Photo Op", "Meal", "Photoshoot", "Interview", "Rehearsal", "Meet & Greet", "Other"]},
        "date": {"type": "string"},
        "start_time": {"type": "string"},
        "end_time": {"type": "string"},
        "venue_id": {"type": "string"},
        "status": {"type": "string", "enum": ["draft", "confirmed", "cancelled"]}
      },
      "required": ["name", "event_type", "date", "start_time", "end_time"]
    }
  },
  {
    "name": "list_prep_items",
    "description": "Returns all prep items with status, due dates, owners, and guest names.",
    "parameters": {"type": "object", "properties": {}, "required": []}
  },
  {
    "name": "update_prep_item",
    "description": "Updates a prep item, typically to change its status to complete/in_progress/incomplete.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": {"type": "string"},
        "status": {"type": "string", "enum": ["incomplete", "in_progress", "complete"]},
        "name": {"type": "string"},
        "due_date": {"type": "string"},
        "properties": {"type": "object"}
      },
      "required": ["id"]
    }
  },
  {
    "name": "get_dashboard",
    "description": "Returns operational summary: guest counts, prep stats, schedule overview, staffing coverage. Start every agent loop here.",
    "parameters": {"type": "object", "properties": {}, "required": []}
  },
  {
    "name": "get_ontology",
    "description": "Returns the complete data model: concepts, properties, relationships.",
    "parameters": {"type": "object", "properties": {}, "required": []}
  },
  {
    "name": "get_config",
    "description": "Returns convention config: departments, roles, event types, venues, convention metadata.",
    "parameters": {"type": "object", "properties": {}, "required": []}
  }
]
```

---

## Tool-to-Endpoint Routing Table

Quick reference for implementing the HTTP client:

| Tool Name | Method | Path | Body |
|-----------|--------|------|------|
| `list_guests` | POST | `/api/action` | `{"action": "getGuestList"}` |
| `get_guest_detail` | POST | `/api/action` | `{"action": "getGuestDetail", "params": {"guestId": "..."}}` |
| `create_guest` | POST | `/api/domains/guest` | `{name, type, department, ...}` |
| `update_guest` | PUT | `/api/domains/guest/{id}` | `{fields to update}` |
| `list_staff` | POST | `/api/action` | `{"action": "getStaffList"}` |
| `create_pairing` | POST | `/api/domains/pairing` | `{guest_id, staff_id, role}` |
| `list_schedule` | POST | `/api/action` | `{"action": "getScheduleList"}` |
| `create_event` | POST | `/api/domains/schedule` | `{name, event_type, date, ...}` |
| `list_prep_items` | POST | `/api/action` | `{"action": "getPrepItems"}` |
| `update_prep_item` | PUT | `/api/domains/prep/{id}` | `{status, ...}` |
| `get_dashboard` | POST | `/api/action` | `{"action": "getDashboardData"}` |
| `get_ontology` | GET | `/api/ontology` | -- |
| `get_config` | GET | `/api/config` | -- |
