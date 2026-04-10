/**
 * External Connections API Router
 *
 * CRUD for external service connections, manual sync triggers, and sync state.
 *
 * Auth levels:
 *   - GET endpoints: authentication only
 *   - POST/PUT/DELETE: director role (requireRole(10))
 *   - POST sync: director role (requireRole(10))
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  listConnections,
  getConnectionById,
  createConnection,
  updateConnection,
  deleteConnection,
  executeInboundSync,
  getSyncState,
} from "../pipelines/external";

// --- Router ---

export const externalConnectionsRouter = Router();

externalConnectionsRouter.use(requireAuth);

// --- GET / --- list connections ---

externalConnectionsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const active = req.query.active !== undefined
      ? req.query.active === "true"
      : undefined;

    const connections = await listConnections(active);
    res.json({ success: true, data: connections });
  } catch (err: unknown) {
    handleError(res, err, "listing external connections");
  }
});

// --- GET /:id --- get single connection ---

externalConnectionsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const connection = await getConnectionById(req.params.id);

    if (!connection) {
      res.status(404).json({ success: false, error: "External connection not found" });
      return;
    }

    res.json({ success: true, data: connection });
  } catch (err: unknown) {
    handleError(res, err, "getting external connection");
  }
});

// --- POST / --- create connection (director+) ---

externalConnectionsRouter.post(
  "/",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const {
        name,
        provider,
        endpoint_url,
        auth_method,
        auth_config,
        direction,
        concept_key,
        field_mappings,
        poll_interval_ms,
      } = req.body as {
        name?: string;
        provider?: string;
        endpoint_url?: string;
        auth_method?: string;
        auth_config?: Record<string, unknown>;
        direction?: string;
        concept_key?: string;
        field_mappings?: unknown[];
        poll_interval_ms?: number;
      };

      if (!name || !provider || !endpoint_url || !auth_method || !direction || !concept_key) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: "name", "provider", "endpoint_url", "auth_method", "direction", "concept_key".',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const connection = await createConnection({
        name,
        provider,
        endpoint_url,
        auth_method: auth_method as "api_key" | "oauth2" | "service_account" | "basic" | "bearer" | "webhook_secret",
        auth_config: auth_config ?? {},
        direction: direction as "inbound" | "outbound" | "bidirectional",
        concept_key,
        field_mappings: (field_mappings ?? []) as [],
        poll_interval_ms: poll_interval_ms ?? null,
        active: true,
      });

      await logAuditClaim(auditCtx, "POST /api/external-connections");

      const event = createDomainEvent({
        eventName: "external_connection.created",
        domain: "external_connection",
        action: "created",
        recordId: connection.id,
        newValues: { name, provider, direction },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: connection });
    } catch (err: unknown) {
      handleError(res, err, "creating external connection");
    }
  }
);

// --- PUT /:id --- update connection (director+) ---

externalConnectionsRouter.put(
  "/:id",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const connection = await updateConnection(req.params.id, req.body);

      if (!connection) {
        res.status(404).json({ success: false, error: "External connection not found" });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/external-connections/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "external_connection.updated",
        domain: "external_connection",
        action: "updated",
        recordId: connection.id,
        newValues: req.body,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: connection });
    } catch (err: unknown) {
      handleError(res, err, "updating external connection");
    }
  }
);

// --- DELETE /:id --- delete connection (director+) ---

externalConnectionsRouter.delete(
  "/:id",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const deleted = await deleteConnection(req.params.id);

      if (!deleted) {
        res.status(404).json({ success: false, error: "External connection not found" });
        return;
      }

      await logAuditClaim(auditCtx, `DELETE /api/external-connections/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "external_connection.deleted",
        domain: "external_connection",
        action: "deleted",
        recordId: req.params.id,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: { id: req.params.id, deleted: true } });
    } catch (err: unknown) {
      handleError(res, err, "deleting external connection");
    }
  }
);

// --- POST /:id/sync --- trigger manual sync (director+) ---

externalConnectionsRouter.post(
  "/:id/sync",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const result = await executeInboundSync(req.params.id);

      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "executing sync");
    }
  }
);

// --- GET /:id/sync-state --- get sync state ---

externalConnectionsRouter.get("/:id/sync-state", async (req: Request, res: Response) => {
  try {
    const state = await getSyncState(req.params.id);

    if (!state) {
      res.json({ success: true, data: { status: "never_synced" } });
      return;
    }

    res.json({ success: true, data: state });
  } catch (err: unknown) {
    handleError(res, err, "getting sync state");
  }
});

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`External Connections API error: ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Error while ${context}: ${message}`,
  });
}
