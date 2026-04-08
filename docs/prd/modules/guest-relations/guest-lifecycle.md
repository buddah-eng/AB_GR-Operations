# Guest Lifecycle

> Status flow: draft → invited → confirmed → travel_arranged → arrived → attending → departed.
> Each transition triggers workflows (confirmation → contract + transport + notification).
> Guest types (JP/NA/other) determine constraints, clauses, and workflow branches.

---

## Overview

The guest lifecycle defines how a guest record moves from initial creation through the convention and post-event. Each status transition is a domain event that can trigger workflows — the confirmation transition alone fires contract generation, transport booking, schedule reservation, and liaison notification.

Guest types (JP, NA, other) apply ontology constraints that change defaults, required fields, and which workflow branches execute.

---

## Full Specification

### 1. Status Flow

```
draft → invited → confirmed → travel_arranged → arrived → attending → departed
                  ↘ declined                     ↘ canceled
```

| Transition | Trigger | Workflows Fired |
|---|---|---|
| draft → invited | Coordinator sends invitation | Create initial prep items |
| invited → confirmed | Guest accepts | Generate contract, create transport booking, reserve schedule slots, notify liaison |
| invited → declined | Guest declines | Archive prep items, notify coordinator |
| confirmed → travel_arranged | Travel details confirmed (self-service form or manual) | Update transport booking, complete travel prep items |
| travel_arranged → arrived | Guest checks in at convention | Notify liaison, activate itinerary |
| arrived → attending | Guest at first event | No workflow (status tracking) |
| attending → departed | Guest leaves convention | Post-con feedback request, archive active transport |
| any → canceled | Guest cancels after confirmation | Archive all related records, cancel transport, notify stakeholders |

**Invalid transitions blocked:** Can't go from draft→arrived, declined→confirmed, etc. Transition validation in the CRUD API before status update.

**Acceptance Criteria:**
- [ ] Valid transitions succeed and fire workflows
- [ ] Invalid transitions return 400 with explanation
- [ ] Each transition logged as domain event with previous/new status

### 2. Guest Types

| Type | Description | Constraints Applied |
|---|---|---|
| JP | Japanese guest (international) | interpreterRequired=true default, international travel clause, visa prep items, JP prep checklist template |
| NA | North American guest (domestic) | Domestic travel clause, NA prep checklist template |
| other | International non-JP | International travel clause, interpreter case-by-case |

Types are a select property on the guest concept. Constraints evaluate `type` field to apply defaults and required fields.

### 3. Creation Flow

Coordinator creates guest: name (required), type (required), department (required). Everything else optional at creation. Workflows fire on `guest.created`:
- Create prep items from type-appropriate template
- If type=JP: create interpreter pairing placeholder
- Notify department coordinator

### 4. Test Plan

| Test | What | Acceptance |
|------|------|------------|
| Valid transitions | Each valid transition succeeds | Status updated, events fired |
| Invalid transitions | draft→arrived attempted | 400 returned |
| JP creation | Create JP guest | Interpreter pairing + JP prep items created |
| Confirmation chain | Status→confirmed | Contract + transport + notification all fire |
| Cancellation | Status→canceled | Related records archived, transport canceled |
