# Populating Operational Data

> With the ontology, RBAC, forms, views, and workflows in place, the platform is ready for data.
> Populate via SQL inserts, the API, CSV import, or manual entry through the UI.
> Cross-reference integrity matters: every foreign key must resolve.
> The examples below use Anime Boston-style data as a reference; substitute your own.

---

## Data Population Order

Order matters because of foreign key constraints. Populate in this sequence:

1. **Venues** -- no dependencies
2. **Staff** -- no dependencies
3. **Guests** -- no dependencies
4. **Schedule Events** -- references venues (optional FK)
5. **Pairings** -- references guests and staff
6. **Prep Items** -- references guests
7. **Transport Bookings** -- references guests
8. **Guest-Schedule Events** -- references guests and schedule events (junction table)

---

## 1. Venues

```sql
INSERT INTO venues (name, type, capacity, floor, building) VALUES
  ('Main Events Hall A',  'ballroom',     2000, '1st', 'Hynes Convention Center'),
  ('Main Events Hall B',  'ballroom',     1500, '1st', 'Hynes Convention Center'),
  ('Panel Room 1',        'meeting_room',  200, '2nd', 'Hynes Convention Center'),
  ('Panel Room 2',        'meeting_room',  150, '2nd', 'Hynes Convention Center'),
  ('Panel Room 3',        'meeting_room',  100, '2nd', 'Hynes Convention Center'),
  ('Autograph Hall',      'ballroom',      500, '1st', 'Hynes Convention Center'),
  ('Press Room',          'meeting_room',   50, '3rd', 'Hynes Convention Center'),
  ('Green Room',          'breakout',       30, '3rd', 'Hynes Convention Center'),
  ('Restaurant (Hotel)',  'other',          80, '1st', 'Sheraton Boston'),
  ('Lobby Meeting Point', 'lobby',         100, '1st', 'Hynes Convention Center');
```

---

## 2. Staff

```sql
INSERT INTO staff (name, email, role_key, department, phone, properties) VALUES
  ('Alex Director',     'alex@con.org',     'director',        NULL,      '555-0100', '{"reportsTo":"Board"}'),
  ('Jordan Anime Head', 'jordan@con.org',   'department_head', 'Anime',   '555-0101', '{"reportsTo":"Alex Director"}'),
  ('Sam Gaming Head',   'sam@con.org',      'department_head', 'Gaming',  '555-0102', '{"reportsTo":"Alex Director"}'),
  ('Pat Music Head',    'pat@con.org',      'department_head', 'Music',   '555-0103', '{"reportsTo":"Alex Director"}'),
  ('Robin Liaison',     'robin@con.org',    'liaison',         'Anime',   '555-0201', '{"reportsTo":"Jordan Anime Head"}'),
  ('Casey Liaison',     'casey@con.org',    'liaison',         'Anime',   '555-0202', '{"reportsTo":"Jordan Anime Head"}'),
  ('Morgan Liaison',    'morgan@con.org',   'liaison',         'Gaming',  '555-0203', '{"reportsTo":"Sam Gaming Head"}'),
  ('Riley Liaison',     'riley@con.org',    'liaison',         'Music',   '555-0204', '{"reportsTo":"Pat Music Head"}'),
  ('Haruki Interpreter','haruki@con.org',   'interpreter',     'Anime',   '555-0301', '{"languages":["ja","en"],"lineId":"haruki_line"}'),
  ('Yuki Interpreter',  'yuki@con.org',     'interpreter',     'Anime',   '555-0302', '{"languages":["ja","en"],"lineId":"yuki_line"}'),
  ('Taylor Security',   'taylor@con.org',   'volunteer',       'Anime',   '555-0401', '{"role":"Security Escort"}'),
  ('Jamie Volunteer',   'jamie@con.org',    'volunteer',       'Anime',   '555-0402', '{}'),
  ('Drew Volunteer',    'drew@con.org',     'volunteer',       'Gaming',  '555-0403', '{}'),
  ('Avery Volunteer',   'avery@con.org',    'volunteer',       'Music',   '555-0404', '{}'),
  ('Quinn Coordinator', 'quinn@con.org',    'coordinator',     NULL,      '555-0501', '{"reportsTo":"Alex Director"}'),
  ('Blake Coordinator', 'blake@con.org',    'coordinator',     NULL,      '555-0502', '{"reportsTo":"Alex Director"}'),
  ('Reese Logistics',   'reese@con.org',    'coordinator',     NULL,      '555-0503', '{"role":"Transport Coordinator"}'),
  ('Skyler AV',         'skyler@con.org',   'volunteer',       NULL,      '555-0504', '{"role":"AV Tech"}'),
  ('Dakota Runner',     'dakota@con.org',   'volunteer',       NULL,      '555-0505', '{"role":"Runner"}'),
  ('Emery Social',      'emery@con.org',    'volunteer',       NULL,      '555-0506', '{"role":"Social Media"}');
```

---

## 3. Guests

```sql
INSERT INTO guests (name, type, department, status, company, properties) VALUES
  ('Tanaka Yuto',       'JP',       'Anime',   'Confirmed', 'Sigma Seven',     '{"interpreterRequired":true,"bio":"Voice actor known for anime roles","specialHandling":["VIP"]}'),
  ('Sato Hana',         'JP',       'Anime',   'Confirmed', 'Aoni Production', '{"interpreterRequired":true,"bio":"Voice actress and singer"}'),
  ('Suzuki Riku',       'JP',       'Anime',   'Contacted', 'I''m Enterprise', '{"interpreterRequired":true}'),
  ('Mike Johnson',      'EN',       'Anime',   'Confirmed', 'Funimation',      '{"bio":"English voice actor, known for dub roles"}'),
  ('Sarah Chen',        'EN',       'Anime',   'Confirmed', 'VIZ Media',       '{"bio":"Voice director and actress"}'),
  ('David Park',        'EN',       'Gaming',  'Confirmed', 'Indie Studio',    '{"bio":"Indie game developer and streamer"}'),
  ('Yamada Mei',        'JP',       'Music',   'Confirmed', 'Lantis',          '{"interpreterRequired":true,"bio":"Anisong artist","specialHandling":["VIP","Green Room"]}'),
  ('DJ Matsumoto',      'JP',       'Music',   'Wishlist',  'Avex',            '{"interpreterRequired":true}'),
  ('Emily Roberts',     'EN',       'Cosplay', 'Confirmed', 'Independent',     '{"bio":"Professional cosplayer and costume designer"}'),
  ('Carlos Mendez',     'Industry', 'Industry','Confirmed', 'Crunchyroll',     '{"bio":"Director of Partnerships at Crunchyroll"}'),
  ('Lisa Watanabe',     'EN',       'Artists', 'Confirmed', 'Independent',     '{"bio":"Manga-style illustrator and character designer"}'),
  ('James O''Brien',    'EN',       'Panels',  'Contacted', 'Podcast Network', '{"bio":"Anime podcast host with 200k subscribers"}');
```

---

## 4. Schedule Events

Schedule events reference venues. You need to look up venue IDs first, or use a subquery.

```sql
-- Using subqueries for venue_id
INSERT INTO schedule_events (name, event_type, venue_id, start_time, end_time, status, properties) VALUES
  ('Opening Ceremony',
   'Panel',
   (SELECT id FROM venues WHERE name = 'Main Events Hall A'),
   '2026-05-22 10:00:00-04',
   '2026-05-22 11:00:00-04',
   'confirmed',
   '{"description":"Convention opening with guest introductions"}'),

  ('Tanaka Yuto Q&A Panel',
   'Panel',
   (SELECT id FROM venues WHERE name = 'Panel Room 1'),
   '2026-05-22 13:00:00-04',
   '2026-05-22 14:00:00-04',
   'confirmed',
   '{}'),

  ('Autograph Session - Block 1',
   'Autograph Session',
   (SELECT id FROM venues WHERE name = 'Autograph Hall'),
   '2026-05-22 14:30:00-04',
   '2026-05-22 16:00:00-04',
   'confirmed',
   '{}'),

  ('Guest Welcome Dinner',
   'Meal',
   (SELECT id FROM venues WHERE name = 'Restaurant (Hotel)'),
   '2026-05-22 18:00:00-04',
   '2026-05-22 20:00:00-04',
   'confirmed',
   '{"description":"Welcome dinner for all confirmed guests"}'),

  ('Yamada Mei Concert',
   'Panel',
   (SELECT id FROM venues WHERE name = 'Main Events Hall A'),
   '2026-05-22 20:00:00-04',
   '2026-05-22 21:30:00-04',
   'confirmed',
   '{"description":"Live anisong performance"}'),

  ('David Park - Game Dev Talk',
   'Panel',
   (SELECT id FROM venues WHERE name = 'Panel Room 2'),
   '2026-05-23 10:00:00-04',
   '2026-05-23 11:00:00-04',
   'confirmed',
   '{}'),

  ('Photo Op Session',
   'Photo Op',
   (SELECT id FROM venues WHERE name = 'Press Room'),
   '2026-05-23 11:30:00-04',
   '2026-05-23 13:00:00-04',
   'confirmed',
   '{}'),

  ('Sato Hana & Mike Johnson Dub Panel',
   'Panel',
   (SELECT id FROM venues WHERE name = 'Panel Room 1'),
   '2026-05-23 14:00:00-04',
   '2026-05-23 15:00:00-04',
   'confirmed',
   '{"description":"EN vs JP dubbing discussion"}'),

  ('Cosplay Construction Workshop',
   'Panel',
   (SELECT id FROM venues WHERE name = 'Panel Room 3'),
   '2026-05-23 15:30:00-04',
   '2026-05-23 17:00:00-04',
   'confirmed',
   '{}'),

  ('Closing Ceremony',
   'Panel',
   (SELECT id FROM venues WHERE name = 'Main Events Hall A'),
   '2026-05-24 16:00:00-04',
   '2026-05-24 17:00:00-04',
   'confirmed',
   '{"description":"Convention closing with guest farewells"}');
```

---

## 5. Pairings

Pairings connect guests to staff. You need the IDs from the guests and staff you just inserted.

```sql
-- Pair liaisons and interpreters to guests (using name subqueries)
INSERT INTO pairings (guest_id, staff_id, role) VALUES
  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto'),   (SELECT id FROM staff WHERE name = 'Robin Liaison'),      'Main Liaison'),
  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto'),   (SELECT id FROM staff WHERE name = 'Haruki Interpreter'), 'Interpreter'),
  ((SELECT id FROM guests WHERE name = 'Sato Hana'),     (SELECT id FROM staff WHERE name = 'Casey Liaison'),      'Main Liaison'),
  ((SELECT id FROM guests WHERE name = 'Sato Hana'),     (SELECT id FROM staff WHERE name = 'Yuki Interpreter'),   'Interpreter'),
  ((SELECT id FROM guests WHERE name = 'Mike Johnson'),  (SELECT id FROM staff WHERE name = 'Robin Liaison'),      'Backup Liaison'),
  ((SELECT id FROM guests WHERE name = 'Sarah Chen'),    (SELECT id FROM staff WHERE name = 'Casey Liaison'),      'Backup Liaison'),
  ((SELECT id FROM guests WHERE name = 'David Park'),    (SELECT id FROM staff WHERE name = 'Morgan Liaison'),     'Main Liaison'),
  ((SELECT id FROM guests WHERE name = 'Yamada Mei'),    (SELECT id FROM staff WHERE name = 'Riley Liaison'),      'Main Liaison'),
  ((SELECT id FROM guests WHERE name = 'Yamada Mei'),    (SELECT id FROM staff WHERE name = 'Haruki Interpreter'), 'Interpreter'),
  ((SELECT id FROM guests WHERE name = 'Yamada Mei'),    (SELECT id FROM staff WHERE name = 'Taylor Security'),    'Security Escort'),
  ((SELECT id FROM guests WHERE name = 'Emily Roberts'), (SELECT id FROM staff WHERE name = 'Casey Liaison'),      'Main Liaison'),
  ((SELECT id FROM guests WHERE name = 'Carlos Mendez'), (SELECT id FROM staff WHERE name = 'Quinn Coordinator'),  'Main Liaison');
```

---

## 6. Prep Items

```sql
-- Standard prep items for each confirmed guest
-- Using a CTE to iterate over confirmed guests
WITH confirmed_guests AS (
  SELECT id, name FROM guests WHERE status = 'Confirmed'
)
INSERT INTO prep_items (name, guest_id, status, due_date) SELECT
  task.name, g.id, 'incomplete', '2026-05-01'
FROM confirmed_guests g
CROSS JOIN (VALUES
  ('Book Hotel'),
  ('Confirm Dietary Requirements'),
  ('Generate Appearance Contract'),
  ('Arrange Airport Transport'),
  ('Confirm Autograph Session'),
  ('Brief Liaison on Preferences')
) AS task(name);

-- Mark some prep items as complete for the fully-confirmed guests
UPDATE prep_items
SET status = 'complete'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Tanaka Yuto')
  AND name IN ('Book Hotel', 'Confirm Dietary Requirements');

UPDATE prep_items
SET status = 'in_progress'
WHERE guest_id = (SELECT id FROM guests WHERE name = 'Tanaka Yuto')
  AND name = 'Generate Appearance Contract';
```

---

## 7. Transport Bookings

```sql
INSERT INTO transport_bookings (guest_id, booking_type, status, pickup_location, dropoff_location, scheduled_time, flight_number)
VALUES
  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto'),
   'arrival', 'confirmed', 'Logan Airport Terminal E', 'Sheraton Boston Hotel',
   '2026-05-21 14:30:00-04', 'JL006'),

  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto'),
   'departure', 'requested', 'Sheraton Boston Hotel', 'Logan Airport Terminal E',
   '2026-05-25 10:00:00-04', 'JL005'),

  ((SELECT id FROM guests WHERE name = 'Sato Hana'),
   'arrival', 'confirmed', 'Logan Airport Terminal E', 'Sheraton Boston Hotel',
   '2026-05-21 16:00:00-04', 'NH108'),

  ((SELECT id FROM guests WHERE name = 'Yamada Mei'),
   'arrival', 'requested', 'Logan Airport Terminal E', 'Sheraton Boston Hotel',
   '2026-05-21 12:00:00-04', 'DL456'),

  ((SELECT id FROM guests WHERE name = 'Mike Johnson'),
   'arrival', 'confirmed', 'Logan Airport Terminal B', 'Sheraton Boston Hotel',
   '2026-05-21 18:00:00-04', 'AA1234');
```

---

## 8. Guest-Schedule Events (Junction Table)

Link guests to their schedule events.

```sql
INSERT INTO guest_schedule_events (guest_id, schedule_event_id, role) VALUES
  -- Opening Ceremony: all confirmed guests attend
  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto'),
   (SELECT id FROM schedule_events WHERE name = 'Opening Ceremony'), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Sato Hana'),
   (SELECT id FROM schedule_events WHERE name = 'Opening Ceremony'), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Mike Johnson'),
   (SELECT id FROM schedule_events WHERE name = 'Opening Ceremony'), 'panelist'),

  -- Tanaka Yuto Q&A
  ((SELECT id FROM guests WHERE name = 'Tanaka Yuto'),
   (SELECT id FROM schedule_events WHERE name = 'Tanaka Yuto Q&A Panel'), 'panelist'),

  -- Yamada Mei Concert
  ((SELECT id FROM guests WHERE name = 'Yamada Mei'),
   (SELECT id FROM schedule_events WHERE name = 'Yamada Mei Concert'), 'performer'),

  -- David Park Game Dev Talk
  ((SELECT id FROM guests WHERE name = 'David Park'),
   (SELECT id FROM schedule_events WHERE name = 'David Park - Game Dev Talk'), 'panelist'),

  -- Dub Panel
  ((SELECT id FROM guests WHERE name = 'Sato Hana'),
   (SELECT id FROM schedule_events WHERE name = 'Sato Hana & Mike Johnson Dub Panel'), 'panelist'),
  ((SELECT id FROM guests WHERE name = 'Mike Johnson'),
   (SELECT id FROM schedule_events WHERE name = 'Sato Hana & Mike Johnson Dub Panel'), 'panelist');
```

---

## Alternative Population Methods

### Via the API

```bash
# Create a guest via the REST API
curl -X POST http://localhost:8080/api/domains/guest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Tanaka Yuto",
    "type": "JP",
    "department": "Anime",
    "status": "Confirmed",
    "company": "Sigma Seven",
    "properties": {"interpreterRequired": true}
  }'
```

### Via the UI

Once the platform is running with ontology and RBAC configured:

1. Log in as a director.
2. Navigate to Guests > click "Add Guest."
3. Fill out the guest intake form.
4. Repeat for each guest.

### Via CSV Import

The platform supports CSV import through the UI (Settings > Import). The import maps CSV columns to ontology properties.

### Via JSON Seed Files

For repeatable seeding (e.g., across environments), create JSON files and write a seed script:

```typescript
// seed-data.ts
import { readFileSync } from 'fs'

const guests = JSON.parse(readFileSync('seeds/guests.json', 'utf-8'))
for (const guest of guests) {
  await api.post('/api/domains/guest', guest)
}
```

---

## Cross-Reference Integrity

After populating data, verify that all foreign keys resolve:

```sql
-- Pairings: all guest_id and staff_id must exist
SELECT p.id, p.role
FROM pairings p
LEFT JOIN guests g ON g.id = p.guest_id
LEFT JOIN staff s ON s.id = p.staff_id
WHERE g.id IS NULL OR s.id IS NULL;
-- Should return 0 rows

-- Prep items: all guest_id must exist
SELECT pi.id, pi.name
FROM prep_items pi
LEFT JOIN guests g ON g.id = pi.guest_id
WHERE g.id IS NULL;
-- Should return 0 rows

-- Transport: all guest_id must exist
SELECT tb.id
FROM transport_bookings tb
LEFT JOIN guests g ON g.id = tb.guest_id
WHERE g.id IS NULL;
-- Should return 0 rows

-- Schedule events: all venue_id must exist (if set)
SELECT se.id, se.name
FROM schedule_events se
LEFT JOIN venues v ON v.id = se.venue_id
WHERE se.venue_id IS NOT NULL AND v.id IS NULL;
-- Should return 0 rows
```

---

## Verification

```sql
-- Record counts
SELECT 'guests' AS entity, count(*) FROM guests WHERE NOT archived
UNION ALL
SELECT 'staff', count(*) FROM staff WHERE NOT archived
UNION ALL
SELECT 'schedule_events', count(*) FROM schedule_events WHERE NOT archived
UNION ALL
SELECT 'pairings', count(*) FROM pairings WHERE NOT archived
UNION ALL
SELECT 'prep_items', count(*) FROM prep_items WHERE NOT archived
UNION ALL
SELECT 'transport_bookings', count(*) FROM transport_bookings WHERE NOT archived
UNION ALL
SELECT 'venues', count(*) FROM venues WHERE NOT archived;

-- Verify via the API
curl http://localhost:8080/api/domains/guest | jq '.data | length'
curl http://localhost:8080/api/domains/staff | jq '.data | length'
curl http://localhost:8080/api/domains/schedule | jq '.data | length'
```

---

## Next Step

[08-demo-mode.md -- Demo Mode (Optional)](08-demo-mode.md) or [09-verification.md -- Launch Verification](09-verification.md)
