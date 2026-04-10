/**
 * Template API Router
 *
 * Exposes template CRUD, versioning, application, import, and export over HTTP.
 * All endpoints require authentication. Mutations require coordinator role (priority 20).
 * Template application requires director role (priority 10).
 *
 * GET    /api/templates?type=...&concept=...&category=...
 * GET    /api/templates/export?type=...
 * GET    /api/templates/:id
 * GET    /api/templates/:id/history
 * POST   /api/templates
 * POST   /api/templates/import
 * POST   /api/templates/:id/apply
 * PUT    /api/templates/:id
 * DELETE /api/templates/:id
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { auditContextFromRequest, logAuditClaim } from "../audit/context";
import { emit, createDomainEvent } from "../events/bus";
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateHistory,
  applyTemplate,
  exportTemplates,
  importTemplates,
} from "../templates/service";
import type { TemplateExport } from "../templates/service";

// --- Router ---

export const templateRouter = Router();

templateRouter.use(requireAuth);

// --- GET /  —  list templates with optional filters ---

templateRouter.get("/", async (req: Request, res: Response) => {
  try {
    const filters = {
      type: req.query.type as string | undefined,
      concept: req.query.concept as string | undefined,
      category: req.query.category as string | undefined,
    };

    const result = await listTemplates(filters);

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("List templates failed", { error: message });
    res.status(500).json({ success: false, error: `List templates failed: ${message}` });
  }
});

// --- GET /export  —  export templates as JSON ---

templateRouter.get("/export", async (req: Request, res: Response) => {
  try {
    const filters = {
      type: req.query.type as string | undefined,
      concept: req.query.concept as string | undefined,
      category: req.query.category as string | undefined,
    };

    const result = await exportTemplates(filters);

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Export templates failed", { error: message });
    res.status(500).json({ success: false, error: `Export failed: ${message}` });
  }
});

// --- GET /:id  —  get single template ---

templateRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const result = await getTemplateById(req.params.id);

    if (!result.success || !result.data) {
      res.status(404).json({ success: false, error: "Template not found" });
      return;
    }

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get template failed", { error: message });
    res.status(500).json({ success: false, error: `Get template failed: ${message}` });
  }
});

// --- GET /:id/history  —  version history ---

templateRouter.get("/:id/history", async (req: Request, res: Response) => {
  try {
    const result = await getTemplateHistory(req.params.id);

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Get template history failed", { error: message });
    res.status(500).json({ success: false, error: `History failed: ${message}` });
  }
});

// --- POST /  —  create template (coordinator+) ---

templateRouter.post(
  "/",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { template_type, name, description, category, content, concept_key } = req.body as {
        template_type?: string;
        name?: string;
        description?: string;
        category?: string;
        content?: Record<string, unknown>;
        concept_key?: string;
      };

      if (!template_type || !name || !content) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: "template_type", "name", "content".',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const result = await createTemplate(
        {
          template_type,
          name,
          description,
          category,
          content,
          concept_key,
          changed_by: req.user?.uid ?? "anonymous",
        },
        auditCtx
      );

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      await logAuditClaim(auditCtx, "POST /api/templates");

      const event = createDomainEvent({
        eventName: "template.created",
        domain: "template",
        action: "created",
        recordId: result.data!.id,
        newValues: { template_type, name, concept_key },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Create template failed", { error: message });
      res.status(500).json({ success: false, error: `Create template failed: ${message}` });
    }
  }
);

// --- PUT /:id  —  update template (coordinator+) ---

templateRouter.put(
  "/:id",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { name, description, category, content, concept_key, changeReason } = req.body as {
        name?: string;
        description?: string;
        category?: string;
        content?: Record<string, unknown>;
        concept_key?: string;
        changeReason?: string;
      };

      if (!changeReason) {
        res.status(400).json({
          success: false,
          error: 'Missing required field "changeReason".',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);
      const changedBy = req.user?.uid ?? "anonymous";

      const result = await updateTemplate(
        req.params.id,
        { name, description, category, content, concept_key },
        changedBy,
        changeReason,
        auditCtx
      );

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      await logAuditClaim(auditCtx, `PUT /api/templates/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "template.updated",
        domain: "template",
        action: "updated",
        recordId: result.data!.id,
        newValues: { name, description, category, content, concept_key },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Update template failed", { error: message });
      res.status(500).json({ success: false, error: `Update template failed: ${message}` });
    }
  }
);

// --- DELETE /:id  —  deprecate template (coordinator+) ---

templateRouter.delete(
  "/:id",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const auditCtx = auditContextFromRequest(req);

      const result = await deleteTemplate(req.params.id, auditCtx);

      if (!result.success) {
        res.status(404).json({ success: false, error: result.error });
        return;
      }

      await logAuditClaim(auditCtx, `DELETE /api/templates/${req.params.id}`);

      const event = createDomainEvent({
        eventName: "template.deleted",
        domain: "template",
        action: "deleted",
        recordId: result.data!.id,
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Delete template failed", { error: message });
      res.status(500).json({ success: false, error: `Delete template failed: ${message}` });
    }
  }
);

// --- POST /:id/apply  —  apply template (director+) ---

templateRouter.post(
  "/:id/apply",
  requireRole(10),
  async (req: Request, res: Response) => {
    try {
      const context = (req.body.context as Record<string, unknown>) ?? {};

      const auditCtx = auditContextFromRequest(req);

      const result = await applyTemplate(req.params.id, context, auditCtx);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      await logAuditClaim(auditCtx, `POST /api/templates/${req.params.id}/apply`);

      const event = createDomainEvent({
        eventName: "template.applied",
        domain: "template",
        action: "created",
        recordId: req.params.id,
        newValues: { template_type: result.data!.template_type, detail: result.data!.detail },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Apply template failed", { error: message });
      res.status(500).json({ success: false, error: `Apply template failed: ${message}` });
    }
  }
);

// --- POST /import  —  import templates (coordinator+) ---

templateRouter.post(
  "/import",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const importData = req.body as TemplateExport;

      if (!importData.format || !importData.templates) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: "format", "templates".',
        });
        return;
      }

      const auditCtx = auditContextFromRequest(req);

      const result = await importTemplates(importData);

      if (!result.success) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      await logAuditClaim(auditCtx, "POST /api/templates/import");

      const event = createDomainEvent({
        eventName: "template.imported",
        domain: "template",
        action: "created",
        recordId: "batch-import",
        newValues: { count: result.data!.length },
        triggeredBy: req.user?.email ?? "system",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: result.data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Import templates failed", { error: message });
      res.status(500).json({ success: false, error: `Import failed: ${message}` });
    }
  }
);
