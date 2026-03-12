#!/usr/bin/env tsx
/**
 * seed-ontology.ts
 *
 * Seeds the five ontology databases (Concepts, Properties, Relationships,
 * Domain Events, Constraints) with the initial GR-Ops domain definitions.
 *
 * Prerequisites: run create-databases.ts first so manifest.json exists.
 *
 *   npx tsx src/seed-ontology.ts
 */

import {
  type PagePropertyValue,
  readManifest,
  requireDatabaseId,
  createPage,
  batchExecute,
} from "./notion-helpers.js";

// ---------------------------------------------------------------------------
// Types for seed data
// ---------------------------------------------------------------------------

interface ConceptSeed {
  readonly key: string;
  readonly name: string;
  readonly plural_name: string;
  readonly icon: string;
  readonly description: string;
  readonly is_registry?: boolean;
  readonly is_config?: boolean;
}

interface PropertySeed {
  readonly concept_key: string;
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly required: boolean;
  readonly notion_property_name: string;
  readonly sort_order: number;
  readonly description?: string;
  readonly default_value?: string;
  readonly placeholder?: string;
  readonly options?: string; // JSON stringified
  readonly hidden?: boolean;
  readonly read_only?: boolean;
}

interface RelationshipSeed {
  readonly source_concept_key: string;
  readonly target_concept_key: string;
  readonly key: string;
  readonly label: string;
  readonly cardinality: string;
  readonly notion_relation_name: string;
  readonly inverse_key?: string;
  readonly description?: string;
}

interface DomainEventSeed {
  readonly concept_key: string;
  readonly event_key: string;
  readonly full_event_name: string;
  readonly trigger_type: string;
  readonly description: string;
  readonly changed_fields?: string;
  readonly schedule?: string;
}

// ---------------------------------------------------------------------------
// Concept seed data
// ---------------------------------------------------------------------------

const CONCEPTS: readonly ConceptSeed[] = [
  // Domain concepts
  { key: "guest", name: "Guest", plural_name: "Guests", icon: "pi pi-star", description: "Convention guests (JP, NA, Industry)" },
  { key: "staff", name: "Staff", plural_name: "Staff", icon: "pi pi-user", description: "GR team members, interpreters, volunteers" },
  { key: "schedule", name: "Schedule Event", plural_name: "Schedule", icon: "pi pi-calendar", description: "Activities, panels, autographs, meals, and logistics" },
  { key: "travel", name: "Travel", plural_name: "Travel", icon: "pi pi-send", description: "Flight, train, car travel records" },
  { key: "accommodations", name: "Accommodations", plural_name: "Accommodations", icon: "pi pi-building", description: "Hotel and room bookings" },
  { key: "dietary", name: "Dietary", plural_name: "Dietary", icon: "pi pi-apple", description: "Dietary restrictions, allergies, and preferences" },
  { key: "prep_tracker", name: "Prep Item", plural_name: "Prep Tracker", icon: "pi pi-check-square", description: "Pre-convention preparation checklist items" },
  { key: "autographs", name: "Autograph Session", plural_name: "Autographs", icon: "pi pi-pencil", description: "Autograph session configuration and details" },
  { key: "pairings", name: "Pairing", plural_name: "Pairings", icon: "pi pi-users", description: "Staff-to-guest assignment pairings" },
  { key: "venues", name: "Venue", plural_name: "Venues", icon: "pi pi-map-marker", description: "Convention venue locations and rooms" },
  // Registries
  { key: "guest_registry", name: "Guest Registry", plural_name: "Guest Registry", icon: "pi pi-book", description: "Year-over-year guest history and preferences", is_registry: true },
  { key: "staff_registry", name: "Staff Registry", plural_name: "Staff Registry", icon: "pi pi-id-card", description: "Year-over-year staff experience and training", is_registry: true },
  { key: "company_registry", name: "Company Registry", plural_name: "Company Registry", icon: "pi pi-briefcase", description: "Year-over-year company and contact records", is_registry: true },
];

// ---------------------------------------------------------------------------
// Property seed data (matching create-databases.ts domain schemas)
// ---------------------------------------------------------------------------

function makeProps(
  conceptKey: string,
  fields: readonly Omit<PropertySeed, "concept_key">[]
): readonly PropertySeed[] {
  return fields.map((f) => ({ ...f, concept_key: conceptKey }));
}

const PROPERTIES: readonly PropertySeed[] = [
  // -- guest --
  ...makeProps("guest", [
    { key: "name", label: "Name", type: "text", required: true, notion_property_name: "name", sort_order: 1, description: "Guest's full name" },
    { key: "type", label: "Type", type: "select", required: true, notion_property_name: "type", sort_order: 2, description: "Guest category", options: JSON.stringify(["JP", "NA", "Industry"]) },
    { key: "department", label: "Department", type: "select", required: false, notion_property_name: "department", sort_order: 3, description: "Assigned department" },
    { key: "status", label: "Status", type: "select", required: true, notion_property_name: "status", sort_order: 4, description: "Current invitation status", default_value: "Pending", options: JSON.stringify(["Confirmed", "Invited", "Pending", "Cancelled"]) },
    { key: "company", label: "Company", type: "text", required: false, notion_property_name: "company", sort_order: 5, description: "Company or agency" },
    { key: "interpreter_required", label: "Interpreter Required", type: "checkbox", required: false, notion_property_name: "interpreter_required", sort_order: 6, description: "Whether an interpreter is needed" },
    { key: "special_handling", label: "Special Handling", type: "rich_text", required: false, notion_property_name: "special_handling", sort_order: 7, description: "Special requirements or notes" },
    { key: "research_links", label: "Research Links", type: "url", required: false, notion_property_name: "research_links", sort_order: 8, description: "Links for research (MAL, Wikipedia, etc.)" },
    { key: "notes", label: "Notes", type: "rich_text", required: false, notion_property_name: "notes", sort_order: 9, description: "General notes" },
  ]),

  // -- staff --
  ...makeProps("staff", [
    { key: "name", label: "Name", type: "text", required: true, notion_property_name: "name", sort_order: 1, description: "Staff member's full name" },
    { key: "email", label: "Email", type: "email", required: true, notion_property_name: "email", sort_order: 2, description: "Contact email" },
    { key: "role", label: "Role", type: "select", required: true, notion_property_name: "role", sort_order: 3, description: "Staff role", options: JSON.stringify(["Director", "Liaison", "Department Head", "Interpreter", "Volunteer"]) },
    { key: "department", label: "Department", type: "select", required: false, notion_property_name: "department", sort_order: 4, description: "Department assignment" },
    { key: "phone", label: "Phone", type: "phone", required: false, notion_property_name: "phone", sort_order: 5, description: "Phone number" },
    { key: "line_id", label: "LINE ID", type: "text", required: false, notion_property_name: "line_id", sort_order: 6, description: "LINE messaging app ID" },
    { key: "languages", label: "Languages", type: "multi_select", required: false, notion_property_name: "languages", sort_order: 7, description: "Languages spoken", options: JSON.stringify(["English", "Japanese", "Korean", "Mandarin", "Spanish", "French"]) },
    { key: "availability", label: "Availability", type: "rich_text", required: false, notion_property_name: "availability", sort_order: 8, description: "Availability notes for the convention" },
  ]),

  // -- schedule --
  ...makeProps("schedule", [
    { key: "activity", label: "Activity", type: "text", required: true, notion_property_name: "activity", sort_order: 1, description: "Event or activity name" },
    { key: "event_type", label: "Event Type", type: "select", required: true, notion_property_name: "event_type", sort_order: 2, description: "Type of schedule event", options: JSON.stringify(["Panel", "Autograph", "Concert", "Staff", "Logistics", "Meal", "Ceremony", "Transport", "Meeting", "Free Time", "Greeting", "Photo Op", "Appearance"]) },
    { key: "date", label: "Date", type: "date", required: true, notion_property_name: "date", sort_order: 3, description: "Event date" },
    { key: "start_time", label: "Start Time", type: "text", required: false, notion_property_name: "start_time", sort_order: 4, description: "Start time (HH:MM)", placeholder: "10:00" },
    { key: "end_time", label: "End Time", type: "text", required: false, notion_property_name: "end_time", sort_order: 5, description: "End time (HH:MM)", placeholder: "11:00" },
    { key: "venue", label: "Venue", type: "text", required: false, notion_property_name: "venue", sort_order: 6, description: "Venue or room name" },
    { key: "description", label: "Description", type: "rich_text", required: false, notion_property_name: "description", sort_order: 7, description: "Event description and details" },
    { key: "status", label: "Status", type: "select", required: true, notion_property_name: "status", sort_order: 8, description: "Scheduling status", default_value: "Scheduled", options: JSON.stringify(["Scheduled", "Confirmed", "Cancelled", "Tentative"]) },
    { key: "calendar_event_id", label: "Calendar Event ID", type: "text", required: false, notion_property_name: "calendar_event_id", sort_order: 9, description: "Google Calendar event ID", hidden: true },
  ]),

  // -- travel --
  ...makeProps("travel", [
    { key: "description", label: "Description", type: "text", required: true, notion_property_name: "description", sort_order: 1, description: "Travel description (e.g. NRT -> BOS)" },
    { key: "travel_type", label: "Travel Type", type: "select", required: true, notion_property_name: "travel_type", sort_order: 2, description: "Mode of travel", options: JSON.stringify(["Flight", "Train", "Bus", "Car", "Other"]) },
    { key: "carrier", label: "Carrier", type: "text", required: false, notion_property_name: "carrier", sort_order: 3, description: "Airline or carrier name" },
    { key: "route", label: "Route", type: "text", required: false, notion_property_name: "route", sort_order: 4, description: "Route details (e.g. NRT -> JFK -> BOS)" },
    { key: "departure_date", label: "Departure Date", type: "date", required: false, notion_property_name: "departure_date", sort_order: 5, description: "Departure date" },
    { key: "arrival_date", label: "Arrival Date", type: "date", required: false, notion_property_name: "arrival_date", sort_order: 6, description: "Arrival date" },
    { key: "departure_time", label: "Departure Time", type: "text", required: false, notion_property_name: "departure_time", sort_order: 7, description: "Departure time" },
    { key: "arrival_time", label: "Arrival Time", type: "text", required: false, notion_property_name: "arrival_time", sort_order: 8, description: "Arrival time" },
    { key: "confirmation_number", label: "Confirmation #", type: "text", required: false, notion_property_name: "confirmation_number", sort_order: 9, description: "Booking confirmation number" },
    { key: "status", label: "Status", type: "select", required: true, notion_property_name: "status", sort_order: 10, description: "Travel status", default_value: "Pending", options: JSON.stringify(["Confirmed", "Pending", "Cancelled", "Changed"]) },
    { key: "notes", label: "Notes", type: "rich_text", required: false, notion_property_name: "notes", sort_order: 11, description: "Additional travel notes" },
  ]),

  // -- accommodations --
  ...makeProps("accommodations", [
    { key: "hotel", label: "Hotel", type: "text", required: true, notion_property_name: "hotel", sort_order: 1, description: "Hotel name" },
    { key: "room_type", label: "Room Type", type: "select", required: false, notion_property_name: "room_type", sort_order: 2, description: "Room type", options: JSON.stringify(["Single", "Double", "Suite", "Other"]) },
    { key: "check_in", label: "Check-in", type: "date", required: false, notion_property_name: "check_in", sort_order: 3, description: "Check-in date" },
    { key: "check_out", label: "Check-out", type: "date", required: false, notion_property_name: "check_out", sort_order: 4, description: "Check-out date" },
    { key: "confirmation_number", label: "Confirmation #", type: "text", required: false, notion_property_name: "confirmation_number", sort_order: 5, description: "Booking confirmation number" },
    { key: "special_requests", label: "Special Requests", type: "rich_text", required: false, notion_property_name: "special_requests", sort_order: 6, description: "Special accommodation requests" },
    { key: "status", label: "Status", type: "select", required: true, notion_property_name: "status", sort_order: 7, description: "Booking status", default_value: "Pending", options: JSON.stringify(["Confirmed", "Pending", "Cancelled"]) },
  ]),

  // -- dietary --
  ...makeProps("dietary", [
    { key: "dietary_type", label: "Dietary Type", type: "text", required: true, notion_property_name: "dietary_type", sort_order: 1, description: "Primary dietary category" },
    { key: "restrictions", label: "Restrictions", type: "multi_select", required: false, notion_property_name: "restrictions", sort_order: 2, description: "Dietary restrictions", options: JSON.stringify(["Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-Free", "Dairy-Free", "Nut-Free"]) },
    { key: "allergies", label: "Allergies", type: "multi_select", required: false, notion_property_name: "allergies", sort_order: 3, description: "Food allergies", options: JSON.stringify(["Peanuts", "Tree Nuts", "Shellfish", "Fish", "Eggs", "Dairy", "Soy", "Wheat", "Sesame"]) },
    { key: "preferences", label: "Preferences", type: "rich_text", required: false, notion_property_name: "preferences", sort_order: 4, description: "Food preferences and favorites" },
    { key: "notes", label: "Notes", type: "rich_text", required: false, notion_property_name: "notes", sort_order: 5, description: "Additional dietary notes" },
  ]),

  // -- prep_tracker --
  ...makeProps("prep_tracker", [
    { key: "item", label: "Item", type: "text", required: true, notion_property_name: "item", sort_order: 1, description: "Prep task name" },
    { key: "owner_role", label: "Owner Role", type: "select", required: true, notion_property_name: "owner_role", sort_order: 2, description: "Role responsible for this item", options: JSON.stringify(["Director", "Liaison", "Department Head", "Interpreter"]) },
    { key: "due_date", label: "Due Date", type: "date", required: false, notion_property_name: "due_date", sort_order: 3, description: "Target completion date" },
    { key: "status", label: "Status", type: "select", required: true, notion_property_name: "status", sort_order: 4, description: "Completion status", default_value: "Not Started", options: JSON.stringify(["Not Started", "In Progress", "Complete", "Blocked", "Overdue"]) },
    { key: "completed_at", label: "Completed At", type: "date", required: false, notion_property_name: "completed_at", sort_order: 5, description: "Actual completion date", hidden: true },
    { key: "notes", label: "Notes", type: "rich_text", required: false, notion_property_name: "notes", sort_order: 6, description: "Additional notes" },
  ]),

  // -- autographs --
  ...makeProps("autographs", [
    { key: "session_name", label: "Session Name", type: "text", required: true, notion_property_name: "session_name", sort_order: 1, description: "Autograph session name" },
    { key: "pricing", label: "Pricing", type: "text", required: false, notion_property_name: "pricing", sort_order: 2, description: "Ticket pricing info" },
    { key: "table_location", label: "Table Location", type: "text", required: false, notion_property_name: "table_location", sort_order: 3, description: "Table assignment in autograph area" },
    { key: "session_count", label: "Session Count", type: "number", required: false, notion_property_name: "session_count", sort_order: 4, description: "Number of sessions" },
    { key: "time_slot", label: "Time Slot", type: "text", required: false, notion_property_name: "time_slot", sort_order: 5, description: "Time slot (e.g. Fri 2-4pm)" },
    { key: "notes", label: "Notes", type: "rich_text", required: false, notion_property_name: "notes", sort_order: 6, description: "Additional session notes" },
  ]),

  // -- pairings --
  ...makeProps("pairings", [
    { key: "pairing_name", label: "Pairing Name", type: "text", required: true, notion_property_name: "pairing_name", sort_order: 1, description: "Descriptive pairing name (e.g. Guest Name - Liaison)" },
    { key: "role", label: "Role", type: "select", required: true, notion_property_name: "role", sort_order: 2, description: "Staff role in this pairing", options: JSON.stringify(["Primary Liaison", "Backup Liaison", "Primary Interpreter", "Backup Interpreter", "Security Escort"]) },
    { key: "designation", label: "Designation", type: "select", required: true, notion_property_name: "designation", sort_order: 3, description: "Primary or backup", options: JSON.stringify(["primary", "backup"]) },
    { key: "status", label: "Status", type: "select", required: true, notion_property_name: "status", sort_order: 4, description: "Pairing status", default_value: "Unfilled", options: JSON.stringify(["Active", "Inactive", "Unfilled"]) },
  ]),

  // -- venues --
  ...makeProps("venues", [
    { key: "name", label: "Name", type: "text", required: true, notion_property_name: "name", sort_order: 1, description: "Venue name" },
    { key: "venue_type", label: "Venue Type", type: "select", required: true, notion_property_name: "venue_type", sort_order: 2, description: "Type of venue", options: JSON.stringify(["Main Hall", "Panel Room", "Autograph Area", "Meeting Room", "Green Room", "Stage", "Other"]) },
    { key: "capacity", label: "Capacity", type: "number", required: false, notion_property_name: "capacity", sort_order: 3, description: "Seating capacity" },
    { key: "av_equipment", label: "AV Equipment", type: "multi_select", required: false, notion_property_name: "av_equipment", sort_order: 4, description: "Available AV equipment", options: JSON.stringify(["Projector", "Microphone", "Speakers", "Mixer", "Screen", "Webcam", "Streaming"]) },
    { key: "location_group", label: "Location Group", type: "text", required: false, notion_property_name: "location_group", sort_order: 5, description: "Grouped location (e.g. Hynes Level 2)" },
  ]),

  // -- guest_registry --
  ...makeProps("guest_registry", [
    { key: "name", label: "Name", type: "text", required: true, notion_property_name: "name", sort_order: 1, description: "Guest's canonical name" },
    { key: "dietary", label: "Dietary", type: "rich_text", required: false, notion_property_name: "dietary", sort_order: 2, description: "Known dietary needs" },
    { key: "interpreter_pref", label: "Interpreter Pref", type: "text", required: false, notion_property_name: "interpreter_pref", sort_order: 3, description: "Preferred interpreter or language" },
    { key: "special_handling", label: "Special Handling", type: "rich_text", required: false, notion_property_name: "special_handling", sort_order: 4, description: "Persistent special handling notes" },
    { key: "attendance_history", label: "Attendance History", type: "rich_text", required: false, notion_property_name: "attendance_history", sort_order: 5, description: "Years attended (JSON array)" },
    { key: "notes", label: "Notes", type: "rich_text", required: false, notion_property_name: "notes", sort_order: 6, description: "Persistent notes across years" },
  ]),

  // -- staff_registry --
  ...makeProps("staff_registry", [
    { key: "name", label: "Name", type: "text", required: true, notion_property_name: "name", sort_order: 1, description: "Staff member's canonical name" },
    { key: "email", label: "Email", type: "email", required: true, notion_property_name: "email", sort_order: 2, description: "Primary email" },
    { key: "languages", label: "Languages", type: "multi_select", required: false, notion_property_name: "languages", sort_order: 3, description: "Languages spoken", options: JSON.stringify(["English", "Japanese", "Korean", "Mandarin", "Spanish", "French"]) },
    { key: "roles_history", label: "Roles History", type: "rich_text", required: false, notion_property_name: "roles_history", sort_order: 4, description: "Past roles by year (JSON)" },
    { key: "experience", label: "Experience", type: "rich_text", required: false, notion_property_name: "experience", sort_order: 5, description: "Experience notes" },
    { key: "training", label: "Training", type: "rich_text", required: false, notion_property_name: "training", sort_order: 6, description: "Training and certifications" },
  ]),

  // -- company_registry --
  ...makeProps("company_registry", [
    { key: "company_name", label: "Company Name", type: "text", required: true, notion_property_name: "company_name", sort_order: 1, description: "Company or agency name" },
    { key: "contact_name", label: "Contact Name", type: "text", required: false, notion_property_name: "contact_name", sort_order: 2, description: "Primary contact name" },
    { key: "contact_email", label: "Contact Email", type: "email", required: false, notion_property_name: "contact_email", sort_order: 3, description: "Contact email" },
    { key: "contact_phone", label: "Contact Phone", type: "phone", required: false, notion_property_name: "contact_phone", sort_order: 4, description: "Contact phone" },
    { key: "contract_history", label: "Contract History", type: "rich_text", required: false, notion_property_name: "contract_history", sort_order: 5, description: "Past contract details (JSON)" },
    { key: "notes", label: "Notes", type: "rich_text", required: false, notion_property_name: "notes", sort_order: 6, description: "General notes" },
  ]),
];

// ---------------------------------------------------------------------------
// Relationship seed data
// ---------------------------------------------------------------------------

const RELATIONSHIPS: readonly RelationshipSeed[] = [
  { source_concept_key: "guest", target_concept_key: "schedule", key: "guest_schedule", label: "Schedule Events", cardinality: "has-many", notion_relation_name: "Schedule", inverse_key: "schedule_guest", description: "Schedule events for this guest" },
  { source_concept_key: "guest", target_concept_key: "travel", key: "guest_travel", label: "Travel Records", cardinality: "has-many", notion_relation_name: "Travel", inverse_key: "travel_guest", description: "Travel bookings for this guest" },
  { source_concept_key: "guest", target_concept_key: "accommodations", key: "guest_accommodations", label: "Accommodations", cardinality: "has-many", notion_relation_name: "Accommodations", inverse_key: "accommodations_guest", description: "Hotel bookings for this guest" },
  { source_concept_key: "guest", target_concept_key: "dietary", key: "guest_dietary", label: "Dietary Info", cardinality: "has-one", notion_relation_name: "Dietary", inverse_key: "dietary_guest", description: "Dietary restrictions and preferences" },
  { source_concept_key: "guest", target_concept_key: "autographs", key: "guest_autographs", label: "Autograph Sessions", cardinality: "has-one", notion_relation_name: "Autographs", inverse_key: "autographs_guest", description: "Autograph session details" },
  { source_concept_key: "guest", target_concept_key: "prep_tracker", key: "guest_prep", label: "Prep Items", cardinality: "has-many", notion_relation_name: "Prep Items", inverse_key: "prep_guest", description: "Preparation checklist items for this guest" },
  { source_concept_key: "guest", target_concept_key: "pairings", key: "guest_pairings", label: "Staff Pairings", cardinality: "has-many", notion_relation_name: "Pairings", inverse_key: "pairings_guest", description: "Staff assigned to this guest" },
  { source_concept_key: "staff", target_concept_key: "pairings", key: "staff_pairings", label: "Guest Pairings", cardinality: "has-many", notion_relation_name: "Pairings", inverse_key: "pairings_staff", description: "Guest assignments for this staff member" },
  { source_concept_key: "schedule", target_concept_key: "venues", key: "schedule_venue", label: "Venue", cardinality: "has-one", notion_relation_name: "Venue", inverse_key: "venue_events", description: "Venue for this schedule event" },
];

// ---------------------------------------------------------------------------
// Domain Event seed data
// ---------------------------------------------------------------------------

function crudEvents(conceptKey: string, conceptLabel: string): readonly DomainEventSeed[] {
  return [
    { concept_key: conceptKey, event_key: "created", full_event_name: `${conceptKey}.created`, trigger_type: "on_create", description: `Fired when a new ${conceptLabel} record is created` },
    { concept_key: conceptKey, event_key: "updated", full_event_name: `${conceptKey}.updated`, trigger_type: "on_update", description: `Fired when a ${conceptLabel} record is updated` },
    { concept_key: conceptKey, event_key: "deleted", full_event_name: `${conceptKey}.deleted`, trigger_type: "on_delete", description: `Fired when a ${conceptLabel} record is deleted` },
  ];
}

const DOMAIN_EVENTS: readonly DomainEventSeed[] = [
  // CRUD events for every domain concept
  ...crudEvents("guest", "guest"),
  ...crudEvents("staff", "staff"),
  ...crudEvents("schedule", "schedule event"),
  ...crudEvents("travel", "travel"),
  ...crudEvents("accommodations", "accommodations"),
  ...crudEvents("dietary", "dietary"),
  ...crudEvents("prep_tracker", "prep item"),
  ...crudEvents("autographs", "autograph session"),
  ...crudEvents("pairings", "pairing"),
  ...crudEvents("venues", "venue"),

  // Special domain events
  { concept_key: "prep_tracker", event_key: "completed", full_event_name: "prep.completed", trigger_type: "on_field_change", description: "Fired when a prep item status changes to Complete", changed_fields: "status" },
  { concept_key: "prep_tracker", event_key: "overdue", full_event_name: "prep.overdue", trigger_type: "scheduled", description: "Fired daily to check for overdue prep items", schedule: "0 9 * * *" },
  { concept_key: "guest", event_key: "staffing_complete", full_event_name: "guest.staffing_complete", trigger_type: "on_field_change", description: "Fired when all required pairing slots for a guest are filled", changed_fields: "pairings" },
  { concept_key: "schedule", event_key: "conflict_detected", full_event_name: "schedule.conflict_detected", trigger_type: "on_update", description: "Fired when a schedule change creates a time conflict" },
];

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

function conceptToFields(c: ConceptSeed): Record<string, PagePropertyValue> {
  return {
    key: { type: "title", value: c.key },
    name: { type: "rich_text", value: c.name },
    plural_name: { type: "rich_text", value: c.plural_name },
    icon: { type: "rich_text", value: c.icon },
    description: { type: "rich_text", value: c.description },
    is_registry: { type: "checkbox", value: c.is_registry ?? false },
    is_config: { type: "checkbox", value: c.is_config ?? false },
  };
}

function propertyToFields(p: PropertySeed): Record<string, PagePropertyValue> {
  const fields: Record<string, PagePropertyValue> = {
    key: { type: "title", value: p.key },
    concept_key: { type: "rich_text", value: p.concept_key },
    label: { type: "rich_text", value: p.label },
    type: { type: "select", value: p.type },
    required: { type: "checkbox", value: p.required },
    notion_property_name: { type: "rich_text", value: p.notion_property_name },
    sort_order: { type: "number", value: p.sort_order },
    hidden: { type: "checkbox", value: p.hidden ?? false },
    read_only: { type: "checkbox", value: p.read_only ?? false },
  };

  if (p.description) {
    fields.description = { type: "rich_text", value: p.description };
  }
  if (p.default_value) {
    fields.default_value = { type: "rich_text", value: p.default_value };
  }
  if (p.placeholder) {
    fields.placeholder = { type: "rich_text", value: p.placeholder };
  }
  if (p.options) {
    fields.options = { type: "rich_text", value: p.options };
  }

  return fields;
}

function relationshipToFields(r: RelationshipSeed): Record<string, PagePropertyValue> {
  const fields: Record<string, PagePropertyValue> = {
    key: { type: "title", value: r.key },
    source_concept_key: { type: "rich_text", value: r.source_concept_key },
    target_concept_key: { type: "rich_text", value: r.target_concept_key },
    label: { type: "rich_text", value: r.label },
    cardinality: { type: "select", value: r.cardinality },
    notion_relation_name: { type: "rich_text", value: r.notion_relation_name },
  };

  if (r.inverse_key) {
    fields.inverse_key = { type: "rich_text", value: r.inverse_key };
  }
  if (r.description) {
    fields.description = { type: "rich_text", value: r.description };
  }

  return fields;
}

function domainEventToFields(e: DomainEventSeed): Record<string, PagePropertyValue> {
  const fields: Record<string, PagePropertyValue> = {
    event_key: { type: "title", value: e.event_key },
    concept_key: { type: "rich_text", value: e.concept_key },
    full_event_name: { type: "rich_text", value: e.full_event_name },
    trigger_type: { type: "select", value: e.trigger_type },
    description: { type: "rich_text", value: e.description },
  };

  if (e.changed_fields) {
    fields.changed_fields = { type: "rich_text", value: e.changed_fields };
  }
  if (e.schedule) {
    fields.schedule = { type: "rich_text", value: e.schedule };
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== GR-Ops: Seed Ontology ===\n");

  const manifest = readManifest();

  const conceptsDbId = requireDatabaseId(manifest, "concepts");
  const propertiesDbId = requireDatabaseId(manifest, "properties");
  const relationshipsDbId = requireDatabaseId(manifest, "relationships");
  const domainEventsDbId = requireDatabaseId(manifest, "domain_events");

  // Seed Concepts
  console.log(`Seeding ${CONCEPTS.length} concepts...`);
  await batchExecute(CONCEPTS, async (c, i) => {
    try {
      const pageId = await createPage(conceptsDbId, conceptToFields(c));
      console.log(`  [${i + 1}/${CONCEPTS.length}] Concept "${c.key}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${CONCEPTS.length}] ERROR seeding concept "${c.key}": ${msg}`);
    }
  });

  // Seed Properties
  console.log(`\nSeeding ${PROPERTIES.length} properties...`);
  await batchExecute(PROPERTIES, async (p, i) => {
    try {
      const pageId = await createPage(propertiesDbId, propertyToFields(p));
      console.log(`  [${i + 1}/${PROPERTIES.length}] Property "${p.concept_key}.${p.key}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${PROPERTIES.length}] ERROR seeding property "${p.concept_key}.${p.key}": ${msg}`);
    }
  });

  // Seed Relationships
  console.log(`\nSeeding ${RELATIONSHIPS.length} relationships...`);
  await batchExecute(RELATIONSHIPS, async (r, i) => {
    try {
      const pageId = await createPage(relationshipsDbId, relationshipToFields(r));
      console.log(`  [${i + 1}/${RELATIONSHIPS.length}] Relationship "${r.key}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${RELATIONSHIPS.length}] ERROR seeding relationship "${r.key}": ${msg}`);
    }
  });

  // Seed Domain Events
  console.log(`\nSeeding ${DOMAIN_EVENTS.length} domain events...`);
  await batchExecute(DOMAIN_EVENTS, async (e, i) => {
    try {
      const pageId = await createPage(domainEventsDbId, domainEventToFields(e));
      console.log(`  [${i + 1}/${DOMAIN_EVENTS.length}] Event "${e.full_event_name}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${DOMAIN_EVENTS.length}] ERROR seeding event "${e.full_event_name}": ${msg}`);
    }
  });

  console.log("\n=== Ontology seeding complete ===");
  console.log(`  Concepts:    ${CONCEPTS.length}`);
  console.log(`  Properties:  ${PROPERTIES.length}`);
  console.log(`  Relationships: ${RELATIONSHIPS.length}`);
  console.log(`  Domain Events: ${DOMAIN_EVENTS.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
