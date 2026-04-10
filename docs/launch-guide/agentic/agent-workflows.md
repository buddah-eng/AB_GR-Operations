# Agent For-Loop Workflow Patterns

> Concrete for-loop patterns that agents execute against GR-Ops.
> Each pattern defines the loop structure, state tracking, termination conditions,
> and includes a pseudocode implementation.

---

## Pattern Structure

Every workflow pattern follows this template:

```
NAME:       Descriptive name for the pattern
TRIGGER:    What initiates this workflow
STATE:      What the agent tracks between iterations
LOOP:       The step-by-step cycle
TERMINATE:  When to stop
OUTPUT:     What the agent produces
```

---

## 1. Gap Analysis Loop

**Purpose:** Scan all guests, identify operational gaps (missing pairings, incomplete prep, missing transport), take corrective action, and verify until all gaps are closed.

### When to Use

- Pre-convention readiness check
- After a batch of new guests are added
- Daily operational review

### State Tracking

```python
state = {
    "gaps_found": [],        # List of {guestId, guestName, gapType, details}
    "actions_taken": [],     # List of {guestId, action, result}
    "iterations": 0,
    "max_iterations": 50,
    "gaps_remaining": 0,
}
```

### Loop

```python
def gap_analysis_loop(agent):
    state = initialize_state()

    while state["iterations"] < state["max_iterations"]:
        state["iterations"] += 1

        # STEP 1: OBSERVE -- Get current system state
        dashboard = agent.call("get_dashboard")
        guests = agent.call("list_guests")

        # STEP 2: IDENTIFY GAPS -- Check each guest
        gaps = []
        for guest in guests:
            detail = agent.call("get_guest_detail", {"guestId": guest["id"]})

            # Gap: No liaison assigned
            if not dashboard["staffing"]["coverage"][guest["id"]]["hasLiaison"]:
                gaps.append({
                    "guestId": guest["id"],
                    "guestName": guest["name"],
                    "gapType": "no_liaison",
                    "details": "Guest has no Main Liaison assigned"
                })

            # Gap: JP guest without interpreter
            if guest["type"] == "JP" and guest["interpreterRequired"]:
                has_interp = any(p["role"] == "Interpreter" for p in detail["pairings"])
                if not has_interp:
                    gaps.append({
                        "guestId": guest["id"],
                        "guestName": guest["name"],
                        "gapType": "no_interpreter",
                        "details": "JP guest requires interpreter but none assigned"
                    })

            # Gap: No transport bookings
            if guest["status"] in ["Confirmed", "Travel Arranged"]:
                has_arrival = any(t["bookingType"] == "arrival" for t in detail["travel"])
                has_departure = any(t["bookingType"] == "departure" for t in detail["travel"])
                if not has_arrival:
                    gaps.append({
                        "guestId": guest["id"],
                        "guestName": guest["name"],
                        "gapType": "no_arrival_transport",
                        "details": "Confirmed guest has no arrival transport"
                    })
                if not has_departure:
                    gaps.append({
                        "guestId": guest["id"],
                        "guestName": guest["name"],
                        "gapType": "no_departure_transport",
                        "details": "Confirmed guest has no departure transport"
                    })

            # Gap: Prep completion below threshold
            if guest["prepPercent"] < 80 and guest["status"] in ["Confirmed", "Travel Arranged", "Arrived"]:
                gaps.append({
                    "guestId": guest["id"],
                    "guestName": guest["name"],
                    "gapType": "low_prep_completion",
                    "details": f"Prep at {guest['prepPercent']}% ({guest['prepComplete']}/{guest['prepTotal']})"
                })

            # Gap: No schedule events
            if len(detail["schedule"]) == 0 and guest["status"] != "Draft":
                gaps.append({
                    "guestId": guest["id"],
                    "guestName": guest["name"],
                    "gapType": "no_schedule",
                    "details": "Guest has no scheduled events"
                })

        state["gaps_found"] = gaps
        state["gaps_remaining"] = len(gaps)

        # STEP 3: CHECK TERMINATION
        if len(gaps) == 0:
            break  # All gaps closed

        # STEP 4: ACT -- Address fixable gaps
        for gap in gaps:
            if gap["gapType"] == "no_liaison":
                # Find an available liaison in the guest's department
                staff = agent.call("list_staff")
                liaisons = [s for s in staff
                            if s["role"] == "Liaison"
                            and s["department"] == guest_department(gap["guestId"], guests)]
                if liaisons:
                    result = agent.call("create_pairing", {
                        "guest_id": gap["guestId"],
                        "staff_id": liaisons[0]["id"],
                        "role": "Main Liaison"
                    })
                    state["actions_taken"].append({
                        "guestId": gap["guestId"],
                        "action": f"Assigned {liaisons[0]['name']} as Main Liaison",
                        "result": result
                    })

            elif gap["gapType"] == "low_prep_completion":
                # Flag overdue prep items as in-progress
                detail = agent.call("get_guest_detail", {"guestId": gap["guestId"]})
                for prep in detail["prepTracker"]:
                    if prep["status"] == "Incomplete" and is_overdue(prep["dueDate"]):
                        agent.call("update_prep_item", {
                            "id": prep["prep_id"],
                            "status": "in_progress"
                        })
                        state["actions_taken"].append({
                            "guestId": gap["guestId"],
                            "action": f"Flagged overdue prep: {prep['item']}",
                            "result": "updated to in_progress"
                        })

            # Transport and interpreter gaps are logged but not auto-fixed
            # (require human-provided data like driver names, interpreter availability)

        # STEP 5: VERIFY -- Re-check dashboard
        new_dashboard = agent.call("get_dashboard")
        # Loop continues to re-evaluate

    return generate_report(state)
```

### Termination Conditions

| Condition | Action |
|-----------|--------|
| `gaps_remaining == 0` | Success -- all gaps closed |
| `iterations >= max_iterations` | Timeout -- generate report with remaining gaps |
| `no actions possible` | Stalled -- all remaining gaps require human intervention |

---

## 2. Daily Ops Loop

**Purpose:** Morning operational check that reviews the dashboard, processes action items, and generates a daily summary.

### When to Use

- Scheduled daily run (e.g., 8 AM every morning)
- On-demand operational status check

### State Tracking

```python
state = {
    "action_items": [],      # Items that need attention
    "resolved": [],          # Items that were handled
    "escalated": [],         # Items that need human attention
    "iterations": 0,
    "max_iterations": 20,
}
```

### Loop

```python
def daily_ops_loop(agent, today):
    state = initialize_state()

    # PHASE 1: OBSERVE
    dashboard = agent.call("get_dashboard")

    # Build action items from dashboard
    action_items = []

    # Overdue prep
    if dashboard["prep"]["overdue"] > 0:
        action_items.append({
            "type": "overdue_prep",
            "count": dashboard["prep"]["overdue"],
            "priority": "high"
        })

    # Guests without liaisons
    uncovered = [c for c in dashboard["staffing"]["coverage"] if not c["hasLiaison"]]
    if uncovered:
        action_items.append({
            "type": "missing_liaisons",
            "count": len(uncovered),
            "guests": [c["guestName"] for c in uncovered],
            "priority": "high"
        })

    # JP guests without interpreters
    no_interp = [c for c in dashboard["staffing"]["coverage"]
                 if c["interpreterRequired"] and not c["hasInterpreter"]]
    if no_interp:
        action_items.append({
            "type": "missing_interpreters",
            "count": len(no_interp),
            "guests": [c["guestName"] for c in no_interp],
            "priority": "critical"
        })

    # Low overall prep
    if dashboard["prep"]["percentComplete"] < 70:
        action_items.append({
            "type": "low_prep_overall",
            "percent": dashboard["prep"]["percentComplete"],
            "priority": "medium"
        })

    # Today's events
    today_events = dashboard["schedule"]["todayEvents"]
    action_items.append({
        "type": "today_schedule",
        "count": len(today_events),
        "events": today_events,
        "priority": "info"
    })

    state["action_items"] = action_items

    # PHASE 2: PROCESS EACH ACTION ITEM
    for item in action_items:
        state["iterations"] += 1
        if state["iterations"] > state["max_iterations"]:
            break

        if item["type"] == "overdue_prep":
            # Get all prep items, flag overdue ones
            prep_items = agent.call("list_prep_items")
            for prep in prep_items:
                if prep["status"] == "Incomplete" and is_overdue(prep["dueDate"], today):
                    agent.call("update_prep_item", {
                        "id": prep["id"],
                        "status": "in_progress"
                    })
                    state["resolved"].append(
                        f"Flagged overdue prep: {prep['label']} for {prep['guestName']}"
                    )

        elif item["type"] == "missing_liaisons":
            # Attempt auto-assignment
            staff = agent.call("list_staff")
            for guest_name in item["guests"]:
                state["escalated"].append(
                    f"Guest '{guest_name}' needs liaison assignment"
                )

        elif item["type"] == "missing_interpreters":
            for guest_name in item["guests"]:
                state["escalated"].append(
                    f"CRITICAL: JP guest '{guest_name}' needs interpreter"
                )

    # PHASE 3: VERIFY
    final_dashboard = agent.call("get_dashboard")

    # PHASE 4: GENERATE REPORT
    return {
        "report_date": today,
        "summary": {
            "guests_total": final_dashboard["guests"]["total"],
            "guests_confirmed": final_dashboard["guests"]["confirmed"],
            "prep_percent": final_dashboard["prep"]["percentComplete"],
            "prep_overdue": final_dashboard["prep"]["overdue"],
            "events_today": len(final_dashboard["schedule"]["todayEvents"]),
            "staff_total": final_dashboard["staffing"]["total"],
        },
        "action_items_found": len(state["action_items"]),
        "resolved": state["resolved"],
        "escalated": state["escalated"],
        "today_schedule": final_dashboard["schedule"]["todayEvents"],
    }
```

---

## 3. Onboarding Loop

**Purpose:** For each new guest, execute the full onboarding sequence: create record, assign liaison, create prep items, book transport, verify completeness.

### When to Use

- Batch import of new guests
- Single guest onboarding
- Convention expansion (adding guests mid-planning)

### Loop

```python
def onboarding_loop(agent, new_guests):
    """
    new_guests: list of dicts with at minimum:
      {name, type, department, company, status}
    """
    results = []

    for guest_data in new_guests:
        result = {"guest": guest_data["name"], "steps": []}

        # STEP 1: Create guest record
        created = agent.call("create_guest", {
            "name": guest_data["name"],
            "type": guest_data["type"],
            "department": guest_data["department"],
            "company": guest_data.get("company", ""),
            "status": guest_data.get("status", "draft"),
            "properties": {
                "interpreter_required": guest_data["type"] == "JP",
                "bio": guest_data.get("bio", ""),
                "dietary": guest_data.get("dietary", ""),
                "pronouns": guest_data.get("pronouns", ""),
            }
        })

        if not created["success"]:
            result["steps"].append({"step": "create_guest", "status": "FAILED", "error": created["error"]})
            results.append(result)
            continue

        guest_id = created["data"]["id"]
        result["steps"].append({"step": "create_guest", "status": "OK", "guestId": guest_id})

        # STEP 2: Assign liaison
        staff = agent.call("list_staff")
        dept_liaisons = [s for s in staff["data"]
                         if s["role"] == "Liaison"
                         and s["department"] == guest_data["department"]]

        if dept_liaisons:
            pairing = agent.call("create_pairing", {
                "guest_id": guest_id,
                "staff_id": dept_liaisons[0]["id"],
                "role": "Main Liaison"
            })
            result["steps"].append({
                "step": "assign_liaison",
                "status": "OK" if pairing["success"] else "FAILED",
                "liaison": dept_liaisons[0]["name"]
            })
        else:
            result["steps"].append({
                "step": "assign_liaison",
                "status": "SKIPPED",
                "reason": f"No liaisons in {guest_data['department']} department"
            })

        # STEP 3: Assign interpreter (JP guests only)
        if guest_data["type"] == "JP":
            interpreters = [s for s in staff["data"]
                           if s["role"] == "Interpreter"
                           and s["department"] == guest_data["department"]]
            if interpreters:
                interp_pairing = agent.call("create_pairing", {
                    "guest_id": guest_id,
                    "staff_id": interpreters[0]["id"],
                    "role": "Interpreter"
                })
                result["steps"].append({
                    "step": "assign_interpreter",
                    "status": "OK" if interp_pairing["success"] else "FAILED",
                    "interpreter": interpreters[0]["name"]
                })
            else:
                result["steps"].append({
                    "step": "assign_interpreter",
                    "status": "ESCALATED",
                    "reason": "No interpreters available in department"
                })

        # STEP 4: Verify completeness
        detail = agent.call("get_guest_detail", {"guestId": guest_id})
        if detail["success"]:
            verification = {
                "has_record": True,
                "has_liaison": len([p for p in detail["data"]["pairings"] if p["role"] == "Main Liaison"]) > 0,
                "has_interpreter": guest_data["type"] != "JP" or len([p for p in detail["data"]["pairings"] if p["role"] == "Interpreter"]) > 0,
                "prep_items_created": len(detail["data"]["prepTracker"]),
            }
            result["steps"].append({"step": "verify", "status": "OK", "verification": verification})
        else:
            result["steps"].append({"step": "verify", "status": "FAILED"})

        results.append(result)

    return {
        "total_guests": len(new_guests),
        "successful": len([r for r in results if all(s["status"] != "FAILED" for s in r["steps"])]),
        "details": results
    }
```

### State Machine per Guest

```
CREATE -> ASSIGN_LIAISON -> ASSIGN_INTERPRETER (if JP) -> VERIFY -> DONE
  |            |                    |                        |
  v            v                    v                        v
 FAILED      SKIPPED             ESCALATED              INCOMPLETE
```

---

## 4. Escalation Loop

**Purpose:** Check for overdue or stalled items, notify owners, wait, re-check, and escalate up the chain if still unresolved.

### When to Use

- Scheduled periodic check (e.g., every 4 hours)
- When prep completion stalls below target
- When critical items remain unresolved

### Loop

```python
def escalation_loop(agent, today, escalation_threshold_days=2):
    """
    Three-tier escalation:
      Level 1: Flag item as in_progress (first detection)
      Level 2: Log escalation to coordinator (after threshold_days)
      Level 3: Log critical escalation to director (after 2x threshold_days)
    """
    # STEP 1: Get all prep items
    prep_items = agent.call("list_prep_items")
    if not prep_items["success"]:
        return {"error": "Failed to retrieve prep items"}

    escalation_log = []

    for item in prep_items["data"]:
        if item["status"] == "Complete":
            continue

        if not item["dueDate"]:
            continue

        days_overdue = days_between(item["dueDate"], today)

        if days_overdue <= 0:
            continue  # Not yet overdue

        # LEVEL 1: First detection -- flag as in_progress
        if item["status"] == "Incomplete":
            agent.call("update_prep_item", {
                "id": item["id"],
                "status": "in_progress"
            })
            escalation_log.append({
                "level": 1,
                "item": item["label"],
                "guest": item["guestName"],
                "owner": item["owner"],
                "days_overdue": days_overdue,
                "action": "Flagged as in_progress"
            })

        # LEVEL 2: Coordinator escalation
        elif days_overdue >= escalation_threshold_days and item["status"] == "In Progress":
            escalation_log.append({
                "level": 2,
                "item": item["label"],
                "guest": item["guestName"],
                "owner": item["owner"],
                "days_overdue": days_overdue,
                "action": "ESCALATED to coordinator -- item stalled for "
                          f"{days_overdue} days"
            })

        # LEVEL 3: Director escalation
        elif days_overdue >= (escalation_threshold_days * 2):
            escalation_log.append({
                "level": 3,
                "item": item["label"],
                "guest": item["guestName"],
                "owner": item["owner"],
                "days_overdue": days_overdue,
                "action": "CRITICAL ESCALATION to director -- item stalled for "
                          f"{days_overdue} days"
            })

    # VERIFY: Re-check to confirm updates
    updated_items = agent.call("list_prep_items")
    items_still_overdue = [
        i for i in updated_items["data"]
        if i["status"] != "Complete" and i["dueDate"] and is_overdue(i["dueDate"], today)
    ]

    return {
        "escalations": escalation_log,
        "level_1_count": len([e for e in escalation_log if e["level"] == 1]),
        "level_2_count": len([e for e in escalation_log if e["level"] == 2]),
        "level_3_count": len([e for e in escalation_log if e["level"] == 3]),
        "items_still_overdue": len(items_still_overdue),
        "total_items_checked": len(prep_items["data"]),
    }
```

### Escalation Tiers

| Level | Trigger | Action | Notify |
|-------|---------|--------|--------|
| 1 | Item overdue, status=incomplete | Change to in_progress | Owner (via log) |
| 2 | Item overdue by N+ days, status=in_progress | Log escalation | Coordinator |
| 3 | Item overdue by 2N+ days, still not complete | Log critical escalation | Director |

---

## Composing Workflows

These patterns are composable. A morning ops agent might run:

```python
def morning_ops(agent, today):
    # 1. Run daily ops for situational awareness
    daily_report = daily_ops_loop(agent, today)

    # 2. Run escalation check for overdue items
    escalation_report = escalation_loop(agent, today)

    # 3. If new guests were added yesterday, run onboarding
    guests = agent.call("list_guests")
    new_guests = [g for g in guests["data"] if g["status"] == "Draft"]
    if new_guests:
        onboarding_report = onboarding_loop(agent, new_guests)
    else:
        onboarding_report = None

    # 4. Run gap analysis for comprehensive check
    gap_report = gap_analysis_loop(agent)

    return combine_reports(daily_report, escalation_report,
                          onboarding_report, gap_report)
```

---

## Safety: Iteration Limits

Every loop must have a hard iteration limit. Recommended defaults:

| Pattern | Default Max Iterations | Rationale |
|---------|----------------------|-----------|
| Gap Analysis | 50 | May need to process many guests |
| Daily Ops | 20 | Bounded by action item count |
| Onboarding | N/A (bounded by guest count) | One pass per guest |
| Escalation | 1 pass | Single scan, no retry needed |

If a loop hits its iteration limit, it must generate a partial report and clearly indicate that it did not complete.
