/**
 * Registry API
 *
 * Year-over-year guest registry operations: lookup, CRUD, pre-population,
 * archive, analytics, and duplicate detection.
 *
 * Auth levels:
 *   - Analytics/read: authentication only
 *   - Registry CRUD: coordinator role (requireRole(20))
 *   - Pre-populate, archive, snapshot: director role (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, withAuditContext, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  findGuestByEmail,
  findGuestByName,
  getReturningGuests,
  createRegistryEntry,
  linkGuestToRegistry,
  prePopulateConventionYear,
  archiveConventionYear,
  getReturnRateByDepartment,
  getFrequentGuests,
  getYoyGrowth,
  getNewVsReturningVendors,
  getCohortAnalysis,
  detectDuplicates,
  createAnalyticsSnapshot,
} from "../registry/service";

// --- Router ---

export const registryRouter = Router();

registryRouter.use(requireAuth);

// --- Guest lookup ---

registryRouter.get("/guests", async (req: Request, res: Response) => {
  try {
    const { email, name } = req.query;

    if (typeof email === "string" && email.length > 0) {
      const guest = await findGuestByEmail(email);
      res.json({ success: true, data: guest ? [guest] : [] });
      return;
    }

    if (typeof name === "string" && name.length > 0) {
      const guests = await findGuestByName(name);
      res.json({ success: true, data: guests });
      return;
    }

    res.status(400).json({
      success: false,
      error: 'Provide "email" or "name" query parameter for lookup.',
    });
  } catch (err: unknown) {
    handleError(res, err, "guest lookup");
  }
});

// --- Returning guests ---

registryRouter.get("/guests/returning", async (req: Request, res: Response) => {
  try {
    const lookbackYear = parseInt(String(req.query.lookbackYear ?? ""), 10);
    if (isNaN(lookbackYear)) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid "lookbackYear" query parameter.',
      });
      return;
    }

    const guests = await getReturningGuests(lookbackYear);
    res.json({ success: true, data: guests });
  } catch (err: unknown) {
    handleError(res, err, "returning guests");
  }
});

// --- Create registry entry ---

registryRouter.post(
  "/guests",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const data = req.body as Record<string, unknown>;

      if (!data.canonical_name || typeof data.canonical_name !== "string") {
        res.status(400).json({
          success: false,
          error: 'Missing required field "canonical_name".',
        });
        return;
      }

      if (!data.first_attended || typeof data.first_attended !== "number") {
        res.status(400).json({
          success: false,
          error: 'Missing or invalid "first_attended" (number).',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);
      const entryData = {
        canonical_name: data.canonical_name,
        email: typeof data.email === "string" ? data.email : undefined,
        first_attended: data.first_attended,
        last_attended: typeof data.last_attended === "number" ? data.last_attended : undefined,
        attendance_count: typeof data.attendance_count === "number" ? data.attendance_count : undefined,
        properties: typeof data.properties === "object" && data.properties !== null
          ? data.properties as Record<string, unknown>
          : undefined,
      };
      const entry = await withAuditContext(auditCtx, (client) =>
        createRegistryEntry(entryData, client)
      );

      logAuditClaim(auditCtx, "POST /api/registry/guests");

      const event = createDomainEvent({
        eventName: "registry.guest_created",
        domain: "registry",
        action: "created",
        recordId: entry.id,
        newValues: entryData,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: entry });
    } catch (err: unknown) {
      handleError(res, err, "creating registry entry");
    }
  }
);

// --- Link guest to registry ---

registryRouter.put(
  "/guests/:id/link/:guestId",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { id: registryId, guestId } = req.params;
      const auditCtx = auditContextFromRequest(req);
      await withAuditContext(auditCtx, (client) =>
        linkGuestToRegistry(guestId, registryId, client)
      );

      logAuditClaim(auditCtx, `PUT /api/registry/guests/${registryId}/link/${guestId}`);

      const event = createDomainEvent({
        eventName: "registry.guest_linked",
        domain: "registry",
        action: "updated",
        recordId: registryId,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
        metadata: { guestId },
      });
      await emit(event);

      res.json({ success: true, data: null });
    } catch (err: unknown) {
      handleError(res, err, "linking guest to registry");
    }
  }
);

// --- Pre-populate convention year ---

registryRouter.post(
  "/pre-populate",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { year, lookbackYear } = req.body as {
        year?: number;
        lookbackYear?: number;
      };

      if (typeof year !== "number" || typeof lookbackYear !== "number") {
        res.status(400).json({
          success: false,
          error: 'Missing required fields "year" and "lookbackYear" (numbers).',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);
      const count = await withAuditContext(auditCtx, (client) =>
        prePopulateConventionYear(year, lookbackYear, client)
      );

      logAuditClaim(auditCtx, "POST /api/registry/pre-populate");

      const event = createDomainEvent({
        eventName: "registry.pre_populated",
        domain: "registry",
        action: "created",
        recordId: String(year),
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
        metadata: { year, lookbackYear, draftRecordsCreated: count },
      });
      await emit(event);

      res.json({ success: true, data: { draftRecordsCreated: count } });
    } catch (err: unknown) {
      handleError(res, err, "pre-populating convention year");
    }
  }
);

// --- Archive convention year ---

registryRouter.post(
  "/archive",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { year } = req.body as { year?: number };

      if (typeof year !== "number") {
        res.status(400).json({
          success: false,
          error: 'Missing required field "year" (number).',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);
      const summary = await withAuditContext(auditCtx, (client) =>
        archiveConventionYear(year, client)
      );

      logAuditClaim(auditCtx, "POST /api/registry/archive");

      const event = createDomainEvent({
        eventName: "registry.archived",
        domain: "registry",
        action: "updated",
        recordId: String(year),
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
        metadata: { year, ...summary },
      });
      await emit(event);

      res.json({ success: true, data: summary });
    } catch (err: unknown) {
      handleError(res, err, "archiving convention year");
    }
  }
);

// --- Analytics: return rate by department ---

registryRouter.get("/analytics/return-rate", async (_req: Request, res: Response) => {
  try {
    const data = await getReturnRateByDepartment();
    res.json({ success: true, data });
  } catch (err: unknown) {
    handleError(res, err, "fetching return rate");
  }
});

// --- Analytics: frequent guests ---

registryRouter.get("/analytics/frequent", async (req: Request, res: Response) => {
  try {
    const minVisits = parseInt(String(req.query.minVisits ?? "2"), 10);
    const data = await getFrequentGuests(isNaN(minVisits) ? 2 : minVisits);
    res.json({ success: true, data });
  } catch (err: unknown) {
    handleError(res, err, "fetching frequent guests");
  }
});

// --- Analytics: YoY growth ---

registryRouter.get("/analytics/growth", async (_req: Request, res: Response) => {
  try {
    const data = await getYoyGrowth();
    res.json({ success: true, data });
  } catch (err: unknown) {
    handleError(res, err, "fetching YoY growth");
  }
});

// --- Analytics: new vs returning vendors ---

registryRouter.get("/analytics/vendors", async (req: Request, res: Response) => {
  try {
    const year = parseInt(String(req.query.year ?? ""), 10);
    if (isNaN(year)) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid "year" query parameter.',
      });
      return;
    }

    const data = await getNewVsReturningVendors(year);
    res.json({ success: true, data });
  } catch (err: unknown) {
    handleError(res, err, "fetching vendor analytics");
  }
});

// --- Analytics: cohort analysis ---

registryRouter.get("/analytics/cohort", async (_req: Request, res: Response) => {
  try {
    const data = await getCohortAnalysis();
    res.json({ success: true, data });
  } catch (err: unknown) {
    handleError(res, err, "fetching cohort analysis");
  }
});

// --- Analytics: create snapshot ---

registryRouter.post(
  "/analytics/snapshot",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const { conventionYear } = req.body as { conventionYear?: number };

      if (typeof conventionYear !== "number") {
        res.status(400).json({
          success: false,
          error: 'Missing required field "conventionYear" (number).',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);
      const result = await withAuditContext(auditCtx, (client) =>
        createAnalyticsSnapshot(conventionYear, client)
      );

      logAuditClaim(auditCtx, "POST /api/registry/analytics/snapshot");

      const event = createDomainEvent({
        eventName: "registry.snapshot_created",
        domain: "registry",
        action: "created",
        recordId: result.snapshotTable,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
        metadata: { conventionYear, ...result },
      });
      await emit(event);

      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "creating analytics snapshot");
    }
  }
);

// --- Duplicate detection ---

registryRouter.get("/duplicates", async (req: Request, res: Response) => {
  try {
    const name = req.query.name as string | undefined;
    const email = req.query.email as string | undefined;

    if (!name || typeof name !== "string") {
      res.status(400).json({
        success: false,
        error: 'Missing required "name" query parameter.',
      });
      return;
    }

    const duplicates = await detectDuplicates(
      name,
      typeof email === "string" ? email : undefined
    );
    res.json({ success: true, data: duplicates });
  } catch (err: unknown) {
    handleError(res, err, "detecting duplicates");
  }
});

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Registry API error: ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Error while ${context}: ${message}`,
  });
}
