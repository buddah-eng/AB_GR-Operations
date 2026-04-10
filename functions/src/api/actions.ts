/**
 * Legacy Action Compatibility Router
 *
 * Accepts POST /api/action with body { action, params, email }
 * and maps action names to domain CRUD operations via Postgres.
 *
 * This bridges the gap between the frontend's legacy api.call() pattern
 * and the backend's RESTful /api/domains/:concept endpoints.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth } from "../auth/middleware";
import { query } from "../db/client";
import { auditContextFromRequest, withAuditContext, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";

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

// --- UUID validation ---

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateId(id: string, label: string): void {
  if (!id || !UUID_RE.test(id)) {
    throw new Error(`Invalid ${label}: must be a valid UUID`);
  }
}

// --- RBAC helpers ---

const READ_ACTIONS = new Set([
  "getDashboardData", "getGuestList", "getStaffList", "getScheduleEvents",
  "getPrepItems", "getGuest", "getGuestSchedule", "getGuestPairings",
  "getConfig",
]);

const WRITE_ACTIONS = new Set([
  "createGuest", "createStaff", "updateGuest", "updatePrepItem",
  "wizardCreateGuest",
]);

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
  getGuestPairings: handleGetGuestPairings,
  createGuest: handleCreateGuest,
  createStaff: handleCreateStaff,
  updateGuest: handleUpdateGuest,
  updatePrepItem: handleUpdatePrepItem,
  wizardCreateGuest: handleWizardCreateGuest,
  getConfig: handleGetConfig,
};

// --- Main route ---

actionRouter.post("/", async (req: Request, res: Response) => {
  const body = req.body as ActionBody;

  if (!body.action || typeof body.action !== "string") {
    res.status(400).json({ success: false, error: 'Missing required field "action".' });
    return;
  }

  const handler = handlers[body.action];
  if (!handler) {
    res.status(400).json({ success: false, error: `Unknown action: "${body.action}".` });
    return;
  }

  if (!READ_ACTIONS.has(body.action) && !WRITE_ACTIONS.has(body.action)) {
    logger.warn(`Action "${body.action}" missing from RBAC sets`);
  }

  if (WRITE_ACTIONS.has(body.action)) {
    const priority = req.role?.priority ?? 999;
    if (priority > WRITE_MAX_PRIORITY) {
      res.status(403).json({ success: false, error: "Insufficient permissions for this action." });
      return;
    }
  }

  try {
    const result = await handler(body.params ?? {}, req);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Action "${body.action}" failed`, { error: message });
    res.status(500).json({ success: false, error: `Action "${body.action}" failed.` });
  }
});

// --- Action handlers ---

async function handleGetDashboardData(): Promise<unknown> {
  const [guests, staff, schedule, prep] = await Promise.all([
    query("SELECT status, COUNT(*) FROM guests WHERE NOT archived GROUP BY status"),
    query("SELECT COUNT(*) FROM staff WHERE NOT archived"),
    query("SELECT event_type, COUNT(*) FROM schedule_events WHERE NOT archived GROUP BY event_type"),
    query("SELECT status, COUNT(*) FROM prep_items WHERE NOT archived GROUP BY status"),
  ]);

  const byStatus: Record<string, number> = {};
  let guestTotal = 0;
  for (const row of guests.rows) {
    const status = row.status as string;
    const count = parseInt(row.count as string, 10);
    byStatus[status] = count;
    guestTotal += count;
  }

  const staffTotal = parseInt(staff.rows[0]?.count as string ?? "0", 10);

  const byType: Record<string, number> = {};
  let scheduleTotal = 0;
  for (const row of schedule.rows) {
    const type = row.event_type as string ?? "Other";
    const count = parseInt(row.count as string, 10);
    byType[type] = count;
    scheduleTotal += count;
  }

  let prepTotal = 0;
  let completedPrep = 0;
  for (const row of prep.rows) {
    const count = parseInt(row.count as string, 10);
    prepTotal += count;
    if ((row.status as string)?.toLowerCase() === "complete") {
      completedPrep = count;
    }
  }
  const prepPercent = prepTotal > 0 ? Math.round((completedPrep / prepTotal) * 100) : 0;

  return {
    guests: { total: guestTotal, byStatus, missingTravel: 0 },
    staffing: { totalStaff: staffTotal, guestsWithLiaison: 0, coverage: [] },
    schedule: { total: scheduleTotal, todayEvents: [], byType, daysUntilConvention: 0 },
    prep: { total: prepTotal, completed: completedPrep, percentComplete: prepPercent, overdue: 0 },
    violations: { byStatus: {} },
  };
}

async function handleGetGuestList(): Promise<unknown> {
  const result = await query(
    "SELECT id, name, type, department, status, company, properties FROM guests WHERE NOT archived ORDER BY name"
  );
  return result.rows.map((row) => ({
    guestId: row.id,
    name: row.name,
    type: row.type,
    department: row.department,
    status: row.status,
    company: row.company,
    staffCount: 0,
    prepPercent: 0,
  }));
}

async function handleGetStaffList(): Promise<unknown> {
  const result = await query(
    "SELECT id, name, email, role_key, department, phone, properties FROM staff WHERE NOT archived ORDER BY name"
  );
  return result.rows.map((row) => ({
    staffId: row.id,
    name: row.name,
    email: row.email,
    role: row.role_key,
    department: row.department,
    phone: row.phone,
  }));
}

async function handleGetScheduleEvents(): Promise<unknown> {
  const result = await query(
    "SELECT * FROM schedule_events WHERE NOT archived ORDER BY start_time"
  );
  return result.rows.map((row) => ({
    eventId: row.id,
    activity: row.name,
    eventType: row.event_type,
    startTime: row.start_time,
    endTime: row.end_time,
    venue: row.venue_id,
    status: row.status,
  }));
}

async function handleGetPrepItems(): Promise<unknown> {
  const result = await query(
    "SELECT p.*, g.name as guest_name FROM prep_items p LEFT JOIN guests g ON p.guest_id = g.id WHERE NOT p.archived ORDER BY p.due_date"
  );
  return result.rows.map((row) => ({
    id: row.id,
    label: row.name,
    guestName: row.guest_name,
    guestId: row.guest_id,
    dueDate: row.due_date,
    status: row.status,
  }));
}

async function handleGetGuest(params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const guestId = String(params.guestId ?? params.id ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateId(guestId, "guestId");

  const result = await query("SELECT * FROM guests WHERE id = $1 AND NOT archived", [guestId]);
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return { ...row, ...(row.properties as Record<string, unknown> ?? {}) };
}

async function handleGetGuestSchedule(params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const guestId = String(params.guestId ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateId(guestId, "guestId");

  const result = await query(
    "SELECT * FROM schedule_events WHERE properties->>'guest_id' = $1 AND NOT archived ORDER BY start_time",
    [guestId]
  );
  return result.rows;
}

async function handleGetGuestPairings(params: Readonly<Record<string, unknown>>): Promise<unknown> {
  const guestId = String(params.guestId ?? "");
  if (!guestId) throw new Error("guestId is required");
  validateId(guestId, "guestId");

  const result = await query(
    "SELECT p.*, s.name as staff_name, s.email as staff_email FROM pairings p LEFT JOIN staff s ON p.staff_id = s.id WHERE p.guest_id = $1 AND NOT p.archived",
    [guestId]
  );
  return result.rows;
}

async function handleCreateGuest(params: Readonly<Record<string, unknown>>, req: Request): Promise<unknown> {
  const data = params.data as Record<string, unknown> | undefined;
  if (!data) throw new Error("data object is required");

  const auditCtx = auditContextFromRequest(req);
  const result = await withAuditContext(auditCtx, (client) =>
    client.query(
      `INSERT INTO guests (name, type, department, status, company, properties)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [data.name, data.type, data.department, data.status ?? "draft", data.company, JSON.stringify(data)]
    )
  );

  const pk = result.rows[0].id as string;
  logAuditClaim(auditCtx, "POST /api/action (createGuest)");

  const event = createDomainEvent({
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: pk,
    newValues: data,
    triggeredBy: req.user?.email ?? "system",
    changeSet: auditCtx.changeSet,
  });
  await emit(event);

  return { status: "APPLIED", pk };
}

async function handleCreateStaff(params: Readonly<Record<string, unknown>>, req: Request): Promise<unknown> {
  const data = params.data as Record<string, unknown> | undefined;
  if (!data) throw new Error("data object is required");

  const auditCtx = auditContextFromRequest(req);
  const result = await withAuditContext(auditCtx, (client) =>
    client.query(
      `INSERT INTO staff (name, email, role_key, department, phone, properties)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [data.name, data.email, data.role_key, data.department, data.phone, JSON.stringify(data)]
    )
  );

  const pk = result.rows[0].id as string;
  logAuditClaim(auditCtx, "POST /api/action (createStaff)");

  const event = createDomainEvent({
    eventName: "staff.created",
    domain: "staff",
    action: "created",
    recordId: pk,
    newValues: data,
    triggeredBy: req.user?.email ?? "system",
    changeSet: auditCtx.changeSet,
  });
  await emit(event);

  return { status: "APPLIED", pk };
}

async function handleUpdateGuest(params: Readonly<Record<string, unknown>>, req: Request): Promise<unknown> {
  const id = String(params.guestId ?? params.id ?? "");
  const patch = params.patch as Record<string, unknown> | undefined;
  if (!id || !patch) throw new Error("guestId and patch are required");
  validateId(id, "guestId");

  const setClauses: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  let idx = 1;

  const coreFields = ["name", "type", "department", "status", "company"];
  for (const field of coreFields) {
    if (field in patch) {
      setClauses.push(`${field} = $${idx}`);
      values.push(patch[field]);
      idx++;
    }
  }

  // Merge remaining fields into JSONB
  const jsonbPatch = Object.fromEntries(
    Object.entries(patch).filter(([k]) => !coreFields.includes(k))
  );
  if (Object.keys(jsonbPatch).length > 0) {
    setClauses.push(`properties = properties || $${idx}`);
    values.push(JSON.stringify(jsonbPatch));
    idx++;
  }

  values.push(id);

  const auditCtx = auditContextFromRequest(req);
  await withAuditContext(auditCtx, (client) =>
    client.query(
      `UPDATE guests SET ${setClauses.join(", ")} WHERE id = $${idx}`,
      values
    )
  );

  logAuditClaim(auditCtx, `POST /api/action (updateGuest ${id})`);

  const event = createDomainEvent({
    eventName: "guest.updated",
    domain: "guest",
    action: "updated",
    recordId: id,
    changedFields: Object.keys(patch),
    newValues: patch,
    triggeredBy: req.user?.email ?? "system",
    changeSet: auditCtx.changeSet,
  });
  await emit(event);

  return { status: "APPLIED" };
}

async function handleUpdatePrepItem(params: Readonly<Record<string, unknown>>, req: Request): Promise<unknown> {
  const id = String(params.prepId ?? params.id ?? "");
  const patch = params.patch as Record<string, unknown> | undefined;
  if (!id || !patch) throw new Error("prepId and patch are required");
  validateId(id, "prepId");

  const setClauses: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  let idx = 1;

  if ("status" in patch) {
    setClauses.push(`status = $${idx}`);
    values.push(patch.status);
    idx++;
  }
  if ("name" in patch) {
    setClauses.push(`name = $${idx}`);
    values.push(patch.name);
    idx++;
  }

  values.push(id);

  const auditCtx = auditContextFromRequest(req);
  await withAuditContext(auditCtx, (client) =>
    client.query(
      `UPDATE prep_items SET ${setClauses.join(", ")} WHERE id = $${idx}`,
      values
    )
  );

  logAuditClaim(auditCtx, `POST /api/action (updatePrepItem ${id})`);

  const event = createDomainEvent({
    eventName: "prep_item.updated",
    domain: "prep_item",
    action: "updated",
    recordId: id,
    changedFields: Object.keys(patch),
    newValues: patch,
    triggeredBy: req.user?.email ?? "system",
    changeSet: auditCtx.changeSet,
  });
  await emit(event);

  return { status: "APPLIED" };
}

async function handleWizardCreateGuest(params: Readonly<Record<string, unknown>>, req: Request): Promise<unknown> {
  const guestData = params.guest as Record<string, unknown> | undefined;
  const pairings = (params.pairings ?? []) as ReadonlyArray<Record<string, unknown>>;
  const schedule = (params.schedule ?? []) as ReadonlyArray<Record<string, unknown>>;

  if (!guestData) throw new Error("guest data object is required");

  const auditCtx = auditContextFromRequest(req);

  // Create guest, pairings, and schedule within audited transaction
  const result = await withAuditContext(auditCtx, async (client) => {
    const guestResult = await client.query(
      `INSERT INTO guests (name, type, department, status, company, properties)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [guestData.name, guestData.type, guestData.department, guestData.status ?? "draft", guestData.company, JSON.stringify(guestData)]
    );
    const guestId = guestResult.rows[0].id as string;

    const pairingResults: Array<{ status: string; pk: string }> = [];
    for (const p of pairings) {
      const r = await client.query(
        `INSERT INTO pairings (guest_id, staff_id, role, properties) VALUES ($1, $2, $3, $4) RETURNING id`,
        [guestId, p.staff_id, p.role, JSON.stringify(p)]
      );
      pairingResults.push({ status: "APPLIED", pk: r.rows[0].id as string });
    }

    const scheduleResults: Array<{ status: string; pk: string }> = [];
    for (const s of schedule) {
      const r = await client.query(
        `INSERT INTO schedule_events (name, event_type, start_time, end_time, status, properties)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [s.name ?? s.activity, s.event_type, s.start_time, s.end_time, "scheduled", JSON.stringify({ ...s, guest_id: guestId })]
      );
      scheduleResults.push({ status: "APPLIED", pk: r.rows[0].id as string });
    }

    return {
      guestResult: { status: "APPLIED", pk: guestId },
      pairingResults,
      scheduleResults,
      prepResults: [] as Array<{ status: string; pk: string }>,
    };
  });

  logAuditClaim(auditCtx, "POST /api/action (wizardCreateGuest)");

  const event = createDomainEvent({
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: result.guestResult.pk,
    newValues: guestData,
    triggeredBy: req.user?.email ?? "system",
    changeSet: auditCtx.changeSet,
  });
  await emit(event);

  return result;
}

async function handleGetConfig(): Promise<unknown> {
  // Return config from Postgres roles and ontology
  const rolesResult = await query("SELECT key, name, priority, is_operational FROM roles ORDER BY priority");

  return {
    departments: [],
    roles: rolesResult.rows.map((r) => ({ key: r.key, name: r.name, priority: r.priority })),
    eventTypes: [],
    venues: [],
    prepTemplates: [],
    constraints: [],
    convention: {
      name: process.env.CONVENTION_NAME ?? "Convention",
      startDate: process.env.CONVENTION_START_DATE ?? "",
      endDate: process.env.CONVENTION_END_DATE ?? "",
      venue: process.env.CONVENTION_VENUE ?? "",
    },
  };
}
