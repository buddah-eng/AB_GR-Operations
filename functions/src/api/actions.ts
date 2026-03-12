/**
 * Legacy Action Compatibility Router
 *
 * Accepts POST /api/action with body { action, params, email }
 * and maps action names to domain CRUD operations.
 *
 * This bridges the gap between the frontend's legacy api.call() pattern
 * and the backend's RESTful /api/domains/:concept endpoints.
 *
 * When Notion is unavailable (no NOTION_API_KEY), handlers return
 * empty results instead of crashing — enabling frontend dev/testing
 * without a configured Notion workspace.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth } from "../auth/middleware";
import {
  queryDatabase,
  pageToFlatObject,
  getPage,
  createPage,
  updatePage,
  buildNotionProperties,
  pageMetadata,
} from "../notion/client";
import { getDatabaseId } from "../notion/databases";

export const actionRouter = Router();

actionRouter.use(requireAuth);

// --- Types ---

interface ActionBody {
  readonly action: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly email?: string;
}

type ActionHandler = (
  params: Readonly<Record<string, unknown>>,
  req: Request,
) => Promise<unknown>;

// --- Notion availability check ---

function isNotionConfigured(): boolean {
  return Boolean(process.env.NOTION_API_KEY);
}

// --- Input validation ---

const NOTION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateNotionId(id: string, label: string): void {
  if (!id || !NOTION_ID_RE.test(id)) {
    throw new Error(`Invalid ${label}: must be a valid UUID`);
  }
}

// --- RBAC helpers ---

/** Actions that only require view permission. */
const READ_ACTIONS = new Set([
  "getDashboardData", "getGuestList", "getStaffList", "getScheduleEvents",
  "getPrepItems", "getGuest", "getGuestSchedule", "getGuestTravel",
  "getGuestDietary", "getGuestPairings", "getGuestAutographs",
  "getGuestAccommodations", "getConfig",
]);

/** Actions that require create/edit permission (priority <= 50). */
const WRITE_ACTIONS = new Set([
  "createGuest", "createStaff", "updateGuest", "updatePrepItem",
  "wizardCreateGuest", "generateItinerary", "generateChecklist",
]);

/** Maximum role priority allowed for write operations (lower = more access). */
const WRITE_MAX_PRIORITY = 50;

// --- Action registry ---

const handlers: Readonly<Record<string, ActionHandler>> = {
  getDashboardData: handleGetDashboardData,
  getGuestList: handleGetGuestList,
  getStaffList: handleGetStaffList,
  getScheduleEvents: handleGetScheduleEvents,
  getPrepItems: handleGetPrepItems,
  getGuest: handleGetGuest,
  getGuestSchedule: handleGetGuestSchedule,
  getGuestTravel: handleGetGuestTravel,
  getGuestDietary: handleGetGuestDietary,
  getGuestPairings: handleGetGuestPairings,
  getGuestAutographs: handleGetGuestAutographs,
  getGuestAccommodations: handleGetGuestAccommodations,
  createGuest: handleCreateGuest,
  createStaff: handleCreateStaff,
  updateGuest: handleUpdateGuest,
  updatePrepItem: handleUpdatePrepItem,
  wizardCreateGuest: handleWizardCreateGuest,
  generateItinerary: handleGenerateItinerary,
  generateChecklist: handleGenerateChecklist,
  getConfig: handleGetConfig,
};

// --- Main route ---

actionRouter.post("/", async (req: Request, res: Response) => {
  const body = req.body as ActionBody;

  if (!body.action || typeof body.action !== "string") {
    res.status(400).json({
      success: false,
      error: 'Missing required field "action" in request body.',
    });
    return;
  }

  const handler = handlers[body.action];
  if (!handler) {
    res.status(400).json({
      success: false,
      error: `Unknown action: "${body.action}".`,
    });
    return;
  }

  // RBAC: validate action is in known sets and enforce write permission
  if (!READ_ACTIONS.has(body.action) && !WRITE_ACTIONS.has(body.action)) {
    // Action is in handlers but not in RBAC sets — defensive check
    logger.warn(`Action "${body.action}" missing from RBAC sets`);
  }

  if (WRITE_ACTIONS.has(body.action)) {
    const priority = req.role?.priority ?? 999;
    if (priority > WRITE_MAX_PRIORITY) {
      res.status(403).json({
        success: false,
        error: "Insufficient permissions for this action.",
      });
      return;
    }
  }

  try {
    const result = await handler(body.params ?? {}, req);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Action "${body.action}" failed`, {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({
      success: false,
      error: `Action "${body.action}" failed. See server logs for details.`,
    });
  }
});

// --- Helper: attempt Notion query, return fallback on failure ---

async function tryNotion<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!isNotionConfigured()) {
    logger.info(`[dev-mode] ${label}: Notion not configured, returning fallback`);
    return fallback;
  }
  try {
    return await fn();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`${label} failed, returning fallback`, { error: message });
    return fallback;
  }
}

// --- Action handlers ---

async function handleGetDashboardData(
  _params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  // Aggregate dashboard data from multiple domain queries
  const [guests, staff, schedule, prep] = await Promise.all([
    tryNotion("dashboard.guests", () => queryDomainList("guests"), []),
    tryNotion("dashboard.staff", () => queryDomainList("staff"), []),
    tryNotion("dashboard.schedule", () => queryDomainList("schedule"), []),
    tryNotion("dashboard.prep", () => queryDomainList("prep"), []),
  ]);

  const guestList = guests as ReadonlyArray<Record<string, unknown>>;
  const staffList = staff as ReadonlyArray<Record<string, unknown>>;
  const scheduleList = schedule as ReadonlyArray<Record<string, unknown>>;
  const prepList = prep as ReadonlyArray<Record<string, unknown>>;

  // Build status breakdown
  const byStatus: Record<string, number> = {};
  for (const g of guestList) {
    const status = String(g.Status ?? g.status ?? "Unknown");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  // Build schedule type breakdown
  const byType: Record<string, number> = {};
  for (const s of scheduleList) {
    const type = String(s["Event Type"] ?? s.eventType ?? "Other");
    byType[type] = (byType[type] ?? 0) + 1;
  }

  // Prep completion
  const completedPrep = prepList.filter(
    (p) => String(p.Status ?? p.status ?? "").toLowerCase() === "complete",
  ).length;
  const prepPercent =
    prepList.length > 0
      ? Math.round((completedPrep / prepList.length) * 100)
      : 0;
  const overduePrep = prepList.filter((p) => {
    const status = String(p.Status ?? p.status ?? "").toLowerCase();
    const dueDate = String(p["Due Date"] ?? p.dueDate ?? "");
    return status !== "complete" && dueDate && dueDate < new Date().toISOString().slice(0, 10);
  }).length;

  return {
    guests: {
      total: guestList.length,
      byStatus,
      missingTravel: 0,
    },
    staffing: {
      guestsWithLiaison: 0,
      totalStaff: staffList.length,
      coverage: [],
    },
    schedule: {
      total: scheduleList.length,
      todayEvents: [],
      byType,
      daysUntilConvention: 0,
    },
    prep: {
      total: prepList.length,
      completed: completedPrep,
      percentComplete: prepPercent,
      overdue: overduePrep,
    },
    violations: {
      byStatus: {},
    },
  };
}

async function handleGetGuestList(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return tryNotion(
    "getGuestList",
    async () => {
      const raw = await queryDomainList("guests", params.filters as Record<string, string> | undefined);
      return raw.map(toGuestSummary);
    },
    [],
  );
}

async function handleGetStaffList(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return tryNotion(
    "getStaffList",
    async () => {
      const raw = await queryDomainList("staff", params.filters as Record<string, string> | undefined);
      return raw.map(toStaffSummary);
    },
    [],
  );
}

async function handleGetScheduleEvents(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return tryNotion(
    "getScheduleEvents",
    async () => {
      const raw = await queryDomainList("schedule", params.filters as Record<string, string> | undefined);
      return raw.map(toScheduleEvent);
    },
    [],
  );
}

async function handleGetPrepItems(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return tryNotion(
    "getPrepItems",
    async () => {
      const raw = await queryDomainList("prep", params.filters as Record<string, string> | undefined);
      return raw.map(toPrepItem);
    },
    [],
  );
}

async function handleGetGuest(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? params.id ?? "");
  if (!guestId) {
    throw new Error("guestId is required");
  }
  validateNotionId(guestId, "guestId");
  return tryNotion(
    "getGuest",
    async () => {
      const page = await getPage(guestId);
      return pageToFlatObject(page as Record<string, unknown>);
    },
    null,
  );
}

async function handleGetGuestSchedule(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateNotionId(guestId, "guestId");
  return tryNotion(
    "getGuestSchedule",
    () => queryRelatedRecords("schedule", "Guest", guestId),
    [],
  );
}

async function handleGetGuestTravel(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateNotionId(guestId, "guestId");
  return tryNotion(
    "getGuestTravel",
    () => queryRelatedRecords("travel", "Guest", guestId),
    [],
  );
}

async function handleGetGuestDietary(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateNotionId(guestId, "guestId");
  return tryNotion(
    "getGuestDietary",
    () => queryRelatedRecords("dietary", "Guest", guestId),
    [],
  );
}

async function handleGetGuestPairings(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateNotionId(guestId, "guestId");
  return tryNotion(
    "getGuestPairings",
    () => queryRelatedRecords("pairings", "Guest", guestId),
    [],
  );
}

async function handleGetGuestAutographs(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateNotionId(guestId, "guestId");
  return tryNotion(
    "getGuestAutographs",
    () => queryRelatedRecords("autographs", "Guest", guestId),
    [],
  );
}

async function handleGetGuestAccommodations(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateNotionId(guestId, "guestId");
  return tryNotion(
    "getGuestAccommodations",
    () => queryRelatedRecords("accommodations", "Guest", guestId),
    [],
  );
}

async function handleCreateGuest(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const data = params.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") {
    throw new Error("data object is required");
  }
  if (!isNotionConfigured()) {
    return { status: "APPLIED", pk: `dev-guest-${Date.now()}` };
  }
  return await createDomainRecord("guests", data);
}

async function handleCreateStaff(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const data = params.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") {
    throw new Error("data object is required");
  }
  if (!isNotionConfigured()) {
    return { status: "APPLIED", pk: `dev-staff-${Date.now()}` };
  }
  return await createDomainRecord("staff", data);
}

async function handleUpdateGuest(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const id = String(params.guestId ?? params.id ?? "");
  const patch = params.patch as Record<string, unknown> | undefined;
  if (!id || !patch) {
    throw new Error("guestId and patch are required");
  }
  validateNotionId(id, "guestId");
  if (!isNotionConfigured()) {
    return { status: "APPLIED" };
  }
  return await updateDomainRecord(id, patch);
}

async function handleUpdatePrepItem(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const id = String(params.prepId ?? params.id ?? "");
  const patch = params.patch as Record<string, unknown> | undefined;
  if (!id || !patch) {
    throw new Error("prepId and patch are required");
  }
  validateNotionId(id, "prepId");
  if (!isNotionConfigured()) {
    return { status: "APPLIED" };
  }
  return await updateDomainRecord(id, patch);
}

async function handleWizardCreateGuest(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestData = params.guest as Record<string, unknown> | undefined;
  const pairings = (params.pairings ?? []) as ReadonlyArray<Record<string, unknown>>;
  const schedule = (params.schedule ?? []) as ReadonlyArray<Record<string, unknown>>;
  const travelData = params.travel as Record<string, unknown> | undefined;
  const dietaryData = params.dietary as Record<string, unknown> | undefined;

  if (!guestData || typeof guestData !== "object") {
    throw new Error("guest data object is required");
  }

  if (!isNotionConfigured()) {
    return {
      guestResult: { status: "APPLIED", pk: `dev-guest-${Date.now()}` },
      pairingResults: pairings.map((_, i) => ({ status: "APPLIED", pk: `dev-pairing-${i}` })),
      scheduleResults: schedule.map((_, i) => ({ status: "APPLIED", pk: `dev-event-${i}` })),
      travelResult: undefined,
      dietaryResult: undefined,
      prepResults: [],
    };
  }

  // Create guest first
  const guestResult = await createDomainRecord("guests", guestData);
  const guestId = guestResult.pk;

  // Create related records in parallel
  const [pairingResults, scheduleResults] = await Promise.all([
    Promise.all(
      pairings.map((p) =>
        createDomainRecord("pairings", { ...p, "Guest ID": guestId }),
      ),
    ),
    Promise.all(
      schedule.map((s) =>
        createDomainRecord("schedule", { ...s, "Guest ID": guestId }),
      ),
    ),
  ]);

  let travelResult;
  if (travelData) {
    travelResult = await createDomainRecord("travel", { ...travelData, "Guest ID": guestId });
  }

  let dietaryResult;
  if (dietaryData) {
    dietaryResult = await createDomainRecord("dietary", { ...dietaryData, "Guest ID": guestId });
  }

  return {
    guestResult: { status: "APPLIED", pk: guestId },
    pairingResults,
    scheduleResults,
    travelResult,
    dietaryResult,
    prepResults: [], // TODO: auto-generate from templates
  };
}

async function handleGenerateItinerary(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? params.id ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateNotionId(guestId, "guestId");
  logger.info(`Generate itinerary requested for guest: ${guestId}`);
  // TODO: Implement Google Docs itinerary generation
  return {
    status: "PENDING",
    message: "Itinerary generation is not yet implemented. Coming in Phase 3.",
  };
}

async function handleGenerateChecklist(
  params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const guestId = String(params.guestId ?? params.id ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateNotionId(guestId, "guestId");
  logger.info(`Generate checklist requested for guest: ${guestId}`);
  // TODO: Implement Google Docs checklist generation
  return {
    status: "PENDING",
    message: "Checklist generation is not yet implemented. Coming in Phase 3.",
  };
}

async function handleGetConfig(): Promise<unknown> {
  // Delegate to the Firestore-backed config endpoint logic.
  // This keeps the action router consistent with GET /api/config.
  const admin = await import("firebase-admin");
  try {
    const doc = await admin.default.firestore().collection("platform").doc("config").get();
    if (doc.exists) {
      return doc.data();
    }
  } catch {
    // Fall through to defaults
  }
  return {
    departments: [],
    roles: [],
    eventTypes: [],
    venues: [],
    prepTemplates: [],
    constraints: [],
    convention: {
      name: "Anime Boston 2026",
      startDate: "2026-03-20",
      endDate: "2026-03-22",
      venue: "Hynes Convention Center",
    },
  };
}

// --- Notion helpers (thin wrappers around client.ts) ---

async function queryDomainList(
  conceptKey: string,
  filters?: Record<string, string>,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const dbId = getDatabaseId(conceptKey);
  const queryOpts: Record<string, unknown> = { pageSize: 100 };
  if (filters) {
    queryOpts.filter = filters;
  }
  const rows = await queryDatabase(dbId, queryOpts);
  return rows.map((row) => pageToFlatObject(row as Record<string, unknown>));
}

async function queryRelatedRecords(
  conceptKey: string,
  relationProperty: string,
  relatedId: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const dbId = getDatabaseId(conceptKey);
  const rows = await queryDatabase(dbId, {
    filter: {
      property: relationProperty,
      relation: { contains: relatedId },
    },
    pageSize: 100,
  });
  return rows.map((row) => pageToFlatObject(row as Record<string, unknown>));
}

async function createDomainRecord(
  conceptKey: string,
  data: Record<string, unknown>,
): Promise<{ status: string; pk: string }> {
  const dbId = getDatabaseId(conceptKey);

  // Build a simple property type map — treat all string fields as rich_text,
  // with the first field as title. This is a simplified version; the full
  // domain router uses the ontology for type mapping.
  const propertyTypes: Record<string, string> = {};
  const keys = Object.keys(data);
  if (keys.length > 0) {
    // First text field is typically the title (e.g., "Guest Name", "Name")
    const titleKey = keys.find((k) =>
      /name/i.test(k),
    ) ?? keys[0];
    for (const key of keys) {
      propertyTypes[key] = key === titleKey ? "title" : "rich_text";
    }
  }

  const notionProps = buildNotionProperties(data, propertyTypes);
  const created = await createPage(dbId, notionProps);
  const meta = pageMetadata(created as Record<string, unknown>);

  return { status: "APPLIED", pk: meta.id };
}

async function updateDomainRecord(
  pageId: string,
  patch: Record<string, unknown>,
): Promise<{ status: string }> {
  // Simplified: treat all fields as rich_text for updates
  const propertyTypes: Record<string, string> = {};
  for (const key of Object.keys(patch)) {
    propertyTypes[key] = "rich_text";
  }

  const notionProps = buildNotionProperties(patch, propertyTypes);
  await updatePage(pageId, notionProps);

  return { status: "APPLIED" };
}

// --- Record transformers (Notion flat → frontend format) ---

function toGuestSummary(flat: Record<string, unknown>): Record<string, unknown> {
  return {
    guestId: String(flat._id ?? flat.id ?? ""),
    name: String(flat["Guest Name"] ?? flat.Name ?? ""),
    type: String(flat["Guest Type"] ?? ""),
    department: String(flat.Department ?? ""),
    status: String(flat.Status ?? "Invited"),
    company: String(flat["Company/Affiliation"] ?? ""),
    staffCount: 0,
    prepPercent: 0,
  };
}

function toStaffSummary(flat: Record<string, unknown>): Record<string, unknown> {
  return {
    staffId: String(flat._id ?? flat.id ?? ""),
    name: String(flat.Name ?? ""),
    email: String(flat.Email ?? ""),
    role: String(flat.Role ?? ""),
    department: String(flat.Department ?? ""),
    phone: String(flat.Phone ?? ""),
    availability: String(flat.Availability ?? ""),
  };
}

function toScheduleEvent(flat: Record<string, unknown>): Record<string, unknown> {
  return {
    eventId: String(flat._id ?? flat.id ?? ""),
    activity: String(flat.Activity ?? ""),
    eventType: String(flat["Event Type"] ?? ""),
    date: String(flat.Date ?? ""),
    startTime: String(flat["Start Time"] ?? ""),
    endTime: String(flat["End Time"] ?? ""),
    venue: String(flat.Venue ?? ""),
    guestName: String(flat["Guest Name"] ?? ""),
    guestId: String(flat["Guest ID"] ?? ""),
    status: String(flat.Status ?? "Scheduled"),
    description: String(flat.Description ?? ""),
  };
}

function toPrepItem(flat: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(flat._id ?? flat.id ?? ""),
    label: String(flat.Item ?? flat.Label ?? ""),
    guestName: String(flat["Guest Name"] ?? ""),
    guestId: String(flat["Guest ID"] ?? ""),
    dueDate: String(flat["Due Date"] ?? ""),
    status: String(flat.Status ?? "Not Started"),
    owner: String(flat["Owner Role"] ?? flat.Owner ?? ""),
  };
}
