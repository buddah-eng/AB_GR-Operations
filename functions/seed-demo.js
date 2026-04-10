/**
 * Authoritative seed script for GR-Ops (Anime Boston 2026)
 *
 * Usage:  DATABASE_URL="postgres://..." node functions/seed-demo.js
 *
 * - Idempotent: uses ON CONFLICT / DELETE-then-INSERT where needed
 * - Follows FK order: ontology -> roles -> permissions -> venues -> staff
 *   -> guests -> schedule_events -> guest_schedule_events -> pairings
 *   -> prep_items -> transport_bookings -> users -> configs
 */

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

// ---------------------------------------------------------------------------
// Data definitions
// ---------------------------------------------------------------------------

const CONCEPTS = [
  { key: 'guest', name: 'Guest', plural: 'Guests', icon: 'pi pi-users', desc: 'Invited convention guests', is_registry: false, is_config: false },
  { key: 'staff', name: 'Staff', plural: 'Staff', icon: 'pi pi-id-card', desc: 'Convention staff members', is_registry: false, is_config: false },
  { key: 'schedule', name: 'Event', plural: 'Schedule', icon: 'pi pi-calendar', desc: 'Convention schedule events', is_registry: false, is_config: false },
  { key: 'venue', name: 'Venue', plural: 'Venues', icon: 'pi pi-map-marker', desc: 'Convention venues and rooms', is_registry: false, is_config: true },
  { key: 'pairing', name: 'Pairing', plural: 'Pairings', icon: 'pi pi-link', desc: 'Guest-staff role assignments', is_registry: false, is_config: false },
  { key: 'prep_item', name: 'Prep Item', plural: 'Prep Tracker', icon: 'pi pi-check-square', desc: 'Pre-event preparation tasks', is_registry: false, is_config: false },
  { key: 'transport', name: 'Transport', plural: 'Transport', icon: 'pi pi-car', desc: 'Transport and travel bookings', is_registry: false, is_config: false },
  { key: 'convention', name: 'Convention', plural: 'Conventions', icon: 'pi pi-globe', desc: 'Convention instance configuration', is_registry: false, is_config: true },
  { key: 'guest_registry', name: 'Guest Registry', plural: 'Guest Registry', icon: 'pi pi-database', desc: 'Multi-year guest history and CRM', is_registry: true, is_config: false },
]

const PROPERTIES = [
  // guest properties
  { concept_key: 'guest', key: 'name', label: 'Guest Name', type: 'text', required: true, sort_order: 1 },
  { concept_key: 'guest', key: 'type', label: 'Guest Type', type: 'select', required: true, sort_order: 2, options: JSON.stringify([{ value: 'JP', label: 'Japanese' }, { value: 'NA', label: 'North American' }, { value: 'Industry', label: 'Industry' }]) },
  { concept_key: 'guest', key: 'department', label: 'Department', type: 'select', required: true, sort_order: 3, options: JSON.stringify([{ value: 'Anime', label: 'Anime' }, { value: 'Gaming', label: 'Gaming' }, { value: 'Music', label: 'Music' }, { value: 'Cosplay', label: 'Cosplay' }, { value: 'Panels', label: 'Panels' }, { value: 'Artists', label: 'Artists' }, { value: 'Industry', label: 'Industry' }]) },
  { concept_key: 'guest', key: 'status', label: 'Status', type: 'select', required: true, sort_order: 4, options: JSON.stringify([{ value: 'draft', label: 'Draft' }, { value: 'invited', label: 'Invited' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'travel_arranged', label: 'Travel Arranged' }, { value: 'arrived', label: 'Arrived' }, { value: 'cancelled', label: 'Cancelled' }]) },
  { concept_key: 'guest', key: 'company', label: 'Company/Affiliation', type: 'text', required: false, sort_order: 5 },
  { concept_key: 'guest', key: 'interpreter_required', label: 'Interpreter Required', type: 'checkbox', required: false, sort_order: 6 },
  { concept_key: 'guest', key: 'bio', label: 'Bio', type: 'rich_text', required: false, sort_order: 7 },
  { concept_key: 'guest', key: 'dietary', label: 'Dietary Requirements', type: 'text', required: false, sort_order: 8 },
  { concept_key: 'guest', key: 'pronouns', label: 'Pronouns', type: 'text', required: false, sort_order: 9 },
  { concept_key: 'guest', key: 'research_links', label: 'Research Links', type: 'rich_text', required: false, sort_order: 10 },

  // staff properties
  { concept_key: 'staff', key: 'name', label: 'Staff Name', type: 'text', required: true, sort_order: 1 },
  { concept_key: 'staff', key: 'email', label: 'Email', type: 'email', required: true, sort_order: 2 },
  { concept_key: 'staff', key: 'role_key', label: 'Role', type: 'select', required: true, sort_order: 3, options: JSON.stringify([{ value: 'director', label: 'Director' }, { value: 'department_head', label: 'Department Head' }, { value: 'coordinator', label: 'Coordinator' }, { value: 'liaison', label: 'Liaison' }, { value: 'interpreter', label: 'Interpreter' }, { value: 'volunteer', label: 'Volunteer' }]) },
  { concept_key: 'staff', key: 'department', label: 'Department', type: 'select', required: true, sort_order: 4, options: JSON.stringify([{ value: 'Anime', label: 'Anime' }, { value: 'Gaming', label: 'Gaming' }, { value: 'Music', label: 'Music' }, { value: 'Cosplay', label: 'Cosplay' }, { value: 'Panels', label: 'Panels' }, { value: 'Artists', label: 'Artists' }, { value: 'Industry', label: 'Industry' }]) },
  { concept_key: 'staff', key: 'phone', label: 'Phone', type: 'text', required: false, sort_order: 5 },
  { concept_key: 'staff', key: 'availability', label: 'Availability', type: 'select', required: false, sort_order: 6, options: JSON.stringify([{ value: 'available', label: 'Available' }, { value: 'limited', label: 'Limited' }, { value: 'unavailable', label: 'Unavailable' }]) },

  // schedule properties
  { concept_key: 'schedule', key: 'name', label: 'Activity', type: 'text', required: true, sort_order: 1 },
  { concept_key: 'schedule', key: 'event_type', label: 'Event Type', type: 'select', required: true, sort_order: 2, options: JSON.stringify([{ value: 'Panel', label: 'Panel' }, { value: 'Autograph Session', label: 'Autograph Session' }, { value: 'Photo Op', label: 'Photo Op' }, { value: 'Meal', label: 'Meal' }, { value: 'Photoshoot', label: 'Photoshoot' }, { value: 'Interview', label: 'Interview' }, { value: 'Rehearsal', label: 'Rehearsal' }, { value: 'Meet & Greet', label: 'Meet & Greet' }, { value: 'Other', label: 'Other' }]) },
  { concept_key: 'schedule', key: 'venue', label: 'Venue', type: 'relation', required: false, sort_order: 3 },
  { concept_key: 'schedule', key: 'date', label: 'Date', type: 'date', required: true, sort_order: 4 },
  { concept_key: 'schedule', key: 'start_time', label: 'Start Time', type: 'text', required: true, sort_order: 5 },
  { concept_key: 'schedule', key: 'end_time', label: 'End Time', type: 'text', required: true, sort_order: 6 },
  { concept_key: 'schedule', key: 'status', label: 'Status', type: 'select', required: false, sort_order: 7, options: JSON.stringify([{ value: 'draft', label: 'Draft' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'cancelled', label: 'Cancelled' }]) },

  // venue properties
  { concept_key: 'venue', key: 'name', label: 'Venue Name', type: 'text', required: true, sort_order: 1 },
  { concept_key: 'venue', key: 'type', label: 'Venue Type', type: 'select', required: true, sort_order: 2, options: JSON.stringify([{ value: 'ballroom', label: 'Ballroom' }, { value: 'meeting_room', label: 'Meeting Room' }, { value: 'outdoor', label: 'Outdoor' }, { value: 'theater', label: 'Theater' }, { value: 'breakout', label: 'Breakout' }, { value: 'lobby', label: 'Lobby' }, { value: 'other', label: 'Other' }]) },
  { concept_key: 'venue', key: 'capacity', label: 'Capacity', type: 'number', required: false, sort_order: 3 },
  { concept_key: 'venue', key: 'floor', label: 'Floor', type: 'text', required: false, sort_order: 4 },
  { concept_key: 'venue', key: 'building', label: 'Building', type: 'text', required: false, sort_order: 5 },

  // pairing properties
  { concept_key: 'pairing', key: 'guest_id', label: 'Guest', type: 'relation', required: true, sort_order: 1 },
  { concept_key: 'pairing', key: 'staff_id', label: 'Staff', type: 'relation', required: true, sort_order: 2 },
  { concept_key: 'pairing', key: 'role', label: 'Role', type: 'select', required: true, sort_order: 3, options: JSON.stringify([{ value: 'Main Liaison', label: 'Main Liaison' }, { value: 'Backup Liaison', label: 'Backup Liaison' }, { value: 'Interpreter', label: 'Interpreter' }, { value: 'Security Escort', label: 'Security Escort' }]) },
  { concept_key: 'pairing', key: 'status', label: 'Status', type: 'select', required: false, sort_order: 4, options: JSON.stringify([{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]) },
  { concept_key: 'pairing', key: 'notes', label: 'Notes', type: 'rich_text', required: false, sort_order: 5 },

  // prep_item properties
  { concept_key: 'prep_item', key: 'name', label: 'Item', type: 'text', required: true, sort_order: 1 },
  { concept_key: 'prep_item', key: 'guest_id', label: 'Guest', type: 'relation', required: true, sort_order: 2 },
  { concept_key: 'prep_item', key: 'status', label: 'Status', type: 'select', required: true, sort_order: 3, options: JSON.stringify([{ value: 'incomplete', label: 'Incomplete' }, { value: 'in_progress', label: 'In Progress' }, { value: 'complete', label: 'Complete' }]) },
  { concept_key: 'prep_item', key: 'due_date', label: 'Due Date', type: 'date', required: false, sort_order: 4 },
  { concept_key: 'prep_item', key: 'owner', label: 'Owner', type: 'text', required: false, sort_order: 5 },

  // transport properties
  { concept_key: 'transport', key: 'booking_type', label: 'Booking Type', type: 'select', required: true, sort_order: 1, options: JSON.stringify([{ value: 'arrival', label: 'Arrival' }, { value: 'departure', label: 'Departure' }, { value: 'inter_venue', label: 'Inter-Venue' }]) },
  { concept_key: 'transport', key: 'guest_id', label: 'Guest', type: 'relation', required: true, sort_order: 2 },
  { concept_key: 'transport', key: 'pickup_location', label: 'Pickup Location', type: 'text', required: false, sort_order: 3 },
  { concept_key: 'transport', key: 'dropoff_location', label: 'Dropoff Location', type: 'text', required: false, sort_order: 4 },
  { concept_key: 'transport', key: 'scheduled_time', label: 'Scheduled Time', type: 'datetime', required: false, sort_order: 5 },
  { concept_key: 'transport', key: 'driver_name', label: 'Driver', type: 'text', required: false, sort_order: 6 },
  { concept_key: 'transport', key: 'vehicle_info', label: 'Vehicle', type: 'text', required: false, sort_order: 7 },
  { concept_key: 'transport', key: 'flight_number', label: 'Flight Number', type: 'text', required: false, sort_order: 8 },

  // convention properties
  { concept_key: 'convention', key: 'name', label: 'Convention Name', type: 'text', required: true, sort_order: 1 },
  { concept_key: 'convention', key: 'start_date', label: 'Start Date', type: 'date', required: true, sort_order: 2 },
  { concept_key: 'convention', key: 'end_date', label: 'End Date', type: 'date', required: true, sort_order: 3 },
  { concept_key: 'convention', key: 'venue_name', label: 'Venue', type: 'text', required: false, sort_order: 4 },
  { concept_key: 'convention', key: 'logo_url', label: 'Logo URL', type: 'text', required: false, sort_order: 5 },

  // guest_registry properties
  { concept_key: 'guest_registry', key: 'guest_name', label: 'Guest Name', type: 'text', required: true, sort_order: 1 },
  { concept_key: 'guest_registry', key: 'years_attended', label: 'Years Attended', type: 'text', required: false, sort_order: 2 },
  { concept_key: 'guest_registry', key: 'total_events', label: 'Total Events', type: 'number', required: false, sort_order: 3 },
  { concept_key: 'guest_registry', key: 'notes', label: 'Notes', type: 'rich_text', required: false, sort_order: 4 },
  { concept_key: 'guest_registry', key: 'last_attended', label: 'Last Attended', type: 'date', required: false, sort_order: 5 },
]

const RELATIONSHIPS = [
  { source: 'guest', target: 'pairing', key: 'has_pairings', label: 'Staff Assignments', cardinality: 'has-many', inverse: 'for_guest' },
  { source: 'guest', target: 'schedule', key: 'has_schedule', label: 'Schedule Events', cardinality: 'has-many', inverse: 'for_guest' },
  { source: 'guest', target: 'prep_item', key: 'has_prep', label: 'Prep Items', cardinality: 'has-many', inverse: 'for_guest' },
  { source: 'guest', target: 'transport', key: 'has_transport', label: 'Transport Bookings', cardinality: 'has-many', inverse: 'for_guest' },
  { source: 'staff', target: 'pairing', key: 'has_assignments', label: 'Guest Assignments', cardinality: 'has-many', inverse: 'assigned_staff' },
  { source: 'schedule', target: 'venue', key: 'at_venue', label: 'Venue', cardinality: 'has-one', inverse: 'hosts_events' },
  { source: 'guest_registry', target: 'guest', key: 'current_instance', label: 'Current Guest Record', cardinality: 'has-one', inverse: 'registry_entry' },
]

const ROLES = [
  { key: 'director', name: 'Director', description: 'Full system access, convention leadership', priority: 100, is_operational: false },
  { key: 'department_head', name: 'Department Head', description: 'Department-level management', priority: 80, is_operational: false },
  { key: 'coordinator', name: 'Coordinator', description: 'Operations coordination', priority: 60, is_operational: true },
  { key: 'liaison', name: 'Liaison', description: 'Direct guest liaison', priority: 40, is_operational: true },
  { key: 'interpreter', name: 'Interpreter', description: 'Language interpretation for guests', priority: 30, is_operational: true },
  { key: 'volunteer', name: 'Volunteer', description: 'General volunteer support', priority: 10, is_operational: true },
  { key: 'viewer', name: 'Viewer', description: 'Read-only access', priority: 5, is_operational: false },
]

const ALL_CONCEPT_KEYS = CONCEPTS.map((c) => c.key)

const PERMISSIONS_DIRECTOR = ALL_CONCEPT_KEYS.map((ck) => ({
  role_key: 'director',
  concept_key: ck,
  can_view: true,
  can_create: true,
  can_edit: true,
  can_delete: true,
}))

const PERMISSIONS_VIEWER = ALL_CONCEPT_KEYS.map((ck) => ({
  role_key: 'viewer',
  concept_key: ck,
  can_view: true,
  can_create: false,
  can_edit: false,
  can_delete: false,
}))

const VENUES = [
  { name: 'Main Events Hall A', type: 'ballroom', capacity: 1200, floor: '1', building: 'Hynes Convention Center', equipment: ['stage', 'projector', 'sound_system', 'lighting'] },
  { name: 'Main Events Hall B', type: 'ballroom', capacity: 800, floor: '1', building: 'Hynes Convention Center', equipment: ['stage', 'projector', 'sound_system'] },
  { name: 'Panel Room 1', type: 'meeting_room', capacity: 200, floor: '2', building: 'Hynes Convention Center', equipment: ['projector', 'microphones'] },
  { name: 'Panel Room 2', type: 'meeting_room', capacity: 150, floor: '2', building: 'Hynes Convention Center', equipment: ['projector', 'microphones'] },
  { name: 'Panel Room 3', type: 'meeting_room', capacity: 100, floor: '2', building: 'Hynes Convention Center', equipment: ['projector'] },
  { name: 'Autograph Hall', type: 'ballroom', capacity: 300, floor: '1', building: 'Hynes Convention Center', equipment: ['tables', 'queue_barriers'] },
  { name: 'Green Room', type: 'breakout', capacity: 30, floor: '1', building: 'Hynes Convention Center', equipment: ['refreshments', 'seating'] },
  { name: 'Press Room', type: 'meeting_room', capacity: 50, floor: '2', building: 'Hynes Convention Center', equipment: ['backdrop', 'microphones', 'cameras'] },
]

const STAFF_DATA = [
  { name: 'Hiro Tanaka', role: 'department_head', dept: 'Anime', email: 'hiro@animeboston.org', phone: '617-555-0101' },
  { name: 'Kevin Nakamura', role: 'liaison', dept: 'Anime', email: 'kevin@animeboston.org', phone: '617-555-0102' },
  { name: 'Yuki Sato', role: 'interpreter', dept: 'Anime', email: 'yuki@animeboston.org', phone: '617-555-0103' },
  { name: 'Marcus Johnson', role: 'liaison', dept: 'Anime', email: 'marcus@animeboston.org', phone: '617-555-0104' },
  { name: 'Rachel Torres', role: 'coordinator', dept: 'Anime', email: 'rachel@animeboston.org', phone: '617-555-0105' },
  { name: 'Tomoko Hayashi', role: 'liaison', dept: 'Music', email: 'tomoko@animeboston.org', phone: '617-555-0106' },
  { name: 'Chris Williams', role: 'interpreter', dept: 'Music', email: 'chris@animeboston.org', phone: '617-555-0107' },
  { name: 'Aisha Patel', role: 'coordinator', dept: 'Music', email: 'aisha@animeboston.org', phone: '617-555-0108' },
  { name: 'Sam Chen', role: 'liaison', dept: 'Cosplay', email: 'sam@animeboston.org', phone: '617-555-0109' },
  { name: 'Diana Rodriguez', role: 'coordinator', dept: 'Cosplay', email: 'diana@animeboston.org', phone: '617-555-0110' },
  { name: 'Lisa Park', role: 'liaison', dept: 'Industry', email: 'lisa@animeboston.org', phone: '617-555-0111' },
  { name: 'Jake Morrison', role: 'coordinator', dept: 'Industry', email: 'jake@animeboston.org', phone: '617-555-0112' },
  { name: 'Mei Lin', role: 'liaison', dept: 'Panels', email: 'mei@animeboston.org', phone: '617-555-0113' },
  { name: 'Derek Chang', role: 'coordinator', dept: 'Artists', email: 'derek@animeboston.org', phone: '617-555-0114' },
  { name: 'Nina Volkov', role: 'liaison', dept: 'Gaming', email: 'nina@animeboston.org', phone: '617-555-0115' },
  { name: 'Tom Bradley', role: 'department_head', dept: 'Music', email: 'tom@animeboston.org', phone: '617-555-0116' },
  { name: 'Ana Costa', role: 'volunteer', dept: 'Anime', email: 'ana@animeboston.org', phone: '617-555-0117' },
  { name: 'Ben Foster', role: 'volunteer', dept: 'Music', email: 'ben@animeboston.org', phone: '617-555-0118' },
  { name: 'Kenji Watanabe', role: 'interpreter', dept: 'Industry', email: 'kenji@animeboston.org', phone: '617-555-0119' },
  { name: 'Priya Sharma', role: 'volunteer', dept: 'Cosplay', email: 'priya@animeboston.org', phone: '617-555-0120' },
]

const GUEST_DATA = [
  { name: 'Tanaka Ichiro', type: 'JP', dept: 'Anime', status: 'confirmed', company: 'Sunrise Studios', interp: true, bio: 'Veteran voice actor known for roles in Gundam and My Hero Academia.', dietary: 'None', pronouns: 'he/him' },
  { name: 'Suzuki Yui', type: 'JP', dept: 'Anime', status: 'travel_arranged', company: 'Shueisha', interp: true, bio: 'Award-winning manga artist, creator of Starlight Requiem.', dietary: 'Vegetarian', pronouns: 'she/her' },
  { name: 'Yamamoto Ken', type: 'JP', dept: 'Industry', status: 'confirmed', company: 'Toei Animation', interp: true, bio: 'Acclaimed anime director with 20+ years at Toei Animation.', dietary: 'None', pronouns: 'he/him' },
  { name: 'Nakamura Rin', type: 'JP', dept: 'Music', status: 'arrived', company: 'Sony Music Japan', interp: true, bio: 'J-pop and anisong singer with multiple platinum albums.', dietary: 'Gluten-free', pronouns: 'she/her' },
  { name: 'Alex Chen', type: 'NA', dept: 'Cosplay', status: 'confirmed', company: 'Independent', interp: false, bio: 'Award-winning cosplayer and prop maker, known for elaborate mech builds.', dietary: 'None', pronouns: 'they/them' },
  { name: 'Sarah Mitchell', type: 'NA', dept: 'Panels', status: 'invited', company: 'Mitchell Media LLC', interp: false, bio: 'Anime YouTuber with 2.3M subscribers, host of "Anime Decoded."', dietary: 'Vegan', pronouns: 'she/her' },
  { name: 'Jordan Lee', type: 'NA', dept: 'Anime', status: 'confirmed', company: 'Funimation / Crunchyroll', interp: false, bio: 'English voice actor for 50+ anime dubs including top shonen titles.', dietary: 'None', pronouns: 'he/him' },
  { name: 'Maria Garcia', type: 'NA', dept: 'Artists', status: 'draft', company: 'Independent Artist', interp: false, bio: 'Digital artist specializing in anime-inspired character illustrations.', dietary: 'Kosher', pronouns: 'she/her' },
  { name: 'Takeshi Mori', type: 'JP', dept: 'Gaming', status: 'confirmed', company: 'Bandai Namco', interp: true, bio: 'Game designer, led development of Tales of Arise and Tekken 8.', dietary: 'None', pronouns: 'he/him' },
  { name: 'Emily Park', type: 'NA', dept: 'Music', status: 'travel_arranged', company: 'K-Wave Dance Studio', interp: false, bio: 'Choreographer and performer specializing in anime and K-pop dance.', dietary: 'None', pronouns: 'she/her' },
  { name: 'David Kim', type: 'Industry', dept: 'Industry', status: 'confirmed', company: 'Aniplex of America', interp: false, bio: 'VP of Marketing at Aniplex of America, overseeing licensing strategy.', dietary: 'Halal', pronouns: 'he/him' },
  { name: 'Luna Martinez', type: 'NA', dept: 'Music', status: 'arrived', company: 'Independent Musician', interp: false, bio: 'Multi-instrumentalist performing anime cover concerts worldwide.', dietary: 'None', pronouns: 'she/her' },
]

// event index references guest index via `guests` array index
const EVENTS = [
  { name: 'Opening Ceremony', type: 'Panel', guestIdx: [0, 6], venue: 'Main Events Hall A', date: '2026-04-03', start: '10:00', end: '11:00' },
  { name: 'Voice Acting Masterclass', type: 'Panel', guestIdx: [0], venue: 'Panel Room 1', date: '2026-04-03', start: '13:00', end: '14:30' },
  { name: 'Manga Creation Workshop', type: 'Panel', guestIdx: [1], venue: 'Panel Room 2', date: '2026-04-03', start: '11:00', end: '12:30' },
  { name: 'Tanaka Autograph Session', type: 'Autograph Session', guestIdx: [0], venue: 'Autograph Hall', date: '2026-04-03', start: '15:00', end: '16:30' },
  { name: 'Guest Welcome Dinner', type: 'Meal', guestIdx: [0, 1, 2, 3], venue: 'Green Room', date: '2026-04-03', start: '18:00', end: '20:00' },
  { name: 'Suzuki Art Demo', type: 'Panel', guestIdx: [1], venue: 'Panel Room 1', date: '2026-04-04', start: '10:00', end: '11:30' },
  { name: 'Industry Keynote', type: 'Panel', guestIdx: [2, 10], venue: 'Main Events Hall A', date: '2026-04-04', start: '14:00', end: '15:00' },
  { name: 'Nakamura Concert', type: 'Other', guestIdx: [3], venue: 'Main Events Hall B', date: '2026-04-04', start: '19:00', end: '21:00' },
  { name: 'Cosplay Workshop', type: 'Panel', guestIdx: [4], venue: 'Panel Room 2', date: '2026-04-04', start: '11:00', end: '12:30' },
  { name: 'Jordan Lee VA Panel', type: 'Panel', guestIdx: [6], venue: 'Panel Room 1', date: '2026-04-04', start: '16:00', end: '17:30' },
  { name: 'Gaming Industry Panel', type: 'Panel', guestIdx: [8], venue: 'Panel Room 1', date: '2026-04-05', start: '10:00', end: '11:30' },
  { name: 'Dance Workshop', type: 'Panel', guestIdx: [9], venue: 'Main Events Hall B', date: '2026-04-05', start: '11:00', end: '12:30' },
  { name: 'Aniplex Presentation', type: 'Panel', guestIdx: [10], venue: 'Main Events Hall A', date: '2026-04-05', start: '13:00', end: '14:00' },
  { name: 'Luna Concert', type: 'Other', guestIdx: [11], venue: 'Main Events Hall B', date: '2026-04-05', start: '15:00', end: '16:30' },
  { name: 'Closing Ceremony', type: 'Other', guestIdx: [0, 6, 11], venue: 'Main Events Hall A', date: '2026-04-05', start: '17:00', end: '18:00' },
  { name: 'Mori Autograph Session', type: 'Autograph Session', guestIdx: [8], venue: 'Autograph Hall', date: '2026-04-04', start: '13:00', end: '14:30' },
  { name: 'Press Interviews', type: 'Interview', guestIdx: [2, 10], venue: 'Press Room', date: '2026-04-03', start: '14:00', end: '15:00' },
]

// staff index references STAFF_DATA array index
const PAIRINGS = [
  { guestIdx: 0, staffIdx: 1, role: 'Main Liaison' },
  { guestIdx: 0, staffIdx: 2, role: 'Interpreter' },
  { guestIdx: 1, staffIdx: 3, role: 'Main Liaison' },
  { guestIdx: 1, staffIdx: 2, role: 'Interpreter' },
  { guestIdx: 2, staffIdx: 10, role: 'Main Liaison' },
  { guestIdx: 2, staffIdx: 18, role: 'Interpreter' },
  { guestIdx: 3, staffIdx: 5, role: 'Main Liaison' },
  { guestIdx: 3, staffIdx: 6, role: 'Interpreter' },
  { guestIdx: 4, staffIdx: 8, role: 'Main Liaison' },
  { guestIdx: 6, staffIdx: 1, role: 'Main Liaison' },
  { guestIdx: 8, staffIdx: 14, role: 'Main Liaison' },
  { guestIdx: 8, staffIdx: 18, role: 'Interpreter' },
  { guestIdx: 9, staffIdx: 5, role: 'Main Liaison' },
  { guestIdx: 10, staffIdx: 10, role: 'Main Liaison' },
  { guestIdx: 11, staffIdx: 5, role: 'Main Liaison' },
]

const PREP_TASKS = [
  'Confirm flight itinerary',
  'Hotel room assignment',
  'Badge and lanyard prepared',
  'Submit dietary requirements',
  'Welcome packet assembled',
]

const TRANSPORT = [
  { guestIdx: 0, type: 'arrival', from: 'Boston Logan Airport (Terminal E)', to: 'Sheraton Boston Hotel', time: '2026-04-02T15:30:00', driver: 'Mike Sullivan', vehicle: 'Black Sedan', flight: 'NH7010' },
  { guestIdx: 1, type: 'arrival', from: 'Boston Logan Airport (Terminal E)', to: 'Sheraton Boston Hotel', time: '2026-04-02T10:15:00', driver: 'Tom Reilly', vehicle: 'Black Sedan', flight: 'JL006' },
  { guestIdx: 2, type: 'arrival', from: 'Boston Logan Airport (Terminal E)', to: 'Sheraton Boston Hotel', time: '2026-04-02T19:00:00', driver: 'Mike Sullivan', vehicle: 'Black SUV', flight: 'NH7012' },
  { guestIdx: 3, type: 'arrival', from: 'Boston Logan Airport (Terminal E)', to: 'Sheraton Boston Hotel', time: '2026-04-02T13:00:00', driver: 'James OBrien', vehicle: 'Black SUV', flight: 'JL008' },
  { guestIdx: 4, type: 'arrival', from: 'Boston Logan Airport (Terminal B)', to: 'Sheraton Boston Hotel', time: '2026-04-02T17:00:00', driver: 'Dave Kowalski', vehicle: 'Minivan', flight: 'AA1422' },
  { guestIdx: 0, type: 'departure', from: 'Sheraton Boston Hotel', to: 'Boston Logan Airport (Terminal E)', time: '2026-04-06T07:00:00', driver: 'Mike Sullivan', vehicle: 'Black Sedan', flight: 'NH7011' },
  { guestIdx: 1, type: 'departure', from: 'Sheraton Boston Hotel', to: 'Boston Logan Airport (Terminal E)', time: '2026-04-06T08:30:00', driver: 'Tom Reilly', vehicle: 'Black Sedan', flight: 'JL007' },
  { guestIdx: 8, type: 'arrival', from: 'Boston Logan Airport (Terminal E)', to: 'Sheraton Boston Hotel', time: '2026-04-02T16:45:00', driver: 'James OBrien', vehicle: 'Black Sedan', flight: 'NH7014' },
]

const FORM_CONFIGS = [
  {
    concept_key: 'guest',
    name: 'Guest Intake Wizard',
    layout: 'wizard',
    fields: [
      { key: 'name', label: 'Guest Name', type: 'text', required: true, step: 1 },
      { key: 'type', label: 'Guest Type', type: 'select', required: true, step: 1, options: ['JP', 'NA', 'Industry'] },
      { key: 'department', label: 'Department', type: 'select', required: true, step: 1, options: ['Anime', 'Gaming', 'Music', 'Cosplay', 'Panels', 'Artists', 'Industry'] },
      { key: 'company', label: 'Company/Affiliation', type: 'text', required: false, step: 1 },
      { key: 'bio', label: 'Bio', type: 'rich_text', required: false, step: 2 },
      { key: 'dietary', label: 'Dietary Requirements', type: 'text', required: false, step: 2 },
      { key: 'pronouns', label: 'Pronouns', type: 'text', required: false, step: 2 },
      { key: 'interpreter_required', label: 'Interpreter Required', type: 'checkbox', required: false, step: 2 },
      { key: 'research_links', label: 'Research Links', type: 'rich_text', required: false, step: 3 },
      { key: 'special_handling', label: 'Special Handling Notes', type: 'rich_text', required: false, step: 3 },
    ],
    steps: [
      { number: 1, title: 'Basic Info', description: 'Guest identity and affiliation' },
      { number: 2, title: 'Details', description: 'Bio, dietary, and accessibility' },
      { number: 3, title: 'Notes', description: 'Research and special handling' },
    ],
  },
  {
    concept_key: 'staff',
    name: 'Staff Entry Form',
    layout: 'single',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'role_key', label: 'Role', type: 'select', required: true, options: ['director', 'department_head', 'coordinator', 'liaison', 'interpreter', 'volunteer'] },
      { key: 'department', label: 'Department', type: 'select', required: true, options: ['Anime', 'Gaming', 'Music', 'Cosplay', 'Panels', 'Artists', 'Industry'] },
      { key: 'phone', label: 'Phone', type: 'text', required: false },
    ],
    steps: [],
  },
  {
    concept_key: 'schedule',
    name: 'Schedule Event Form',
    layout: 'single',
    fields: [
      { key: 'name', label: 'Activity', type: 'text', required: true },
      { key: 'event_type', label: 'Event Type', type: 'select', required: true, options: ['Panel', 'Autograph Session', 'Photo Op', 'Meal', 'Other'] },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'start_time', label: 'Start Time', type: 'text', required: true },
      { key: 'end_time', label: 'End Time', type: 'text', required: true },
      { key: 'venue', label: 'Venue', type: 'select', required: false },
    ],
    steps: [],
  },
]

const VIEW_CONFIGS = [
  {
    concept_key: 'guest',
    name: 'All Guests',
    view_type: 'table',
    columns: [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'type', label: 'Type', sortable: true },
      { key: 'department', label: 'Department', sortable: true },
      { key: 'status', label: 'Status', sortable: true },
      { key: 'staffCount', label: 'Staff', sortable: true },
      { key: 'prepPercent', label: 'Prep %', sortable: true },
      { key: 'company', label: 'Company', sortable: true },
    ],
    filters: [],
    sort: [{ key: 'name', direction: 'asc' }],
  },
  {
    concept_key: 'guest',
    name: 'Guest Pipeline',
    view_type: 'kanban',
    columns: [
      { key: 'draft', label: 'Draft' },
      { key: 'invited', label: 'Invited' },
      { key: 'confirmed', label: 'Confirmed' },
      { key: 'travel_arranged', label: 'Travel Arranged' },
      { key: 'arrived', label: 'Arrived' },
    ],
    filters: [],
    sort: [],
    group_by: 'status',
  },
  {
    concept_key: 'schedule',
    name: 'Schedule Timeline',
    view_type: 'timeline',
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'startTime', label: 'Start' },
      { key: 'endTime', label: 'End' },
      { key: 'activity', label: 'Activity' },
      { key: 'eventType', label: 'Type' },
      { key: 'guestName', label: 'Guest' },
      { key: 'venue', label: 'Venue' },
    ],
    filters: [],
    sort: [{ key: 'date', direction: 'asc' }, { key: 'startTime', direction: 'asc' }],
  },
  {
    concept_key: 'prep_item',
    name: 'Prep Tracker',
    view_type: 'table',
    columns: [
      { key: 'label', label: 'Item' },
      { key: 'guestName', label: 'Guest' },
      { key: 'owner', label: 'Owner' },
      { key: 'dueDate', label: 'Due Date' },
      { key: 'status', label: 'Status' },
    ],
    filters: [],
    sort: [{ key: 'dueDate', direction: 'asc' }],
  },
  {
    concept_key: 'staff',
    name: 'Staff Directory',
    view_type: 'table',
    columns: [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'email', label: 'Email', sortable: true },
      { key: 'role', label: 'Role', sortable: true },
      { key: 'department', label: 'Department', sortable: true },
      { key: 'phone', label: 'Phone' },
    ],
    filters: [],
    sort: [{ key: 'name', direction: 'asc' }],
  },
]

const WORKFLOW_CONFIGS = [
  {
    name: 'Guest Confirmed — Create Prep Items',
    description: 'When a guest status changes to confirmed, automatically generate standard prep checklist items.',
    trigger: { event: 'status_change', concept: 'guest', from: '*', to: 'confirmed' },
    condition: { field: 'status', operator: 'equals', value: 'confirmed' },
    actions: [
      { type: 'create_records', concept: 'prep_item', template: 'standard_prep', count: 5 },
      { type: 'notify', role: 'liaison', message: 'Guest {{name}} confirmed — prep items generated' },
    ],
    enabled: true,
  },
  {
    name: 'JP Guest — Assign Interpreter',
    description: 'When a Japanese guest is added, flag for interpreter assignment.',
    trigger: { event: 'record_created', concept: 'guest' },
    condition: { field: 'type', operator: 'equals', value: 'JP' },
    actions: [
      { type: 'set_field', concept: 'guest', field: 'interpreter_required', value: true },
      { type: 'notify', role: 'coordinator', message: 'New JP guest {{name}} needs interpreter assignment' },
    ],
    enabled: true,
  },
  {
    name: 'Overdue Prep Check — Daily',
    description: 'Daily check for prep items past their due date. Notifies coordinators.',
    trigger: { event: 'cron', schedule: '0 9 * * *' },
    condition: { field: 'due_date', operator: 'less_than', value: '{{today}}' },
    actions: [
      { type: 'update_status', concept: 'prep_item', from: 'incomplete', to: 'overdue' },
      { type: 'notify', role: 'coordinator', message: '{{count}} prep items are overdue' },
    ],
    enabled: true,
  },
]

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

async function seed() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // -----------------------------------------------------------------------
    // 1. Ontology Concepts
    // -----------------------------------------------------------------------
    for (const c of CONCEPTS) {
      await client.query(
        `INSERT INTO ontology_concepts (key, name, plural_name, icon, description, is_registry, is_config, version, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'active')
         ON CONFLICT (key, version) DO UPDATE SET
           name = EXCLUDED.name, plural_name = EXCLUDED.plural_name, icon = EXCLUDED.icon,
           description = EXCLUDED.description, is_registry = EXCLUDED.is_registry, is_config = EXCLUDED.is_config,
           status = EXCLUDED.status`,
        [c.key, c.name, c.plural, c.icon, c.desc, c.is_registry, c.is_config]
      )
    }
    console.log(`Concepts: ${CONCEPTS.length}`)

    // -----------------------------------------------------------------------
    // 2. Ontology Properties
    // -----------------------------------------------------------------------
    // Clear existing to make idempotent, then insert fresh
    await client.query(`DELETE FROM ontology_properties WHERE version = 1`)
    for (const p of PROPERTIES) {
      await client.query(
        `INSERT INTO ontology_properties (concept_key, key, label, type, required, sort_order, options, version, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'active')`,
        [p.concept_key, p.key, p.label, p.type, p.required, p.sort_order, p.options || null]
      )
    }
    console.log(`Properties: ${PROPERTIES.length}`)

    // -----------------------------------------------------------------------
    // 3. Ontology Relationships
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM ontology_relationships WHERE version = 1`)
    for (const r of RELATIONSHIPS) {
      await client.query(
        `INSERT INTO ontology_relationships (source_concept_key, target_concept_key, key, label, cardinality, inverse_key, version, status)
         VALUES ($1, $2, $3, $4, $5, $6, 1, 'active')`,
        [r.source, r.target, r.key, r.label, r.cardinality, r.inverse]
      )
    }
    console.log(`Relationships: ${RELATIONSHIPS.length}`)

    // -----------------------------------------------------------------------
    // 4. Roles
    // -----------------------------------------------------------------------
    for (const r of ROLES) {
      await client.query(
        `INSERT INTO roles (key, name, description, priority, is_operational)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           priority = EXCLUDED.priority, is_operational = EXCLUDED.is_operational`,
        [r.key, r.name, r.description, r.priority, r.is_operational]
      )
    }
    console.log(`Roles: ${ROLES.length}`)

    // -----------------------------------------------------------------------
    // 5. Permissions
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM permissions WHERE role_key IN ('director', 'viewer')`)
    const allPerms = [...PERMISSIONS_DIRECTOR, ...PERMISSIONS_VIEWER]
    for (const p of allPerms) {
      await client.query(
        `INSERT INTO permissions (role_key, concept_key, can_view, can_create, can_edit, can_delete)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [p.role_key, p.concept_key, p.can_view, p.can_create, p.can_edit, p.can_delete]
      )
    }
    console.log(`Permissions: ${allPerms.length}`)

    // -----------------------------------------------------------------------
    // 6. Venues
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM venues`)
    const venueIds = {}
    for (const v of VENUES) {
      const r = await client.query(
        `INSERT INTO venues (name, type, capacity, floor, building, equipment, properties)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [v.name, v.type, v.capacity, v.floor, v.building, JSON.stringify(v.equipment), JSON.stringify({})]
      )
      venueIds[v.name] = r.rows[0].id
    }
    console.log(`Venues: ${VENUES.length}`)

    // -----------------------------------------------------------------------
    // 7. Staff
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM staff`)
    const staffIds = []
    for (const s of STAFF_DATA) {
      const r = await client.query(
        `INSERT INTO staff (name, email, role_key, department, phone, properties, staff_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'staff') RETURNING id`,
        [s.name, s.email, s.role, s.dept, s.phone, JSON.stringify({ availability: 'available' })]
      )
      staffIds.push(r.rows[0].id)
    }
    console.log(`Staff: ${staffIds.length}`)

    // -----------------------------------------------------------------------
    // 8. Guests
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM guests`)
    const guestIds = []
    for (const g of GUEST_DATA) {
      const r = await client.query(
        `INSERT INTO guests (name, type, department, status, company, properties)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          g.name, g.type, g.dept, g.status, g.company,
          JSON.stringify({
            interpreter_required: g.interp,
            bio: g.bio,
            dietary: g.dietary,
            pronouns: g.pronouns,
          }),
        ]
      )
      guestIds.push(r.rows[0].id)
    }
    console.log(`Guests: ${guestIds.length}`)

    // -----------------------------------------------------------------------
    // 9. Schedule Events + Junction Table
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM guest_schedule_events`)
    await client.query(`DELETE FROM schedule_events`)
    const eventIds = []
    for (const ev of EVENTS) {
      const vid = venueIds[ev.venue] || null
      const r = await client.query(
        `INSERT INTO schedule_events (name, event_type, venue_id, start_time, end_time, status, properties)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', $6) RETURNING id`,
        [
          ev.name,
          ev.type,
          vid,
          `${ev.date}T${ev.start}:00`,
          `${ev.date}T${ev.end}:00`,
          JSON.stringify({ date: ev.date, venue_name: ev.venue }),
        ]
      )
      const eventId = r.rows[0].id
      eventIds.push(eventId)

      // Insert junction rows for all guest indices
      for (const gi of ev.guestIdx) {
        await client.query(
          `INSERT INTO guest_schedule_events (guest_id, schedule_event_id) VALUES ($1, $2)`,
          [guestIds[gi], eventId]
        )
      }
    }
    console.log(`Schedule Events: ${eventIds.length}`)

    // Count junction rows
    const junctionCount = await client.query('SELECT count(*) as c FROM guest_schedule_events')
    console.log(`Guest-Schedule Links: ${junctionCount.rows[0].c}`)

    // -----------------------------------------------------------------------
    // 10. Pairings
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM pairings`)
    for (const p of PAIRINGS) {
      await client.query(
        `INSERT INTO pairings (guest_id, staff_id, role, properties)
         VALUES ($1, $2, $3, $4)`,
        [guestIds[p.guestIdx], staffIds[p.staffIdx], p.role, JSON.stringify({ status: 'active' })]
      )
    }
    console.log(`Pairings: ${PAIRINGS.length}`)

    // -----------------------------------------------------------------------
    // 11. Prep Items
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM prep_items`)
    let prepCount = 0
    // Confirmed + arrived guests get prep items (indices 0-4, 6, 8, 10 = confirmed/arrived)
    const prepGuestIndices = [0, 1, 2, 3, 4, 6, 8, 9, 10, 11]
    for (const gi of prepGuestIndices) {
      const g = GUEST_DATA[gi]
      for (let ti = 0; ti < PREP_TASKS.length; ti++) {
        // First 4 guests (JP) are fully complete; confirmed NA guests partially complete
        let status
        if (gi <= 3) {
          status = 'complete'
        } else if (g.status === 'confirmed' || g.status === 'arrived') {
          status = ti < 3 ? 'complete' : ti < 4 ? 'in_progress' : 'incomplete'
        } else {
          status = ti < 2 ? 'in_progress' : 'incomplete'
        }

        // Assign owner based on who the liaison is
        const ownerStaffIdx = Math.min(gi, STAFF_DATA.length - 1)
        const dueDate = gi <= 3 ? '2026-03-20' : '2026-03-28'

        await client.query(
          `INSERT INTO prep_items (name, guest_id, status, due_date, properties)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            PREP_TASKS[ti],
            guestIds[gi],
            status,
            dueDate,
            JSON.stringify({
              guest_name: g.name,
              owner: STAFF_DATA[ownerStaffIdx].name,
            }),
          ]
        )
        prepCount++
      }
    }
    console.log(`Prep Items: ${prepCount}`)

    // -----------------------------------------------------------------------
    // 12. Transport Bookings
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM transport_bookings`)
    for (const t of TRANSPORT) {
      await client.query(
        `INSERT INTO transport_bookings (guest_id, booking_type, status, pickup_location, dropoff_location, scheduled_time, driver_name, vehicle_info, flight_number, properties)
         VALUES ($1, $2, 'confirmed', $3, $4, $5, $6, $7, $8, $9)`,
        [
          guestIds[t.guestIdx],
          t.type,
          t.from,
          t.to,
          t.time,
          t.driver,
          t.vehicle,
          t.flight,
          JSON.stringify({ guest_name: GUEST_DATA[t.guestIdx].name }),
        ]
      )
    }
    console.log(`Transport Bookings: ${TRANSPORT.length}`)

    // -----------------------------------------------------------------------
    // 13. Users
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM users`)
    await client.query(
      `INSERT INTO users (email, name, role_key, department)
       VALUES ($1, $2, $3, $4)`,
      ['demo@animeboston.org', 'Demo Director', 'director', 'Anime']
    )
    console.log('Users: 1')

    // -----------------------------------------------------------------------
    // 14. Form Configs
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM form_configs`)
    for (const fc of FORM_CONFIGS) {
      await client.query(
        `INSERT INTO form_configs (concept_key, name, layout, fields, steps, version, status)
         VALUES ($1, $2, $3, $4, $5, 1, 'active')`,
        [fc.concept_key, fc.name, fc.layout, JSON.stringify(fc.fields), JSON.stringify(fc.steps)]
      )
    }
    console.log(`Form Configs: ${FORM_CONFIGS.length}`)

    // -----------------------------------------------------------------------
    // 15. View Configs
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM view_configs`)
    for (const vc of VIEW_CONFIGS) {
      await client.query(
        `INSERT INTO view_configs (concept_key, name, view_type, columns, filters, sort, group_by, version, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'active')`,
        [
          vc.concept_key, vc.name, vc.view_type,
          JSON.stringify(vc.columns), JSON.stringify(vc.filters),
          JSON.stringify(vc.sort), vc.group_by || null,
        ]
      )
    }
    console.log(`View Configs: ${VIEW_CONFIGS.length}`)

    // -----------------------------------------------------------------------
    // 16. Workflow Configs
    // -----------------------------------------------------------------------
    await client.query(`DELETE FROM workflow_configs`)
    for (const wc of WORKFLOW_CONFIGS) {
      await client.query(
        `INSERT INTO workflow_configs (name, description, trigger, condition, actions, enabled, version, status)
         VALUES ($1, $2, $3, $4, $5, $6, 1, 'active')`,
        [
          wc.name, wc.description,
          JSON.stringify(wc.trigger), JSON.stringify(wc.condition),
          JSON.stringify(wc.actions), wc.enabled,
        ]
      )
    }
    console.log(`Workflow Configs: ${WORKFLOW_CONFIGS.length}`)

    // -----------------------------------------------------------------------
    // COMMIT
    // -----------------------------------------------------------------------
    await client.query('COMMIT')
    console.log('\n=== Seed complete! ===\n')

    // -----------------------------------------------------------------------
    // Verify counts
    // -----------------------------------------------------------------------
    const tables = [
      'ontology_concepts', 'ontology_properties', 'ontology_relationships',
      'roles', 'permissions', 'venues', 'staff', 'guests',
      'schedule_events', 'guest_schedule_events', 'pairings',
      'prep_items', 'transport_bookings', 'users',
      'form_configs', 'view_configs', 'workflow_configs',
    ]
    console.log('Table counts:')
    for (const t of tables) {
      const r = await client.query(`SELECT count(*) as c FROM ${t}`)
      console.log(`  ${t}: ${r.rows[0].c}`)
    }
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('Seed failed:', e.message)
    console.error(e.stack)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

seed()
