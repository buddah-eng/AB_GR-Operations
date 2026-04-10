/**
 * Venues API Router
 *
 * CRUD for venues, plus availability and capacity checks.
 *
 * Auth levels:
 *   - GET endpoints: authentication only
 *   - POST/PUT/DELETE: coordinator role (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware";
import {
  auditContextFromRequest,
  withAuditContext,
  logAuditClaim,
} from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  listVenues,
  getVenueById,
  checkVenueAvailability,
  checkCapacity,
} from "../services/venues";
import type { VenueFilters, VenueType } from "../services/venues";

// --- Validation schemas ---

const venueTypeEnum = z.enum([
  "ballroom", "meeting_room", "outdoor", "theater", "breakout", "lobby", "other",
]);

const createVenueSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: venueTypeEnum,
  capacity: z.number().int().nonnegative("Capacity must be a non-negative integer").optional(),
  floor: z.string().optional(),
  building: z.string().optional(),
  equipment: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

const updateVenueSchema = createVenueSchema.partial();

// --- Router ---

export const venueRouter = Router();

venueRouter.use(requireAuth);

// --- GET / --- list venues ---

venueRouter.get("/", async (req: Request, res: Response) => {
  try {
    const filters: VenueFilters = {
      type: req.query.type as VenueType | undefined,
      minCapacity: req.query.minCapacity
        ? parseInt(String(req.query.minCapacity), 10)
        : undefined,
      floor: req.query.floor as string | undefined,
      building: req.query.building as string | undefined,
    };

    const venues = await listVenues(filters);
    res.json({ success: true, data: venues });
  } catch (err: unknown) {
    handleError(res, err, "listing venues");
  }
});

// --- GET /:id --- get single venue ---

venueRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const venue = await getVenueById(req.params.id);

    if (!venue) {
      res.status(404).json({ success: false, error: "Venue not found" });
      return;
    }

    res.json({ success: true, data: venue });
  } catch (err: unknown) {
    handleError(res, err, "getting venue");
  }
});

// --- GET /:id/availability --- check availability ---

venueRouter.get("/:id/availability", async (req: Request, res: Response) => {
  try {
    const { startTime, endTime } = req.query as {
      startTime?: string;
      endTime?: string;
    };

    if (!startTime || !endTime) {
      res.status(400).json({
        success: false,
        error: "startTime and endTime query parameters are required",
      });
      return;
    }

    const result = await checkVenueAvailability(
      req.params.id,
      startTime,
      endTime
    );
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    handleError(res, err, "checking venue availability");
  }
});

// --- GET /:id/capacity --- check capacity ---

venueRouter.get("/:id/capacity", async (req: Request, res: Response) => {
  try {
    const requiredCapacity = parseInt(
      String(req.query.required ?? "0"),
      10
    );

    if (isNaN(requiredCapacity) || requiredCapacity < 0) {
      res.status(400).json({
        success: false,
        error: "required must be a non-negative number",
      });
      return;
    }

    const result = await checkCapacity(req.params.id, requiredCapacity);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    handleError(res, err, "checking venue capacity");
  }
});

// --- POST / --- create venue ---

venueRouter.post("/", requireRole(10), async (req: Request, res: Response) => {
  try {
    const parsed = createVenueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.issues[0].message,
      });
      return;
    }
    const { name, type, capacity, floor, building, equipment, notes } = parsed.data;

    const auditCtx = auditContextFromRequest(req);

    const row = await withAuditContext(auditCtx, async (client) => {
      const result = await client.query(
        `INSERT INTO venues (name, type, capacity, floor, building, equipment, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          name,
          type,
          capacity ?? 0,
          floor ?? null,
          building ?? null,
          JSON.stringify(equipment ?? []),
          notes ?? null,
          req.user?.uid ?? null,
        ]
      );
      return result.rows[0];
    });

    await logAuditClaim(auditCtx, "POST /api/venues");

    const event = createDomainEvent({
      eventName: "venue.created",
      domain: "venue",
      action: "created",
      recordId: row.id as string,
      newValues: { name, type, capacity },
      triggeredBy: req.user?.email ?? "system",
      changeSet: auditCtx.changeSet,
    });
    await emit(event);

    res.status(201).json({ success: true, data: row });
  } catch (err: unknown) {
    handleError(res, err, "creating venue");
  }
});

// --- PUT /:id --- update venue ---

venueRouter.put("/:id", requireRole(10), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = updateVenueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.issues[0].message,
      });
      return;
    }
    const updates = parsed.data as Record<string, unknown>;

    const auditCtx = auditContextFromRequest(req);

    const row = await withAuditContext(auditCtx, async (client) => {
      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      const allowedFields = ["name", "type", "capacity", "floor", "building", "notes"];
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          setClauses.push(`${field} = $${paramIdx++}`);
          params.push(updates[field]);
        }
      }

      if (updates.equipment !== undefined) {
        setClauses.push(`equipment = $${paramIdx++}`);
        params.push(JSON.stringify(updates.equipment));
      }

      if (setClauses.length === 0) {
        const existing = await client.query(
          "SELECT * FROM venues WHERE id = $1 AND NOT archived",
          [id]
        );
        if (existing.rows.length === 0) {
          throw Object.assign(new Error("Venue not found"), { status: 404 });
        }
        return existing.rows[0];
      }

      setClauses.push("updated_at = now()");
      params.push(id);

      const result = await client.query(
        `UPDATE venues SET ${setClauses.join(", ")} WHERE id = $${paramIdx} AND NOT archived RETURNING *`,
        params
      );

      if (result.rows.length === 0) {
        throw Object.assign(new Error("Venue not found"), { status: 404 });
      }

      return result.rows[0];
    });

    await logAuditClaim(auditCtx, `PUT /api/venues/${id}`);

    const event = createDomainEvent({
      eventName: "venue.updated",
      domain: "venue",
      action: "updated",
      recordId: id,
      newValues: updates,
      triggeredBy: req.user?.email ?? "system",
      changeSet: auditCtx.changeSet,
    });
    await emit(event);

    res.json({ success: true, data: row });
  } catch (err: unknown) {
    handleError(res, err, "updating venue");
  }
});

// --- DELETE /:id --- archive venue ---

venueRouter.delete("/:id", requireRole(10), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const auditCtx = auditContextFromRequest(req);

    await withAuditContext(auditCtx, async (client) => {
      const result = await client.query(
        "UPDATE venues SET archived = true, updated_at = now() WHERE id = $1 AND NOT archived RETURNING id",
        [id]
      );

      if (result.rows.length === 0) {
        throw Object.assign(new Error("Venue not found"), { status: 404 });
      }
    });

    await logAuditClaim(auditCtx, `DELETE /api/venues/${id}`);

    const event = createDomainEvent({
      eventName: "venue.deleted",
      domain: "venue",
      action: "deleted",
      recordId: id,
      triggeredBy: req.user?.email ?? "system",
      changeSet: auditCtx.changeSet,
    });
    await emit(event);

    res.json({ success: true, data: null });
  } catch (err: unknown) {
    handleError(res, err, "archiving venue");
  }
});

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  logger.error(`Error ${context}`, { error: message });
  res.status(status ?? 500).json({
    success: false,
    error: `Internal error while ${context}: ${message}`,
  });
}
