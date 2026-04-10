# Agentic Architecture

> How LLM agents interact with GR-Ops to run convention operations autonomously.

---

## What This Document Covers

GR-Ops is an API-first platform. Every operation available in the web UI is also available via REST endpoints. This makes GR-Ops a natural target for LLM agents that can observe the system state, decide what to do, take action, verify the result, and repeat.

This document defines:
1. How an agent connects to GR-Ops
2. The for-loop execution pattern
3. How RBAC constrains agent behavior
4. The tool and prompt architecture

---

## The Agent Interaction Model

An LLM agent interacts with GR-Ops through two surfaces:

### REST API (Primary)

The agent calls GR-Ops HTTP endpoints directly. Two endpoint styles exist:

| Style | Pattern | Example |
|-------|---------|---------|
| **Domain CRUD** | `GET/POST/PUT/DELETE /api/domains/{concept}[/{id}]` | `GET /api/domains/guest` |
| **Action RPC** | `POST /api/action` with `{action, params}` body | `{action: "getDashboardData"}` |

Domain CRUD endpoints handle structured read/write operations. Action endpoints handle complex queries that join across tables (dashboard, guest detail, schedule list).

### MCP Surface (Future)

When an MCP server wraps the REST API, agents can use MCP tool calling. The tool definitions in `agent-tools.md` are already formatted for both OpenAI function calling and Anthropic tool use, which map directly to MCP tool schemas.

---

## The For-Loop Pattern

The core execution model is: **LLM in a for loop with tools and prompts.**

```
while not done:
    observation = call_tool("get_dashboard")   # OBSERVE
    plan = llm.think(observation, goal)         # DECIDE
    result = call_tool(plan.next_action)        # ACT
    verification = call_tool("verify_result")   # VERIFY
    done = llm.evaluate(verification, goal)     # CHECK
```

### Concrete Example: Gap Analysis

```
1. OBSERVE  -> get_dashboard()       -> {guests: 12, guestsWithLiaison: 9}
2. DECIDE   -> "3 guests missing liaisons, need to find and assign them"
3. ACT      -> list_guests()         -> identify the 3 unassigned guests
4. ACT      -> list_staff()          -> find available liaisons
5. ACT      -> create_pairing()      -> assign liaison to guest #1
6. VERIFY   -> get_dashboard()       -> {guestsWithLiaison: 10}
7. REPEAT   -> still 2 gaps, continue...
8. ACT      -> create_pairing()      -> assign liaison to guest #2
9. ACT      -> create_pairing()      -> assign liaison to guest #3
10. VERIFY  -> get_dashboard()       -> {guestsWithLiaison: 12}
11. DONE    -> all guests have liaisons
```

### Loop Invariants

Every agent loop must maintain these invariants:

| Invariant | Enforcement |
|-----------|-------------|
| Agent operates within its RBAC role | API rejects unauthorized operations |
| Agent verifies after every write | Re-read the affected data after mutation |
| Agent terminates on success criteria | Defined in the prompt template |
| Agent terminates on max iterations | Hardcoded safety limit (e.g., 50 iterations) |
| Agent logs every action taken | Append to action log for audit trail |

---

## RBAC Scoping for Agents

Agents do not get special access. They operate under the same RBAC model as human users. Each agent is assigned a role, and that role determines:

| Constraint | How It Works |
|------------|--------------|
| **CRUD gates** | Can this role create/read/update/delete this concept? |
| **Data scoping** | Which rows can this role see? (all, department, relation) |
| **Field filtering** | Which columns are visible/editable for this role? |

### Role-to-Agent Mapping

| Role | Agent Use Case | Access Level |
|------|---------------|--------------|
| `director` | Full-access operational agent, setup agent | All concepts, all rows, all fields |
| `department_head` | Department-scoped coordination agent | All concepts, department-filtered rows |
| `liaison` | Guest relations agent for assigned guests | Guests (assigned only), prep, transport, schedule |
| `volunteer` | Task execution agent | Read-only guests, update prep item status only |
| `viewer` | Monitoring/reporting agent | Read-only access to non-sensitive data |

### How RBAC Is Enforced

The API uses two headers for agent identity:

```
X-Dev-Email: agent-liaison-anime@yourcon.org
X-Dev-Role: liaison
```

The server resolves the user record from the email, checks permissions against the requested concept, applies data scopes, and filters response fields. An agent with `liaison` role calling `GET /api/domains/guest` will only see guests it is paired with, and only the fields defined in the liaison's `visible_properties` array.

---

## Tool Definitions

Each API endpoint is defined as a callable tool with:
- **Name**: A snake_case identifier (e.g., `list_guests`)
- **Description**: What the tool does and when to use it
- **Parameters**: JSON schema for the request
- **Response**: JSON schema for the response
- **Required role**: Minimum role needed to call this tool

See `agent-tools.md` for the complete tool catalog.

---

## Prompt Templates

Prompt templates define the agent's role, available tools, for-loop instructions, success criteria, and RBAC scope. They are reusable starting points for common operational workflows.

Example structure:

```
ROLE: You are a [role] for [convention name].
TOOLS: You have access to: [tool list]
GOAL: [what the agent should accomplish]
LOOP: Keep checking until [success criteria]. Max [N] iterations.
RBAC: You are operating as [role]. You can only [allowed operations].
```

See `agent-prompts.md` for the complete prompt library.

---

## Architecture Diagram

```
+------------------+
|   LLM Agent      |
|  (Claude, GPT)   |
+--------+---------+
         |
         |  HTTP + Auth Headers
         v
+--------+---------+
|  GR-Ops REST API |
|  /api/action     |
|  /api/domains/*  |
|  /api/ontology   |
|  /api/config     |
+--------+---------+
         |
         |  RBAC check (role, scope, field filter)
         v
+--------+---------+
|  PostgreSQL      |
|  (Neon)          |
+------------------+
```

---

## File Index

| File | Purpose |
|------|---------|
| `agent-overview.md` | This file -- architecture and patterns |
| `agent-tools.md` | Tool definitions for every API endpoint |
| `agent-prompts.md` | Reusable prompt templates for common workflows |
| `agent-workflows.md` | For-loop workflow patterns with concrete examples |
| `agent-rbac.md` | RBAC configuration and enforcement for agents |

---

## Quick Start: Build an Agent in 30 Minutes

1. **Read** `agent-tools.md` -- understand what tools are available
2. **Pick a prompt** from `agent-prompts.md` -- choose the agent role you need
3. **Wire up the tools** -- map each tool definition to an HTTP call
4. **Set the auth headers** -- `X-Dev-Email` and `X-Dev-Role` for your agent's role
5. **Run the loop** -- start with `get_dashboard`, let the agent decide what to do
6. **Add termination** -- set max iterations and success criteria

### Minimal Python Example

```python
import httpx

BASE_URL = "https://your-grops-instance.vercel.app"
HEADERS = {
    "Content-Type": "application/json",
    "X-Dev-Email": "agent@yourcon.org",
    "X-Dev-Role": "director",
}

def call_tool(tool_name: str, params: dict = None) -> dict:
    """Route tool calls to the correct API endpoint."""
    tool_map = {
        "get_dashboard": ("POST", "/api/action", {"action": "getDashboardData"}),
        "list_guests": ("POST", "/api/action", {"action": "getGuestList"}),
        "list_staff": ("POST", "/api/action", {"action": "getStaffList"}),
        "list_schedule": ("POST", "/api/action", {"action": "getScheduleList"}),
        "list_prep_items": ("POST", "/api/action", {"action": "getPrepItems"}),
        "get_guest_detail": ("POST", "/api/action", {"action": "getGuestDetail", "params": params}),
        "get_ontology": ("GET", "/api/ontology", None),
        "get_config": ("GET", "/api/config", None),
        "create_guest": ("POST", "/api/domains/guest", params),
        "update_guest": ("PUT", f"/api/domains/guest/{params.get('id', '')}", params),
        "create_pairing": ("POST", "/api/domains/pairing", params),
        "create_event": ("POST", "/api/domains/schedule", params),
        "update_prep_item": ("PUT", f"/api/domains/prep/{params.get('id', '')}", params),
    }

    method, path, body = tool_map[tool_name]
    if method == "GET":
        resp = httpx.get(f"{BASE_URL}{path}", headers=HEADERS)
    elif method == "POST":
        resp = httpx.post(f"{BASE_URL}{path}", headers=HEADERS, json=body)
    elif method == "PUT":
        resp = httpx.put(f"{BASE_URL}{path}", headers=HEADERS, json=body)

    return resp.json()
```

---

## Next Steps

- [agent-tools.md](agent-tools.md) -- Tool definitions
- [agent-prompts.md](agent-prompts.md) -- Prompt templates
- [agent-workflows.md](agent-workflows.md) -- For-loop patterns
- [agent-rbac.md](agent-rbac.md) -- RBAC for agents
