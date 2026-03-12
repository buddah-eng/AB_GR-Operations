#!/usr/bin/env tsx
/**
 * seed-roles.ts
 *
 * Seeds the role databases (Roles, Permissions, Data Scopes, Screen Access,
 * Staffing Templates) with the initial GR-Ops RBAC definitions.
 *
 * Prerequisites: run create-databases.ts first so manifest.json exists.
 *
 *   npx tsx src/seed-roles.ts
 */

import {
  type PagePropertyValue,
  readManifest,
  requireDatabaseId,
  createPage,
  batchExecute,
} from "./notion-helpers.js";

// ---------------------------------------------------------------------------
// Seed data types
// ---------------------------------------------------------------------------

interface RoleSeed {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly priority: number;
  readonly is_operational: boolean;
}

interface PermissionSeed {
  readonly role_key: string;
  readonly concept_key: string;
  readonly name: string;
  readonly can_view: boolean;
  readonly can_edit: boolean;
  readonly can_create: boolean;
  readonly can_delete: boolean;
  readonly visible_properties: string; // JSON array
  readonly editable_properties: string; // JSON array
}

interface DataScopeSeed {
  readonly role_key: string;
  readonly concept_key: string;
  readonly name: string;
  readonly scope_type: string;
  readonly relation_path?: string;
  readonly field?: string;
  readonly value?: string;
}

interface ScreenAccessSeed {
  readonly role_key: string;
  readonly page_slug: string;
  readonly name: string;
  readonly visible: boolean;
}

interface StaffingTemplateSeed {
  readonly name: string;
  readonly condition: string; // JSON
  readonly required_role: string;
  readonly designation: string;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// All domain concepts (for generating Director permissions)
// ---------------------------------------------------------------------------

const ALL_DOMAIN_CONCEPTS = [
  "guest", "staff", "schedule", "travel", "accommodations",
  "dietary", "prep_tracker", "autographs", "pairings", "venues",
  "guest_registry", "staff_registry", "company_registry",
] as const;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

const ROLES: readonly RoleSeed[] = [
  { key: "director", name: "Director", description: "GR Director with full platform access. Can manage all guests, staff, schedules, and configuration.", priority: 1, is_operational: true },
  { key: "liaison", name: "Liaison", description: "Guest liaison responsible for assigned guests. Can view and edit guest details and related records.", priority: 5, is_operational: true },
  { key: "department_head", name: "Department Head", description: "Department head with visibility into guests in their department and all staff.", priority: 3, is_operational: true },
  { key: "interpreter", name: "Interpreter", description: "Interpreter assigned to specific guests. Read-only access to schedule and guest info.", priority: 7, is_operational: true },
  { key: "volunteer", name: "Volunteer", description: "Convention volunteer with minimal access. Can view limited guest info and schedules.", priority: 10, is_operational: false },
];

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

const ALL_PROPS = JSON.stringify(["*"]);
const NO_PROPS = JSON.stringify([]);

function directorPermission(conceptKey: string): PermissionSeed {
  return {
    role_key: "director",
    concept_key: conceptKey,
    name: `director:${conceptKey}`,
    can_view: true,
    can_edit: true,
    can_create: true,
    can_delete: true,
    visible_properties: ALL_PROPS,
    editable_properties: ALL_PROPS,
  };
}

const LIAISON_CONCEPTS_FULL = ["guest", "travel", "accommodations", "dietary", "prep_tracker", "autographs", "pairings", "schedule"] as const;

const PERMISSIONS: readonly PermissionSeed[] = [
  // Director: full CRUD on everything
  ...ALL_DOMAIN_CONCEPTS.map(directorPermission),

  // Liaison: view/edit guests + related concepts, view staff, no delete
  ...LIAISON_CONCEPTS_FULL.map((c) => ({
    role_key: "liaison",
    concept_key: c,
    name: `liaison:${c}`,
    can_view: true,
    can_edit: true,
    can_create: c !== "guest", // can't create guests, but can create sub-records
    can_delete: false,
    visible_properties: ALL_PROPS,
    editable_properties: ALL_PROPS,
  })),
  {
    role_key: "liaison",
    concept_key: "staff",
    name: "liaison:staff",
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: JSON.stringify(["name", "email", "role", "department", "languages"]),
    editable_properties: NO_PROPS,
  },
  {
    role_key: "liaison",
    concept_key: "venues",
    name: "liaison:venues",
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: ALL_PROPS,
    editable_properties: NO_PROPS,
  },

  // Department Head: view/edit guests in department, view all staff
  {
    role_key: "department_head",
    concept_key: "guest",
    name: "department_head:guest",
    can_view: true,
    can_edit: true,
    can_create: false,
    can_delete: false,
    visible_properties: ALL_PROPS,
    editable_properties: JSON.stringify(["status", "special_handling", "notes"]),
  },
  {
    role_key: "department_head",
    concept_key: "staff",
    name: "department_head:staff",
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: ALL_PROPS,
    editable_properties: NO_PROPS,
  },
  {
    role_key: "department_head",
    concept_key: "schedule",
    name: "department_head:schedule",
    can_view: true,
    can_edit: true,
    can_create: false,
    can_delete: false,
    visible_properties: ALL_PROPS,
    editable_properties: JSON.stringify(["status", "description"]),
  },
  {
    role_key: "department_head",
    concept_key: "prep_tracker",
    name: "department_head:prep_tracker",
    can_view: true,
    can_edit: true,
    can_create: false,
    can_delete: false,
    visible_properties: ALL_PROPS,
    editable_properties: JSON.stringify(["status", "notes"]),
  },

  // Interpreter: view schedule + guest info for assigned guests, read-only
  {
    role_key: "interpreter",
    concept_key: "schedule",
    name: "interpreter:schedule",
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: JSON.stringify(["activity", "event_type", "date", "start_time", "end_time", "venue", "status"]),
    editable_properties: NO_PROPS,
  },
  {
    role_key: "interpreter",
    concept_key: "guest",
    name: "interpreter:guest",
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: JSON.stringify(["name", "type", "department", "status", "company", "interpreter_required", "special_handling"]),
    editable_properties: NO_PROPS,
  },
  {
    role_key: "interpreter",
    concept_key: "dietary",
    name: "interpreter:dietary",
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: ALL_PROPS,
    editable_properties: NO_PROPS,
  },

  // Volunteer: view limited guest info, no edit
  {
    role_key: "volunteer",
    concept_key: "guest",
    name: "volunteer:guest",
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: JSON.stringify(["name", "department", "status"]),
    editable_properties: NO_PROPS,
  },
  {
    role_key: "volunteer",
    concept_key: "schedule",
    name: "volunteer:schedule",
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: JSON.stringify(["activity", "event_type", "date", "start_time", "end_time", "venue", "status"]),
    editable_properties: NO_PROPS,
  },
];

// ---------------------------------------------------------------------------
// Data Scopes
// ---------------------------------------------------------------------------

const DATA_SCOPES: readonly DataScopeSeed[] = [
  // Director: no scope restriction (all data)
  { role_key: "director", concept_key: "guest", name: "director:guest:all", scope_type: "all" },

  // Liaison: guests scoped by pairings.staff = current user
  { role_key: "liaison", concept_key: "guest", name: "liaison:guest:by_pairing", scope_type: "relation", relation_path: "pairings.staff" },
  { role_key: "liaison", concept_key: "schedule", name: "liaison:schedule:by_pairing", scope_type: "relation", relation_path: "guest.pairings.staff" },

  // Department Head: guests scoped by department = user's department
  { role_key: "department_head", concept_key: "guest", name: "dept_head:guest:by_dept", scope_type: "department" },
  { role_key: "department_head", concept_key: "staff", name: "dept_head:staff:all", scope_type: "all" },

  // Interpreter: guests scoped by pairings.staff = current user
  { role_key: "interpreter", concept_key: "guest", name: "interpreter:guest:by_pairing", scope_type: "relation", relation_path: "pairings.staff" },
  { role_key: "interpreter", concept_key: "schedule", name: "interpreter:schedule:by_pairing", scope_type: "relation", relation_path: "guest.pairings.staff" },

  // Volunteer: all guests (but limited field visibility via permissions)
  { role_key: "volunteer", concept_key: "guest", name: "volunteer:guest:all", scope_type: "all" },
  { role_key: "volunteer", concept_key: "schedule", name: "volunteer:schedule:all", scope_type: "all" },
];

// ---------------------------------------------------------------------------
// Screen Access
// ---------------------------------------------------------------------------

const ALL_PAGES = ["dashboard", "guests", "schedule", "prep-tracker", "staff", "venues", "travel", "accommodations", "settings", "reports"] as const;

const SCREEN_ACCESS: readonly ScreenAccessSeed[] = [
  // Director: all pages visible
  ...ALL_PAGES.map((slug) => ({
    role_key: "director",
    page_slug: slug,
    name: `director:${slug}`,
    visible: true,
  })),

  // Liaison: dashboard, guests, schedule, prep-tracker, staff
  ...["dashboard", "guests", "schedule", "prep-tracker", "staff"].map((slug) => ({
    role_key: "liaison",
    page_slug: slug,
    name: `liaison:${slug}`,
    visible: true,
  })),
  ...["venues", "travel", "accommodations", "settings", "reports"].map((slug) => ({
    role_key: "liaison",
    page_slug: slug,
    name: `liaison:${slug}`,
    visible: false,
  })),

  // Department Head: dashboard, guests, schedule, staff
  ...["dashboard", "guests", "schedule", "staff"].map((slug) => ({
    role_key: "department_head",
    page_slug: slug,
    name: `department_head:${slug}`,
    visible: true,
  })),
  ...["prep-tracker", "venues", "travel", "accommodations", "settings", "reports"].map((slug) => ({
    role_key: "department_head",
    page_slug: slug,
    name: `department_head:${slug}`,
    visible: false,
  })),

  // Interpreter: dashboard, schedule
  ...["dashboard", "schedule"].map((slug) => ({
    role_key: "interpreter",
    page_slug: slug,
    name: `interpreter:${slug}`,
    visible: true,
  })),
  ...["guests", "prep-tracker", "staff", "venues", "travel", "accommodations", "settings", "reports"].map((slug) => ({
    role_key: "interpreter",
    page_slug: slug,
    name: `interpreter:${slug}`,
    visible: false,
  })),

  // Volunteer: dashboard, schedule
  ...["dashboard", "schedule"].map((slug) => ({
    role_key: "volunteer",
    page_slug: slug,
    name: `volunteer:${slug}`,
    visible: true,
  })),
  ...["guests", "prep-tracker", "staff", "venues", "travel", "accommodations", "settings", "reports"].map((slug) => ({
    role_key: "volunteer",
    page_slug: slug,
    name: `volunteer:${slug}`,
    visible: false,
  })),
];

// ---------------------------------------------------------------------------
// Staffing Templates
// ---------------------------------------------------------------------------

const STAFFING_TEMPLATES: readonly StaffingTemplateSeed[] = [
  {
    name: "All Guests: Primary Liaison",
    condition: JSON.stringify({ type: "field", field: "status", operator: "neq", value: "Cancelled" }),
    required_role: "liaison",
    designation: "primary",
    count: 1,
  },
  {
    name: "All Guests: Backup Liaison",
    condition: JSON.stringify({ type: "field", field: "status", operator: "neq", value: "Cancelled" }),
    required_role: "liaison",
    designation: "backup",
    count: 1,
  },
  {
    name: "JP Guests: Primary Interpreter",
    condition: JSON.stringify({ type: "field", field: "type", operator: "eq", value: "JP" }),
    required_role: "interpreter",
    designation: "primary",
    count: 1,
  },
  {
    name: "JP Guests: Backup Interpreter",
    condition: JSON.stringify({ type: "field", field: "type", operator: "eq", value: "JP" }),
    required_role: "interpreter",
    designation: "backup",
    count: 1,
  },
];

// ---------------------------------------------------------------------------
// Field builders
// ---------------------------------------------------------------------------

function roleToFields(r: RoleSeed): Record<string, PagePropertyValue> {
  return {
    name: { type: "title", value: r.name },
    key: { type: "rich_text", value: r.key },
    description: { type: "rich_text", value: r.description },
    priority: { type: "number", value: r.priority },
    is_operational: { type: "checkbox", value: r.is_operational },
  };
}

function permissionToFields(p: PermissionSeed): Record<string, PagePropertyValue> {
  return {
    name: { type: "title", value: p.name },
    role_key: { type: "rich_text", value: p.role_key },
    concept_key: { type: "rich_text", value: p.concept_key },
    can_view: { type: "checkbox", value: p.can_view },
    can_edit: { type: "checkbox", value: p.can_edit },
    can_create: { type: "checkbox", value: p.can_create },
    can_delete: { type: "checkbox", value: p.can_delete },
    visible_properties: { type: "rich_text", value: p.visible_properties },
    editable_properties: { type: "rich_text", value: p.editable_properties },
  };
}

function dataScopeToFields(d: DataScopeSeed): Record<string, PagePropertyValue> {
  const fields: Record<string, PagePropertyValue> = {
    name: { type: "title", value: d.name },
    role_key: { type: "rich_text", value: d.role_key },
    concept_key: { type: "rich_text", value: d.concept_key },
    scope_type: { type: "select", value: d.scope_type },
  };

  if (d.relation_path) {
    fields.relation_path = { type: "rich_text", value: d.relation_path };
  }
  if (d.field) {
    fields.field = { type: "rich_text", value: d.field };
  }
  if (d.value) {
    fields.value = { type: "rich_text", value: d.value };
  }

  return fields;
}

function screenAccessToFields(s: ScreenAccessSeed): Record<string, PagePropertyValue> {
  return {
    name: { type: "title", value: s.name },
    role_key: { type: "rich_text", value: s.role_key },
    page_slug: { type: "rich_text", value: s.page_slug },
    visible: { type: "checkbox", value: s.visible },
  };
}

function staffingTemplateToFields(t: StaffingTemplateSeed): Record<string, PagePropertyValue> {
  return {
    name: { type: "title", value: t.name },
    condition: { type: "rich_text", value: t.condition },
    required_role: { type: "rich_text", value: t.required_role },
    designation: { type: "select", value: t.designation },
    count: { type: "number", value: t.count },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== GR-Ops: Seed Roles & Permissions ===\n");

  const manifest = readManifest();

  const rolesDbId = requireDatabaseId(manifest, "roles");
  const permissionsDbId = requireDatabaseId(manifest, "permissions");
  const dataScopesDbId = requireDatabaseId(manifest, "data_scopes");
  const screenAccessDbId = requireDatabaseId(manifest, "screen_access");
  const staffingTemplatesDbId = requireDatabaseId(manifest, "staffing_templates");

  // Seed Roles
  console.log(`Seeding ${ROLES.length} roles...`);
  await batchExecute(ROLES, async (r, i) => {
    try {
      const pageId = await createPage(rolesDbId, roleToFields(r));
      console.log(`  [${i + 1}/${ROLES.length}] Role "${r.name}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${ROLES.length}] ERROR seeding role "${r.name}": ${msg}`);
    }
  });

  // Seed Permissions
  console.log(`\nSeeding ${PERMISSIONS.length} permissions...`);
  await batchExecute(PERMISSIONS, async (p, i) => {
    try {
      const pageId = await createPage(permissionsDbId, permissionToFields(p));
      console.log(`  [${i + 1}/${PERMISSIONS.length}] Permission "${p.name}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${PERMISSIONS.length}] ERROR seeding permission "${p.name}": ${msg}`);
    }
  });

  // Seed Data Scopes
  console.log(`\nSeeding ${DATA_SCOPES.length} data scopes...`);
  await batchExecute(DATA_SCOPES, async (d, i) => {
    try {
      const pageId = await createPage(dataScopesDbId, dataScopeToFields(d));
      console.log(`  [${i + 1}/${DATA_SCOPES.length}] Data Scope "${d.name}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${DATA_SCOPES.length}] ERROR seeding data scope "${d.name}": ${msg}`);
    }
  });

  // Seed Screen Access
  console.log(`\nSeeding ${SCREEN_ACCESS.length} screen access rules...`);
  await batchExecute(SCREEN_ACCESS, async (s, i) => {
    try {
      const pageId = await createPage(screenAccessDbId, screenAccessToFields(s));
      console.log(`  [${i + 1}/${SCREEN_ACCESS.length}] Screen Access "${s.name}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${SCREEN_ACCESS.length}] ERROR seeding screen access "${s.name}": ${msg}`);
    }
  });

  // Seed Staffing Templates
  console.log(`\nSeeding ${STAFFING_TEMPLATES.length} staffing templates...`);
  await batchExecute(STAFFING_TEMPLATES, async (t, i) => {
    try {
      const pageId = await createPage(staffingTemplatesDbId, staffingTemplateToFields(t));
      console.log(`  [${i + 1}/${STAFFING_TEMPLATES.length}] Staffing Template "${t.name}" -> ${pageId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${i + 1}/${STAFFING_TEMPLATES.length}] ERROR seeding staffing template "${t.name}": ${msg}`);
    }
  });

  console.log("\n=== Role seeding complete ===");
  console.log(`  Roles:              ${ROLES.length}`);
  console.log(`  Permissions:        ${PERMISSIONS.length}`);
  console.log(`  Data Scopes:        ${DATA_SCOPES.length}`);
  console.log(`  Screen Access:      ${SCREEN_ACCESS.length}`);
  console.log(`  Staffing Templates: ${STAFFING_TEMPLATES.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
