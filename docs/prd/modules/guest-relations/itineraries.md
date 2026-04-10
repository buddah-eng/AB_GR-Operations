# Itineraries

> Per-guest chronological view aggregated from schedule_events + transport_bookings + pairings.
> Computed view (not a stored document). Rendered in-app at /guests/:id/itinerary, exportable to
> PDF. Liaison copy shows only their assigned guests' itineraries.

---

## Overview

An itinerary is a per-guest timeline showing everything that happens during the convention — panels, concerts, autograph sessions, airport pickups, hotel check-in, meals, sound checks. It's not a separate concept but a computed view that aggregates from multiple data sources and renders chronologically.

---

## Full Specification

### 1. Data Sources

| Source | Query | What It Contributes |
|---|---|---|
| `schedule_events` | WHERE guest_id = :id AND NOT archived | Panels, concerts, autograph sessions, meetings |
| `transport_bookings` | WHERE guest_id = :id AND NOT archived | Airport pickup, hotel dropoff |
| `pairings` | WHERE guest_id = :id AND NOT archived | Liaison/interpreter names per event |
| `venues` | JOIN via schedule_events.venue_id | Room names, locations |

```sql
SELECT 'event' as source, se.name, se.start_time, se.end_time, v.name as venue,
       s.name as liaison_name
FROM schedule_events se
LEFT JOIN venues v ON v.id = se.venue_id
LEFT JOIN pairings p ON p.guest_id = se.guest_id AND p.role = 'Main Liaison'
LEFT JOIN staff s ON s.id = p.staff_id
WHERE se.guest_id = :guestId AND NOT se.archived
UNION ALL
SELECT 'transport' as source, tb.pickup_location as name, tb.pickup_time as start_time,
       NULL as end_time, tb.dropoff_location as venue, tb.driver_name as liaison_name
FROM transport_bookings tb
WHERE tb.guest_id = :guestId AND NOT tb.archived
ORDER BY start_time;
```

### 2. Timeline Rendering

Day-by-day agenda format:

```
Friday, May 22, 2026
─────────────────────
 9:00 AM   ✈ Airport pickup (Logan Terminal E, Door 4)
           Driver: Mike Chen | Flight: JL008 (On Time)
11:30 AM   🏨 Hotel check-in (Hynes Marriott, Room 1204)
 1:00 PM   🎤 Sound check (Main Events Hall)
           Liaison: Hana Ito | Interpreter: Miki Nakamura
 3:00 PM   🎙 Panel: "Voice Acting in Modern Anime" (Panel Hall A, 60min)
 6:00 PM   🍽 VIP Dinner (Green Room B)

Saturday, May 23, 2026
─────────────────────
10:00 AM   ✍ Autograph Session (Autograph Hall, Table 3, 2hrs)
 1:00 PM   — Free time —
 3:00 PM   🎵 Concert rehearsal (Main Events Hall)
 7:00 PM   🎵 Concert performance (Main Events Hall)
```

**Rendering rules:**
- Events sorted chronologically within each day
- Transport events (pickup/dropoff) interleaved at their scheduled times
- Gaps >1hr shown as "Free time"
- Liaison/interpreter shown on every event where assigned
- Event type icons for quick visual scanning

### 3. In-App View

Rendered at `/guests/:id/itinerary`:
- Real-time: reflects schedule changes immediately (no regeneration needed)
- Expandable events: click to see full details (notes, equipment, special instructions)
- Current time indicator during convention (highlights "happening now")
- Navigation: jump to day, scroll through timeline

### 4. PDF Export

Print-formatted version:
- One page per convention day
- Convention branding header/footer
- QR code linking to digital version (guest's tokenized itinerary URL)
- Compact format for pocket printing (liaison copies)
- Generated via same HTML→PDF pipeline as contracts

### 5. Liaison Copy

Liaison gets a combined itinerary for all their assigned guests:

```
LIAISON ITINERARY — Hana Ito
═══════════════════════════

Friday 9:00 AM — Pickup: Arata Fujimoto (Terminal E)
Friday 1:00 PM — Sound check with Arata Fujimoto (Main Hall)
Friday 1:00 PM — Sound check with Rina Kobayashi (Main Hall)
Friday 3:00 PM — Panel with Arata Fujimoto (Panel Hall A)
...
```

Data scope: liaison's itinerary auto-filtered by pairings relation.

### 6. Config-Driven Rendering

**Acceptance Criteria:**
- [ ] Itinerary view renders from ViewConfig loaded from Postgres

**Dependencies:** `config-integration.md`

### 7. Test Plan

| Test | What | Acceptance |
|------|------|------------|
| Data aggregation | Guest with 5 events + 2 transport | All 7 items in chronological order |
| Gap detection | 3hr gap between events | "Free time" shown |
| Real-time update | Add event to guest's schedule → itinerary updates | No regeneration needed |
| PDF export | Generate PDF for 3-day guest | 3 pages, correct formatting |
| Liaison copy | Liaison with 3 guests → combined itinerary | All guests' events merged chronologically |
| Empty itinerary | Guest with no events | "No events scheduled" message |
