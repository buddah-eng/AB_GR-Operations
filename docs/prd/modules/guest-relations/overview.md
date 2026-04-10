# Guest Relations Module — Overview

> GR manages the full guest lifecycle: invite, confirm, staff, prepare, transport, and support guests.
> Eight ontology concepts (guest, pairing, prep_item, transport_booking, contract_template, contract_clause,
> generated_contract, guest_form_session). Integrates with shared services (scheduling, venues, volunteers).

---

## Overview

Guest Relations is the first department module deployed on the platform. It manages all aspects of guest appearances at the convention — from initial invitation through post-convention wrap-up. The module is built entirely from ontology concepts, workflows, and RBAC config — no GR-specific code exists in the engine.

**GR Concepts:** guest, pairing, prep_item, transport_booking, transport_driver, contract_template, contract_clause, generated_contract, guest_form_session

**GR Relationships:** guest→pairings→staff, guest→prep_items, guest→transport_bookings, guest→schedule_events, guest→generated_contracts, guest→guest_form_sessions

**GR Roles (ontology-defined, examples):** gr_volunteer (view assigned guests), gr_liaison (view/edit assigned guests), gr_interpreter (view assigned guests + interpreter-specific fields), gr_coordinator (view/edit all guests), gr_director (full access + ontology management). Liaison data scope: relation via pairings.staff_id = current user.

**Integration with shared services:** Scheduling (guest panels, autograph sessions, concerts), Venues (green rooms, signing areas, panel rooms), Volunteers (liaison/interpreter assignment from volunteer pool), Equipment (AV for panels, signing supplies).

**Sub-PRDs:** guest-lifecycle, pairings-staffing, prep-tracking, contracts, itineraries, transport-logistics, guest-self-service — each an atomic PRD in this folder.

---

## Department-Centric Settings (R4)

The GR settings page is organized by department, not by generic feature categories. Each settings section reads its structure and options from ontology/config tables in Postgres — no hardcoded settings panels.

**Settings sections (GR-specific):**
- Guest types & constraints (JP/NA/other defaults, required fields)
- Staffing templates (required pairing roles per guest type)
- Prep checklist templates (items created per guest type)
- Contract clause inventory (conditional clauses and sort order)
- Transport providers (Blacklane/Karhoo/volunteer config)
- Self-service form configuration (sections, field visibility, token expiration)
- Notification preferences (which transitions trigger which alerts)

**Acceptance Criteria:**
- [ ] Settings page is department-centric, showing GR-specific config panels
- [ ] Each settings section reads from ontology/config tables, not hardcoded UI
- [ ] Adding a new setting section requires only a config record, not a code change

**Dependencies:** `config-integration.md`
