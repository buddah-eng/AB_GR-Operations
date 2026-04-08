# Contracts

> Conditional clause assembly: contract_template + contract_clause concepts. Each clause has a ConditionExpression
> evaluated against the guest record. Matching clauses sorted by sort_order, variables resolved via Handlebars.
> Rendered as in-app view at /guests/:id/contract. PDF export for external distribution.

---

## Overview

Guest contracts are assembled from conditional clauses rather than maintained as monolithic documents. Each clause has a ConditionExpression that determines whether it's included for a given guest. This means a JP music guest's contract automatically includes the interpreter clause, international travel clause, AND performance rider — while an NA cosplay guest gets the domestic travel clause and booth space clause instead. No manual editing required for standard contracts.

**Dependencies:** `core/condition-expression.md`, `ui/in-app-documents.md`, `automation/workflow-actions.md` (generate_doc)

---

## Full Specification

### 1. Contract Template Concept

| Property | Type | Description |
|---|---|---|
| `name` | text | "Guest Appearance Agreement 2026" |
| `base_document` | rich_text | Header/footer boilerplate (convention name, dates, legal entity) |
| `output_format` | select | PDF |

Managed via ontology web builder. Convention can have multiple templates (e.g., standard guest agreement, concert headliner agreement).

### 2. Contract Clause Concept

| Property | Type | Description |
|---|---|---|
| `name` | text | "Interpreter Services Provision" |
| `sort_order` | number | Clause position in contract |
| `body` | rich_text | Handlebars template with `{{variables}}` |
| `condition` | json (ConditionExpression) | When to include. null = always include |
| `template_id` | relation (contract_template) | Parent template |

### 3. Clause Inventory

**Base clauses (always included):**

| # | Clause | sort_order |
|---|---|---|
| 1 | Identity & Parties | 10 |
| 2 | Appearance Dates & Location | 20 |
| 3 | Compensation | 30 |
| 4 | General Terms | 40 |
| 5 | Liability & Indemnification | 50 |
| 6 | Cancellation Policy | 60 |
| 7 | Force Majeure | 70 |

**Conditional clauses:**

| # | Clause | Condition | sort_order |
|---|---|---|---|
| 8 | Interpreter Services | `type='JP' AND interpreterRequired=true` | 80 |
| 9 | International Travel | `type='JP' OR type='other'` | 85 |
| 10 | Domestic Travel | `type='NA'` | 85 |
| 11 | Performance Rider | `department='Music'` | 90 |
| 12 | Booth Space & Display | `department='Cosplay'` | 90 |
| 13 | VIP Green Room | `specialHandling contains 'VIP'` | 95 |
| 14 | Merchandise & Likeness | `properties.concertHeadliner=true` | 100 |

### 4. Variable Resolution

Handlebars templates resolve variables from the guest record and related records:

```handlebars
This Agreement is entered into between Anime Boston ("Convention")
and {{guest.name}} {{#if guest.company}}of {{guest.company}} {{/if}}("Guest")
for appearance at Anime Boston 2026 on {{convention.dates}}.

{{#if travel.flightNumber}}
Guest will arrive via {{travel.carrier}} flight {{travel.flightNumber}}
on {{travel.arrivalDate}}.
{{/if}}

{{#each schedule.events}}
- {{this.name}} ({{this.venue}}, {{this.startTime}} - {{this.endTime}})
{{/each}}
```

**Variable context built from:**
- `guest.*` — direct guest record fields
- `travel.*` — related transport_booking record
- `accommodation.*` — related accommodation record
- `schedule.*` — related schedule_events
- `pairing.*` — related pairings with staff names
- `convention.*` — platform config (dates, venue, legal entity)

### 5. Generated Contract Concept

| Property | Type | Description |
|---|---|---|
| `guest_id` | relation (guest) | Which guest |
| `template_id` | relation (contract_template) | Which template |
| `generated_at` | datetime | When generated |
| `html_content` | rich_text | Rendered HTML for in-app display |
| `output_url` | url | Cloud Storage PDF URL |
| `status` | select | draft, sent, signed, expired |
| `signed_at` | datetime | When guest signed |

### 6. In-App View

Contract rendered at `/guests/:id/contract`:
- HTML from `html_content` displayed in platform UI
- Draft mode: manual clause adjustments before sending (override text, not conditions)
- Status badges: draft (yellow), sent (blue), signed (green), expired (red)
- `[Export PDF]` button generates/downloads PDF
- `[Regenerate]` button re-runs clause assembly (picks up changes to guest record or clause text)

### 7. Test Plan

| Test | What | Acceptance |
|------|------|------------|
| JP music guest | Clauses 1-7 + 8 (interpreter) + 9 (intl travel) + 11 (performance) | Exactly these clauses, sorted |
| NA cosplay guest | Clauses 1-7 + 10 (domestic) + 12 (booth) | Exactly these clauses |
| Variable resolution | {{guest.name}} replaced with actual name | All variables filled |
| Missing variable | {{travel.flightNumber}} when no transport booking | Graceful handling (blank or placeholder) |
| Regenerate | Change guest type → regenerate → different clauses | Updated clause set |
| PDF export | Generate PDF → URL stored → downloadable | Valid PDF |
