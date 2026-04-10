# Guest Self-Service

> External forms via tokenized links. Pre-populated from YoY registry + company records. Save-and-resume
> (partial saves to JSONB). Submission fires domain events → prep items auto-complete → liaison notified.
> Token expiration, no enumeration, ontology-driven validation.

---

## Overview

Guest self-service forms let guests confirm their travel details, dietary preferences, bio, and other information before the convention — without needing a platform account. Guests receive an email with a tokenized link, fill out what they can, save progress, and return later to complete. On submission, the data flows through the same API and event system as any other platform write.

**Dependencies:** `api/external-surfaces.md` (token auth), `data/yoy-registry.md` (pre-population), `data/encryption.md` (PII encryption)

---

## Full Specification

### 1. Form Session Concept

| Property | Type | Description |
|---|---|---|
| `guest_id` | relation (guest) | Which guest |
| `token` | text | crypto.randomUUID(), unique, unguessable |
| `expires_at` | datetime | Token expiration (default: 30 days from creation) |
| `status` | select | draft, submitted, expired |
| `form_data` | JSONB | Partial save state |
| `last_accessed_at` | datetime | Last time guest opened the form |
| `created_at` | datetime | When token was generated |

### 2. Email Trigger

Workflow on `guest.status_changed` → Confirmed:
1. Create `guest_form_session` record with new token
2. Send email to guest (or guest's agency contact) with tokenized link:
   `https://ops.animeboston.com/guest-form/{token}`
3. Create prep item: "Awaiting travel details from {{guest.name}}"
4. Email template includes: convention dates, what info is needed, deadline

**Re-send:** If guest loses the link, coordinator can regenerate token (old token invalidated, new one created).

### 3. Pre-Population

Form pre-fills from multiple sources in priority order:

1. **Existing guest record** — any data already entered by staff (name, company, department)
2. **YoY registry** — if guest attended before: "Last year you flew JAL from Narita, arriving May 20. Is this still correct?" Pre-fills flight, carrier, dietary, hotel preferences
3. **Company records** — if guest's company has standard arrangements: default hotel, standard travel class

Guest can accept pre-filled values or change them. Changed values override on submit.

### 4. Save and Resume

- Guest opens form → loads `form_data` from session record (or empty for first visit)
- Guest fills in some fields → clicks "Save Progress" → `PUT /api/guest-form/{token}` → partial data stored in `form_data` JSONB
- Guest closes browser → status remains 'draft'
- Guest returns via same link → form loads from `form_data`, previously filled fields restored
- Auto-save every 60 seconds while form is open (debounced)
- `last_accessed_at` updated on every load

### 5. Form Sections

Defined by ontology FormConfig for the "guest_self_service" form:

| Section | Fields | Pre-populated From |
|---|---|---|
| **Travel** | flight number, carrier, departure city, arrival date/time, departure date/time | Registry, existing transport_booking |
| **Accommodation** | hotel preference, room type, check-in/check-out dates, special requests | Registry |
| **Dietary** | restrictions (multi-select), allergies, preferences, notes | Registry |
| **Bio & Photo** | bio text (for program book), headshot upload, social links | Registry, company |
| **Emergency Contact** | name, phone, relationship | Previous year (encrypted) |

All fields validated against ontology property constraints (required, min/max, pattern).

### 6. Submission Flow

1. Guest clicks "Submit" → client validates all required fields
2. `POST /api/guest-form/{token}/submit`
3. Token resolved → guest_self_service role → record-scoped RBAC
4. Data written to guest record + related records (transport_booking, accommodation) via domain CRUD API
5. `guest_form_session.status` → 'submitted'
6. Domain event: `guest_form.submitted` with guest_id
7. Downstream workflows:
   - Prep item "Awaiting travel details" → auto-complete
   - Prep item "Confirm dietary requirements" → auto-complete
   - Liaison notified: "{{guest.name}} has submitted their travel details"
8. Token becomes read-only (guest can view but not re-submit)

### 7. Expiration and Security

- **Token expiration:** Default 30 days. Configurable per convention. Expired tokens return 403 (same error as invalid — no enumeration)
- **Re-generation:** Coordinator can issue new token. Old token invalidated immediately.
- **Rate limiting:** Stricter than authenticated endpoints (10 req/min per token)
- **PII encryption:** All PII fields (email, phone, dietary, emergency contact) encrypted before storage (see `data/encryption.md`)
- **No enumeration:** Invalid token, expired token, and non-existent token all return identical 403 response
- **CORS:** Restricted to convention domain only

### 8. Config-Driven Rendering

**Acceptance Criteria:**
- [ ] External guest forms render from FormConfig loaded from Postgres
- [ ] Form fields derive from ontology Property definitions

**Dependencies:** `config-integration.md`

### 9. Test Plan

| Test | What | Acceptance |
|------|------|------------|
| Token auth | Valid token → form loads. Invalid → 403. Expired → 403 (same error) | No enumeration |
| Pre-population | Returning guest → fields pre-filled from registry | Correct data shown |
| Save and resume | Fill 3 fields, save, reload → 3 fields restored | Partial state persisted |
| Auto-save | Type in field, wait 60s → form_data updated | No data loss on crash |
| Submit | Submit form → guest record updated + events fired | Data flows through API |
| Auto-complete | Submit → "Awaiting travel" prep item completes | Status updated |
| Liaison notification | Submit → liaison gets notification | Notification received |
| Re-send | Coordinator regenerates token → old invalid, new works | Clean token swap |
| PII encryption | Submit with email/phone → stored encrypted in DB | Direct SQL shows ciphertext |
| Rate limiting | 11 requests in 1 minute → 429 | Rate limit enforced |
