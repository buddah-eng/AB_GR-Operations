#!/usr/bin/env tsx
/**
 * create-databases.ts
 *
 * Creates ALL Notion databases needed by the GR-Ops platform.
 * Run once to set up a new workspace:
 *
 *   npx tsx src/create-databases.ts
 *
 * Outputs database IDs and saves them to manifest.json.
 */

import {
  type DatabaseSpec,
  type NotionPropertyDef,
  type SelectOptionDef,
  batchExecute,
  createDatabase,
  mapPropertyType,
  writeManifest,
  getParentPageId,
} from "./notion-helpers.js";

// ---------------------------------------------------------------------------
// Shorthand builders
// ---------------------------------------------------------------------------

function title(name: string): NotionPropertyDef {
  return mapPropertyType(name, "title");
}

function text(name: string): NotionPropertyDef {
  return mapPropertyType(name, "text");
}

function richText(name: string): NotionPropertyDef {
  return mapPropertyType(name, "rich_text");
}

function num(name: string): NotionPropertyDef {
  return mapPropertyType(name, "number");
}

function checkbox(name: string): NotionPropertyDef {
  return mapPropertyType(name, "checkbox");
}

function url(name: string): NotionPropertyDef {
  return mapPropertyType(name, "url");
}

function email(name: string): NotionPropertyDef {
  return mapPropertyType(name, "email");
}

function phone(name: string): NotionPropertyDef {
  return mapPropertyType(name, "phone_number");
}

function date(name: string): NotionPropertyDef {
  return mapPropertyType(name, "date");
}

function select(
  name: string,
  options: readonly string[]
): NotionPropertyDef {
  const selectOptions: SelectOptionDef[] = options.map((o) => ({ name: o }));
  return mapPropertyType(name, "select", { selectOptions });
}

function multiSelect(
  name: string,
  options: readonly string[]
): NotionPropertyDef {
  const multiSelectOptions: SelectOptionDef[] = options.map((o) => ({
    name: o,
  }));
  return mapPropertyType(name, "multi_select", { multiSelectOptions });
}

// ---------------------------------------------------------------------------
// Database specifications
// ---------------------------------------------------------------------------

const PROPERTY_TYPES = [
  "text",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "date",
  "datetime",
  "checkbox",
  "url",
  "email",
  "phone",
  "relation",
  "formula",
  "status",
] as const;

const TRIGGER_TYPES = [
  "on_create",
  "on_update",
  "on_delete",
  "on_field_change",
  "scheduled",
  "manual",
] as const;

const CARDINALITY_TYPES = ["has-one", "has-many", "many-to-many"] as const;

const DEPARTMENTS = [
  "Guest Relations",
  "Programming",
  "Events",
  "Operations",
  "Registration",
  "Press",
  "Artists Alley",
  "Exhibits",
  "Video",
  "Karaoke",
] as const;

// -- Ontology databases (5) --

const concepts: DatabaseSpec = {
  slug: "concepts",
  title: "GR-Ops: Concepts",
  icon: "\u{1F9E9}",
  properties: [
    title("key"),
    text("name"),
    text("plural_name"),
    text("extends"),
    text("notion_database_id"),
    text("icon"),
    text("description"),
    checkbox("is_registry"),
    checkbox("is_config"),
  ],
};

const properties: DatabaseSpec = {
  slug: "properties",
  title: "GR-Ops: Properties",
  icon: "\u{1F50D}",
  properties: [
    title("key"),
    text("concept_key"),
    text("label"),
    select("type", [...PROPERTY_TYPES]),
    checkbox("required"),
    text("default_value"),
    text("placeholder"),
    text("description"),
    text("notion_property_name"),
    richText("options"),
    num("min_length"),
    num("max_length"),
    num("min"),
    num("max"),
    text("pattern"),
    num("sort_order"),
    checkbox("hidden"),
    checkbox("read_only"),
  ],
};

const relationships: DatabaseSpec = {
  slug: "relationships",
  title: "GR-Ops: Relationships",
  icon: "\u{1F517}",
  properties: [
    title("key"),
    text("source_concept_key"),
    text("target_concept_key"),
    text("label"),
    select("cardinality", [...CARDINALITY_TYPES]),
    text("notion_relation_name"),
    text("inverse_key"),
    text("description"),
  ],
};

const domainEvents: DatabaseSpec = {
  slug: "domain_events",
  title: "GR-Ops: Domain Events",
  icon: "\u26A1",
  properties: [
    title("event_key"),
    text("concept_key"),
    text("full_event_name"),
    select("trigger_type", [...TRIGGER_TYPES]),
    text("description"),
    text("changed_fields"),
    text("schedule"),
  ],
};

const constraints: DatabaseSpec = {
  slug: "constraints",
  title: "GR-Ops: Constraints",
  icon: "\u{1F512}",
  properties: [
    title("name"),
    text("concept_key"),
    text("extends"),
    richText("condition"),
    richText("defaults"),
    text("required_fields"),
    text("description"),
  ],
};

// -- Domain databases (13) --

const guests: DatabaseSpec = {
  slug: "guests",
  title: "Guests",
  icon: "\u{1F31F}",
  properties: [
    title("name"),
    select("type", ["JP", "NA", "Industry"]),
    select("department", [...DEPARTMENTS]),
    select("status", ["Confirmed", "Invited", "Pending", "Cancelled"]),
    text("company"),
    checkbox("interpreter_required"),
    richText("special_handling"),
    url("research_links"),
    richText("notes"),
  ],
};

const staff: DatabaseSpec = {
  slug: "staff",
  title: "Staff",
  icon: "\u{1F464}",
  properties: [
    title("name"),
    email("email"),
    select("role", [
      "Director",
      "Liaison",
      "Department Head",
      "Interpreter",
      "Volunteer",
    ]),
    select("department", [...DEPARTMENTS]),
    phone("phone"),
    text("line_id"),
    multiSelect("languages", [
      "English",
      "Japanese",
      "Korean",
      "Mandarin",
      "Spanish",
      "French",
    ]),
    richText("availability"),
  ],
};

const schedule: DatabaseSpec = {
  slug: "schedule",
  title: "Schedule",
  icon: "\u{1F4C5}",
  properties: [
    title("activity"),
    select("event_type", [
      "Panel",
      "Autograph",
      "Concert",
      "Staff",
      "Logistics",
      "Meal",
      "Ceremony",
      "Transport",
      "Meeting",
      "Free Time",
      "Greeting",
      "Photo Op",
      "Appearance",
    ]),
    date("date"),
    text("start_time"),
    text("end_time"),
    text("venue"),
    richText("description"),
    select("status", ["Scheduled", "Confirmed", "Cancelled", "Tentative"]),
    text("calendar_event_id"),
  ],
};

const travel: DatabaseSpec = {
  slug: "travel",
  title: "Travel",
  icon: "\u2708\uFE0F",
  properties: [
    title("description"),
    select("travel_type", ["Flight", "Train", "Bus", "Car", "Other"]),
    text("carrier"),
    text("route"),
    date("departure_date"),
    date("arrival_date"),
    text("departure_time"),
    text("arrival_time"),
    text("confirmation_number"),
    select("status", ["Confirmed", "Pending", "Cancelled", "Changed"]),
    richText("notes"),
  ],
};

const accommodations: DatabaseSpec = {
  slug: "accommodations",
  title: "Accommodations",
  icon: "\u{1F3E8}",
  properties: [
    title("hotel"),
    select("room_type", ["Single", "Double", "Suite", "Other"]),
    date("check_in"),
    date("check_out"),
    text("confirmation_number"),
    richText("special_requests"),
    select("status", ["Confirmed", "Pending", "Cancelled"]),
  ],
};

const dietary: DatabaseSpec = {
  slug: "dietary",
  title: "Dietary",
  icon: "\u{1F37D}\uFE0F",
  properties: [
    title("dietary_type"),
    multiSelect("restrictions", [
      "Vegetarian",
      "Vegan",
      "Halal",
      "Kosher",
      "Gluten-Free",
      "Dairy-Free",
      "Nut-Free",
    ]),
    multiSelect("allergies", [
      "Peanuts",
      "Tree Nuts",
      "Shellfish",
      "Fish",
      "Eggs",
      "Dairy",
      "Soy",
      "Wheat",
      "Sesame",
    ]),
    richText("preferences"),
    richText("notes"),
  ],
};

const prepTracker: DatabaseSpec = {
  slug: "prep_tracker",
  title: "Prep Tracker",
  icon: "\u2705",
  properties: [
    title("item"),
    select("owner_role", [
      "Director",
      "Liaison",
      "Department Head",
      "Interpreter",
    ]),
    date("due_date"),
    select("status", [
      "Not Started",
      "In Progress",
      "Complete",
      "Blocked",
      "Overdue",
    ]),
    date("completed_at"),
    richText("notes"),
  ],
};

const autographs: DatabaseSpec = {
  slug: "autographs",
  title: "Autographs",
  icon: "\u270D\uFE0F",
  properties: [
    title("session_name"),
    text("pricing"),
    text("table_location"),
    num("session_count"),
    text("time_slot"),
    richText("notes"),
  ],
};

const pairings: DatabaseSpec = {
  slug: "pairings",
  title: "Pairings",
  icon: "\u{1F91D}",
  properties: [
    title("pairing_name"),
    select("role", [
      "Primary Liaison",
      "Backup Liaison",
      "Primary Interpreter",
      "Backup Interpreter",
      "Security Escort",
    ]),
    select("designation", ["primary", "backup"]),
    select("status", ["Active", "Inactive", "Unfilled"]),
  ],
};

const venues: DatabaseSpec = {
  slug: "venues",
  title: "Venues",
  icon: "\u{1F3DB}\uFE0F",
  properties: [
    title("name"),
    select("venue_type", [
      "Main Hall",
      "Panel Room",
      "Autograph Area",
      "Meeting Room",
      "Green Room",
      "Stage",
      "Other",
    ]),
    num("capacity"),
    multiSelect("av_equipment", [
      "Projector",
      "Microphone",
      "Speakers",
      "Mixer",
      "Screen",
      "Webcam",
      "Streaming",
    ]),
    text("location_group"),
  ],
};

// -- YoY Registry databases (3) --

const guestRegistry: DatabaseSpec = {
  slug: "guest_registry",
  title: "Guest Registry",
  icon: "\u{1F4DA}",
  properties: [
    title("name"),
    richText("dietary"),
    text("interpreter_pref"),
    richText("special_handling"),
    richText("attendance_history"),
    richText("notes"),
  ],
};

const staffRegistry: DatabaseSpec = {
  slug: "staff_registry",
  title: "Staff Registry",
  icon: "\u{1F4CB}",
  properties: [
    title("name"),
    email("email"),
    multiSelect("languages", [
      "English",
      "Japanese",
      "Korean",
      "Mandarin",
      "Spanish",
      "French",
    ]),
    richText("roles_history"),
    richText("experience"),
    richText("training"),
  ],
};

const companyRegistry: DatabaseSpec = {
  slug: "company_registry",
  title: "Company Registry",
  icon: "\u{1F3E2}",
  properties: [
    title("company_name"),
    text("contact_name"),
    email("contact_email"),
    phone("contact_phone"),
    richText("contract_history"),
    richText("notes"),
  ],
};

// -- Config databases (6) --

const workflows: DatabaseSpec = {
  slug: "workflows",
  title: "Workflows",
  icon: "\u2699\uFE0F",
  properties: [
    title("name"),
    select("trigger_type", [
      "domain_event",
      "scheduled",
      "manual",
      "field_changed",
    ]),
    text("trigger_event"),
    richText("condition"),
    richText("actions"),
    checkbox("enabled"),
    richText("description"),
  ],
};

const formConfigs: DatabaseSpec = {
  slug: "form_configs",
  title: "Form Configs",
  icon: "\u{1F4DD}",
  properties: [
    title("name"),
    text("concept_key"),
    richText("fields"),
    select("layout", ["single", "two-column", "wizard"]),
    richText("steps"),
  ],
};

const viewConfigs: DatabaseSpec = {
  slug: "view_configs",
  title: "View Configs",
  icon: "\u{1F441}\uFE0F",
  properties: [
    title("name"),
    text("concept_key"),
    select("view_type", ["table", "kanban", "timeline", "detail", "dashboard"]),
    richText("config"),
  ],
};

const pageConfigs: DatabaseSpec = {
  slug: "page_configs",
  title: "Page Configs",
  icon: "\u{1F4C4}",
  properties: [
    title("name"),
    text("slug"),
    richText("widgets"),
    richText("breakpoints"),
  ],
};

const outputTemplates: DatabaseSpec = {
  slug: "output_templates",
  title: "Output Templates",
  icon: "\u{1F4E4}",
  properties: [
    title("name"),
    select("template_type", ["calendar", "doc", "email", "itinerary"]),
    richText("template"),
    text("description"),
  ],
};

const eventsLog: DatabaseSpec = {
  slug: "events_log",
  title: "Events Log",
  icon: "\u{1F4DC}",
  properties: [
    title("event_name"),
    text("event_id"),
    text("record_id"),
    text("triggered_by"),
    date("timestamp"),
    richText("workflows_triggered"),
    richText("actions_executed"),
  ],
};

// -- Role databases (5) --

const roles: DatabaseSpec = {
  slug: "roles",
  title: "Roles",
  icon: "\u{1F396}\uFE0F",
  properties: [
    title("name"),
    text("key"),
    richText("description"),
    num("priority"),
    checkbox("is_operational"),
  ],
};

const permissions: DatabaseSpec = {
  slug: "permissions",
  title: "Permissions",
  icon: "\u{1F6E1}\uFE0F",
  properties: [
    title("name"),
    text("role_key"),
    text("concept_key"),
    checkbox("can_view"),
    checkbox("can_edit"),
    checkbox("can_create"),
    checkbox("can_delete"),
    richText("visible_properties"),
    richText("editable_properties"),
  ],
};

const dataScopes: DatabaseSpec = {
  slug: "data_scopes",
  title: "Data Scopes",
  icon: "\u{1F50E}",
  properties: [
    title("name"),
    text("role_key"),
    text("concept_key"),
    select("scope_type", ["relation", "field", "department", "all"]),
    text("relation_path"),
    text("field"),
    text("value"),
  ],
};

const screenAccess: DatabaseSpec = {
  slug: "screen_access",
  title: "Screen Access",
  icon: "\u{1F5A5}\uFE0F",
  properties: [
    title("name"),
    text("role_key"),
    text("page_slug"),
    checkbox("visible"),
  ],
};

const staffingTemplates: DatabaseSpec = {
  slug: "staffing_templates",
  title: "Staffing Templates",
  icon: "\u{1F4CB}",
  properties: [
    title("name"),
    richText("condition"),
    text("required_role"),
    select("designation", ["primary", "backup"]),
    num("count"),
  ],
};

// ---------------------------------------------------------------------------
// Full list in creation order
// ---------------------------------------------------------------------------

const ALL_DATABASES: readonly DatabaseSpec[] = [
  // Ontology (5)
  concepts,
  properties,
  relationships,
  domainEvents,
  constraints,
  // Domain (13)
  guests,
  staff,
  schedule,
  travel,
  accommodations,
  dietary,
  prepTracker,
  autographs,
  pairings,
  venues,
  // YoY Registries (3)
  guestRegistry,
  staffRegistry,
  companyRegistry,
  // Config (6)
  workflows,
  formConfigs,
  viewConfigs,
  pageConfigs,
  outputTemplates,
  eventsLog,
  // Roles (5)
  roles,
  permissions,
  dataScopes,
  screenAccess,
  staffingTemplates,
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== GR-Ops: Create Notion Databases ===\n");

  const parentPageId = getParentPageId();
  console.log(`Parent page: ${parentPageId}`);
  console.log(`Creating ${ALL_DATABASES.length} databases...\n`);

  const created: Record<string, string> = {};
  let successCount = 0;
  let errorCount = 0;

  await batchExecute(ALL_DATABASES, async (spec, index) => {
    const label = `[${index + 1}/${ALL_DATABASES.length}]`;
    try {
      const dbId = await createDatabase(spec);
      created[spec.slug] = dbId;
      successCount++;
      console.log(`${label} ${spec.title} -> ${dbId}`);
    } catch (err: unknown) {
      errorCount++;
      const message = err instanceof Error ? err.message : String(err);

      // If the error suggests the DB might already exist, warn instead of failing
      if (
        message.includes("already exists") ||
        message.includes("duplicate")
      ) {
        console.warn(
          `${label} WARN: "${spec.title}" may already exist. Skipping. (${message})`
        );
      } else {
        console.error(
          `${label} ERROR creating "${spec.title}": ${message}`
        );
      }
    }
  });

  // Write manifest
  writeManifest({
    createdAt: new Date().toISOString(),
    parentPageId,
    databases: created,
  });

  console.log("\n=== Summary ===");
  console.log(`Created: ${successCount}`);
  console.log(`Errors:  ${errorCount}`);
  console.log(`Manifest saved to manifest.json\n`);

  if (errorCount > 0) {
    console.warn(
      "Some databases failed to create. Check errors above and re-run if needed."
    );
    process.exit(1);
  }

  console.log("Database IDs for your .env (optional reference):\n");
  for (const [slug, id] of Object.entries(created)) {
    console.log(`  NOTION_DB_${slug.toUpperCase()}=${id}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
