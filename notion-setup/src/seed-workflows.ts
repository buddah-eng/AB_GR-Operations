#!/usr/bin/env tsx
/**
 * seed-workflows.ts
 *
 * Seeds the Workflows database with initial workflow definitions for the
 * GR-Ops platform automation engine.
 *
 * Prerequisites: run create-databases.ts first so manifest.json exists.
 *
 *   npx tsx src/seed-workflows.ts
 */

import {
  type PagePropertyValue,
  readManifest,
  requireDatabaseId,
  createPage,
  batchExecute,
} from "./notion-helpers.js";

// ---------------------------------------------------------------------------
// Workflow seed type
// ---------------------------------------------------------------------------

interface WorkflowSeed {
  readonly name: string;
  readonly trigger_type: string;
  readonly trigger_event: string;
  readonly condition: string; // JSON or empty
  readonly actions: string; // JSON array
  readonly enabled: boolean;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Workflow definitions
// ---------------------------------------------------------------------------

const WORKFLOWS: readonly WorkflowSeed[] = [
  // 1. New Guest Pipeline
  {
    name: "New Guest Pipeline",
    trigger_type: "domain_event",
    trigger_event: "guest.created",
    condition: "",
    actions: JSON.stringify([
      {
        type: "create_records",
        target: "prep_tracker",
        template: "new_guest_prep_checklist",
        link: "guest",
        defaults: { status: "Not Started" },
      },
      {
        type: "create_record",
        target: "schedule",
        link: "guest",
        defaults: { activity: "{{guest.name}} - Schedule Skeleton", event_type: "Staff", status: "Tentative" },
      },
      {
        type: "create_record",
        target: "travel",
        link: "guest",
        defaults: { description: "{{guest.name}} - Travel TBD", travel_type: "Flight", status: "Pending" },
      },
      {
        type: "create_record",
        target: "accommodations",
        link: "guest",
        defaults: { hotel: "TBD", status: "Pending" },
      },
      {
        type: "lookup_registry",
        source: "guest_registry",
        match: "name",
        copyFields: ["dietary", "interpreter_pref", "special_handling"],
      },
      {
        type: "notify",
        recipients: ["director"],
        templateName: "new_guest_notification",
      },
    ]),
    enabled: true,
    description: "When a new guest is created: generate prep checklist, schedule skeleton, travel/accommodations placeholders, look up guest registry history, and notify director.",
  },

  // 2. JP Guest Extras
  {
    name: "JP Guest Extras",
    trigger_type: "domain_event",
    trigger_event: "guest.created",
    condition: JSON.stringify({
      type: "field",
      field: "type",
      operator: "eq",
      value: "JP",
    }),
    actions: JSON.stringify([
      {
        type: "update_record",
        target: "guest",
        defaults: { interpreter_required: true },
      },
      {
        type: "create_record",
        target: "pairings",
        link: "guest",
        defaults: {
          pairing_name: "{{guest.name}} - Interpreter",
          role: "Primary Interpreter",
          designation: "primary",
          status: "Unfilled",
        },
      },
      {
        type: "create_records",
        target: "prep_tracker",
        template: "jp_guest_extra_prep",
        link: "guest",
        defaults: { status: "Not Started" },
      },
    ]),
    enabled: true,
    description: "When a JP guest is created: set interpreter_required=true, create an interpreter pairing slot, and add JP-specific prep items (e.g. interpreter briefing, LINE setup, cultural notes).",
  },

  // 3. Schedule to Calendar
  {
    name: "Schedule to Calendar",
    trigger_type: "domain_event",
    trigger_event: "schedule.created",
    condition: "",
    actions: JSON.stringify([
      {
        type: "sync_calendar",
        target: "schedule",
      },
    ]),
    enabled: true,
    description: "When a new schedule event is created, sync it to Google Calendar.",
  },

  // 4. Schedule Update Sync
  {
    name: "Schedule Update Sync",
    trigger_type: "domain_event",
    trigger_event: "schedule.updated",
    condition: "",
    actions: JSON.stringify([
      {
        type: "sync_calendar",
        target: "schedule",
      },
    ]),
    enabled: true,
    description: "When a schedule event is updated, update the corresponding Google Calendar event.",
  },

  // 5. Travel Update
  {
    name: "Travel Update",
    trigger_type: "domain_event",
    trigger_event: "travel.updated",
    condition: "",
    actions: JSON.stringify([
      {
        type: "update_record",
        target: "schedule",
        defaults: {
          _lookup: "event_type=Transport AND guest=travel.guest",
          date: "{{travel.arrival_date}}",
          start_time: "{{travel.arrival_time}}",
          description: "{{travel.carrier}} {{travel.route}} - Conf: {{travel.confirmation_number}}",
        },
      },
    ]),
    enabled: true,
    description: "When travel details are updated, update the related Transport schedule events for arrival/departure times.",
  },

  // 6. Pairing Created
  {
    name: "Pairing Created",
    trigger_type: "domain_event",
    trigger_event: "pairings.created",
    condition: "",
    actions: JSON.stringify([
      {
        type: "sync_calendar",
        target: "schedule",
        defaults: {
          _lookup: "guest=pairing.guest",
          _action: "add_attendee",
          attendee: "{{pairing.staff.email}}",
        },
      },
    ]),
    enabled: true,
    description: "When a staff member is paired with a guest, add them as an attendee to all of that guest's Calendar events.",
  },

  // 7. Prep Overdue Check
  {
    name: "Prep Overdue Check",
    trigger_type: "scheduled",
    trigger_event: "cron:0 9 * * *",
    condition: "",
    actions: JSON.stringify([
      {
        type: "update_record",
        target: "prep_tracker",
        defaults: {
          _lookup: "status!=Complete AND due_date<today",
          status: "Overdue",
        },
      },
      {
        type: "notify",
        recipients: ["_owner"],
        templateName: "prep_overdue_notification",
      },
    ]),
    enabled: true,
    description: "Runs daily at 9am: finds prep items past their due date, marks them as Overdue, and notifies the assigned owners.",
  },

  // 8. Staffing Auto-Create
  {
    name: "Staffing Auto-Create",
    trigger_type: "domain_event",
    trigger_event: "guest.created",
    condition: "",
    actions: JSON.stringify([
      {
        type: "create_records",
        target: "pairings",
        template: "_staffing_templates",
        link: "guest",
        defaults: { status: "Unfilled" },
      },
    ]),
    enabled: true,
    description: "When a new guest is created, read all staffing templates and create the corresponding pairing records (Primary Liaison, Backup Liaison, etc.) with Unfilled status.",
  },
];

// ---------------------------------------------------------------------------
// Field builder
// ---------------------------------------------------------------------------

function workflowToFields(w: WorkflowSeed): Record<string, PagePropertyValue> {
  const fields: Record<string, PagePropertyValue> = {
    name: { type: "title", value: w.name },
    trigger_type: { type: "select", value: w.trigger_type },
    trigger_event: { type: "rich_text", value: w.trigger_event },
    actions: { type: "rich_text", value: w.actions },
    enabled: { type: "checkbox", value: w.enabled },
    description: { type: "rich_text", value: w.description },
  };

  if (w.condition) {
    fields.condition = { type: "rich_text", value: w.condition };
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== GR-Ops: Seed Workflows ===\n");

  const manifest = readManifest();
  const workflowsDbId = requireDatabaseId(manifest, "workflows");

  console.log(`Seeding ${WORKFLOWS.length} workflows...`);
  await batchExecute(WORKFLOWS, async (w, i) => {
    try {
      const pageId = await createPage(workflowsDbId, workflowToFields(w));
      console.log(`  [${i + 1}/${WORKFLOWS.length}] Workflow "${w.name}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${WORKFLOWS.length}] ERROR seeding workflow "${w.name}": ${msg}`);
    }
  });

  console.log("\n=== Workflow seeding complete ===");
  console.log(`  Workflows: ${WORKFLOWS.length}`);
  console.log("\nWorkflows created:");
  for (const w of WORKFLOWS) {
    console.log(`  - ${w.name} (${w.trigger_type}: ${w.trigger_event})${w.enabled ? "" : " [DISABLED]"}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
