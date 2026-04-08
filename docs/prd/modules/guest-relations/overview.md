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
