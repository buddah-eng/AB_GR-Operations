# In-App Documents (Contracts & Itineraries)

> Contracts and itineraries are first-class in-app views, not external documents. Contracts assembled from
> conditional clauses (ConditionExpression per clause, Handlebars templates). Itineraries aggregated from
> schedule + transport + pairings per guest. Both rendered in the platform UI, exportable to PDF.

---

## Overview

Contracts and itineraries are the two primary document types in the GR module. Unlike traditional document generation (export to Google Docs, email a PDF), these are **rendered views within the platform** — the same way a table view or kanban view renders domain data, a contract view renders clause-assembled content and an itinerary view renders a per-guest timeline.

PDF export is available for external distribution (sending contracts to guests/agencies, printing itineraries for liaisons), but the primary interface is in-app.

**Dependencies:** `core/condition-expression.md`, `automation/workflow-actions.md` (generate_doc), `ui/view-renderer.md`

---

## Full Specification

### 1. Documents as Views

**Purpose:** Define contracts and itineraries as view types, not file generators.

**Detail:**

Documents are rendered from the same domain data that powers tables and kanbans:

| View Type | Data Source | Rendering |
|---|---|---|
| Table | Concept records, filtered/sorted | PrimeVue DataTable |
| Kanban | Concept records, grouped by field | Column cards |
| **Contract** | Guest record + contract_clauses, filtered by ConditionExpression | Clause-assembled rich text |
| **Itinerary** | Guest record + schedule_events + transport_bookings + pairings | Timeline/agenda |

Accessed via: `/guests/:id/contract` and `/guests/:id/itinerary` routes in the Vue app. Both render in the platform UI with a `[Export PDF]` button.

**Acceptance Criteria:**
- [ ] Contract and itinerary accessible as in-app views per guest
- [ ] Same data rendered in both in-app and PDF formats
- [ ] No external document service required

---

### 2. Contract Rendering

**Purpose:** Define conditional clause assembly.

**Detail:**

**New ontology concepts:**

`contract_template`:
| Property | Type | Description |
|---|---|---|
| `name` | text | "Guest Appearance Agreement 2026" |
| `base_document` | rich_text | Boilerplate header/footer |
| `output_format` | select | PDF, DOCX |

`contract_clause`:
| Property | Type | Description |
|---|---|---|
| `name` | text | "Interpreter Services Provision" |
| `sort_order` | number | Clause ordering |
| `body` | rich_text | Handlebars template with `{{variables}}` |
| `condition` | json | ConditionExpression — when to include this clause |
| `template_id` | relation | Parent contract_template |

`generated_contract`:
| Property | Type | Description |
|---|---|---|
| `guest_id` | relation | Which guest |
| `template_id` | relation | Which template used |
| `generated_at` | datetime | When generated |
| `output_url` | url | Cloud Storage URL for PDF |
| `status` | select | draft / sent / signed / expired |
| `html_content` | rich_text | Rendered HTML (for in-app display) |

**Assembly process:**
1. Load `contract_template` and all related `contract_clause` records
2. For each clause: evaluate `condition` ConditionExpression against the guest record + related records (travel, accommodation, pairings)
3. Include matching clauses, sorted by `sort_order`
4. Resolve `{{variables}}` using Handlebars: `{{guest.name}}`, `{{guest.company}}`, `{{travel.flightDetails}}`, `{{schedule.events}}`, etc.
5. Wrap in base_document header/footer
6. Store rendered HTML in `generated_contract.html_content`
7. Convert to PDF via puppeteer/html-pdf, store in Cloud Storage

**Example clauses:**

| Clause | Condition | Always/Conditional |
|---|---|---|
| Identity & dates | None (always) | Always |
| Compensation | None | Always |
| General terms | None | Always |
| Force majeure | None | Always |
| Interpreter services | `type = 'JP' AND interpreterRequired = true` | Conditional |
| International travel | `type = 'JP'` | Conditional |
| Domestic travel | `type = 'NA'` | Conditional |
| Performance rider | `department = 'Music'` | Conditional |
| Booth space | `department = 'Cosplay'` | Conditional |
| VIP green room | `specialHandling contains 'VIP'` | Conditional |
| Merchandise/likeness | `properties.concertHeadliner = true` | Conditional |

**Acceptance Criteria:**
- [ ] Correct clauses selected based on guest record
- [ ] Variables resolved from guest + related records
- [ ] Generated HTML renders correctly in-app
- [ ] PDF matches in-app rendering

---

### 3. Itinerary Rendering

**Purpose:** Define per-guest schedule aggregation.

**Detail:**

An itinerary is a per-guest view that aggregates from multiple concepts:

```sql
-- Data sources for guest itinerary:
SELECT * FROM schedule_events se
  JOIN pairings p ON se.guest_id = p.guest_id
  WHERE se.guest_id = :guestId AND NOT se.archived
  ORDER BY se.start_time;

SELECT * FROM transport_bookings tb
  WHERE tb.guest_id = :guestId AND NOT tb.archived
  ORDER BY tb.pickup_time;
```

**Rendered as timeline/agenda:**

```
Friday, May 22, 2026
─────────────────────────────────
 9:00 AM   Airport pickup (Logan Terminal E, Door 4)
           Driver: Mike Chen | Flight: JL008 (On Time)
11:30 AM   Hotel check-in (Hynes Marriott, Room 1204)
 1:00 PM   Sound check (Main Events Hall)
           Liaison: Hana Ito | Interpreter: Miki Nakamura
 3:00 PM   Panel: "Voice Acting in Modern Anime"
           Room: Panel Hall A | Duration: 60min
 6:00 PM   VIP Dinner (Green Room B)

Saturday, May 23, 2026
─────────────────────────────────
10:00 AM   Autograph Session (Autograph Hall, Table 3)
           Duration: 2hrs | Queue cap: 200
 1:00 PM   Lunch break
 3:00 PM   Concert rehearsal (Main Events Hall)
 7:00 PM   Concert performance (Main Events Hall)
           Sound check: 4:00 PM confirmed
```

**Data merge rules:**
- Schedule events: sorted by start_time
- Transport bookings: inserted at pickup_time
- Pairings: shown as liaison/interpreter on each event
- Gaps: detected and shown as free time

**Acceptance Criteria:**
- [ ] Itinerary aggregates from schedule + transport + pairings
- [ ] Events sorted chronologically
- [ ] Liaison/interpreter shown per event
- [ ] PDF export formatted for print (one page per day)

---

### 4. PDF Export

**Purpose:** Define HTML-to-PDF conversion.

**Detail:**

- **Library:** Puppeteer (headless Chrome) or `html-pdf`/`pdf-lib` for lighter option
- **Process:** Render HTML → apply print CSS → generate PDF → store in Cloud Storage → attach URL to generated_contract record
- **Print CSS:** Page breaks between sections, header/footer with convention branding, page numbers
- **Storage:** Cloud Storage bucket `generated-pdfs/`, path: `contracts/{guestId}/{timestamp}.pdf`
- **Retention:** Current year's contracts kept indefinitely. Previous years archived.

**Acceptance Criteria:**
- [ ] PDF generated from same HTML as in-app view
- [ ] Print formatting (page breaks, headers) applied
- [ ] PDF URL stored on record and accessible via API

---

### 5. Template Management

**Purpose:** Define how templates are managed as ontology concepts.

**Detail:**

`contract_template` and `contract_clause` are standard ontology concepts — managed through the ontology web builder like any other concept. This means:

- Templates created/edited by directors via web builder
- Clause conditions built with the shared ConditionBuilder UI component
- Clause bodies edited with a rich text editor (Handlebars syntax highlighted)
- Templates versioned through the config CI/QA pipeline
- Template changes validated: all `{{variables}}` must reference existing properties

**Acceptance Criteria:**
- [ ] Templates manageable through ontology web builder
- [ ] Clause conditions use ConditionBuilder component
- [ ] Variable validation catches references to non-existent properties

---

### 6. Workflow Integration

**Purpose:** Define how document generation integrates with workflows.

**Detail:**

The `generate_doc` workflow action (see `automation/workflow-actions.md`) triggers document rendering:

```json
{
  "type": "generate_doc",
  "templateName": "guest-contract",
  "target": "guest"
}
```

**Flow:**
1. Guest status changes to "Confirmed" → workflow triggers
2. `generate_doc` action fires → loads template, assembles clauses, resolves variables
3. HTML stored in `generated_contract` record
4. PDF generated and stored in Cloud Storage
5. `contract.generated` domain event emitted
6. Downstream workflow creates prep item: "Review contract for {{guest.name}}"

**Acceptance Criteria:**
- [ ] generate_doc action creates a complete generated_contract record
- [ ] PDF generated and URL stored
- [ ] contract.generated event fires for downstream workflows

---

### 7. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Clause assembly | Unit | Evaluate conditions, include/exclude clauses | Correct clauses for JP guest, NA guest, VIP, musician |
| Variable resolution | Unit | Handlebars resolves {{guest.name}}, {{travel.flight}} | All variables filled, missing variables show placeholder |
| Itinerary aggregation | Integration | Merge schedule + transport + pairings for guest | Chronological, complete, no duplicates |
| In-app rendering | E2E | Contract/itinerary views load and display | Correct content, responsive layout |
| PDF generation | Integration | HTML → PDF → Cloud Storage | PDF accessible at stored URL |
| Template CRUD | Integration | Create/edit/delete templates via web builder | Templates persist and render |
| Workflow trigger | Integration | Guest confirmed → contract generated → prep item created | Full chain executes |
| Clause condition builder | E2E | Build condition in UI → clause included/excluded correctly | Round-trip: UI → JSON → evaluation → rendering |

**Coverage target:** ≥80% on clause assembly and variable resolution. 100% on condition evaluation (safety-critical — wrong clauses in a contract is a legal issue).
