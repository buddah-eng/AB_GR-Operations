/**
 * Guest Self-Service API Router
 *
 * Endpoints for managing guest form sessions:
 *   POST   /api/guest-self-service/sessions             — create form session
 *   GET    /api/guest-self-service/sessions/:guestId     — list sessions for guest
 *   GET    /api/guest-self-service/prefill/:guestId      — get form prefill data
 *   POST   /api/guest-self-service/sessions/:id/submit   — submit form
 *   POST   /api/guest-self-service/sessions/:id/invalidate — invalidate session
 *
 * Session creation and prefill require authentication (coordinator+).
 * Submission is handled here for internal use; external submission
 * goes through the external router.
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
  createFormSession,
  getFormPrefill,
  submitForm,
  getSessionsForGuest,
  invalidateSession,
} from "../services/guest-self-service";

// --- Validation schemas ---

const createSessionSchema = z.object({
  guest_id: z.string().uuid("Invalid guest ID format"),
  expires_in_hours: z.number().int().min(1).max(8760).optional(), // max 1 year
});

const submitFormSchema = z.object({
  form_data: z.record(z.string(), z.unknown()),
});

// --- Router ---

export const guestSelfServiceRouter = Router();

guestSelfServiceRouter.use(requireAuth);

// --- POST /sessions  —  create form session ---

guestSelfServiceRouter.post(
  "/sessions",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = createSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Validation failed.",
          details: parsed.error.issues,
        });
        return;
      }

      const { guest_id, expires_in_hours } = parsed.data;
      const auditCtx = auditContextFromRequest(req);

      const result = await withAuditContext(auditCtx, async (client) => {
        return createFormSession(guest_id, expires_in_hours, client);
      });

      await logAuditClaim(auditCtx, "POST /api/guest-self-service/sessions");

      const event = createDomainEvent({
        eventName: "guest_form_session.created",
        domain: "guest_form_session",
        action: "created",
        recordId: result.session.id,
        newValues: {
          guest_id,
          expires_at: result.session.expires_at,
        },
        triggeredBy: req.user?.uid ?? "anonymous",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({
        success: true,
        data: {
          sessionId: result.session.id,
          token: result.token,
          expiresAt: result.session.expires_at,
          guestId: guest_id,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Guest not found")) {
        res.status(404).json({ success: false, error: message });
        return;
      }
      handleError(res, err, "creating form session");
    }
  }
);

// --- GET /sessions/:guestId  —  list sessions for guest ---

guestSelfServiceRouter.get(
  "/sessions/:guestId",
  async (req: Request, res: Response) => {
    try {
      const sessions = await getSessionsForGuest(req.params.guestId);

      res.json({
        success: true,
        data: sessions.map((s) => ({
          id: s.id,
          guestId: s.guest_id,
          status: s.status,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
          submittedAt: s.submitted_at,
          lastSavedAt: s.last_saved_at,
        })),
        meta: { total: sessions.length },
      });
    } catch (err: unknown) {
      handleError(res, err, "listing form sessions");
    }
  }
);

// --- GET /prefill/:guestId  —  get prefill data ---

guestSelfServiceRouter.get(
  "/prefill/:guestId",
  async (req: Request, res: Response) => {
    try {
      const prefill = await getFormPrefill(req.params.guestId);

      res.json({
        success: true,
        data: prefill,
      });
    } catch (err: unknown) {
      handleError(res, err, "fetching form prefill");
    }
  }
);

// --- POST /sessions/:id/submit  —  submit form (internal) ---

guestSelfServiceRouter.post(
  "/sessions/:id/submit",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = submitFormSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Validation failed.",
          details: parsed.error.issues,
        });
        return;
      }

      const sessionId = req.params.id;
      const { form_data } = parsed.data;
      const auditCtx = auditContextFromRequest(req);

      let result;
      try {
        result = await withAuditContext(auditCtx, async (client) => {
          return submitForm(sessionId, form_data, client);
        });
      } catch (submitErr: unknown) {
        const message = submitErr instanceof Error
          ? submitErr.message
          : String(submitErr);
        if (message.includes("not found")) {
          res.status(404).json({ success: false, error: message });
          return;
        }
        if (message.includes("already been submitted")) {
          res.status(409).json({ success: false, error: message });
          return;
        }
        if (message.includes("expired")) {
          res.status(410).json({ success: false, error: message });
          return;
        }
        throw submitErr;
      }

      await logAuditClaim(
        auditCtx,
        "POST /api/guest-self-service/sessions/:id/submit"
      );

      const event = createDomainEvent({
        eventName: "guest_form.submitted",
        domain: "guest_form",
        action: "completed",
        recordId: sessionId,
        newValues: form_data,
        triggeredBy: req.user?.uid ?? "anonymous",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({ success: true, data: result });
    } catch (err: unknown) {
      handleError(res, err, "submitting form");
    }
  }
);

// --- POST /sessions/:id/invalidate  —  invalidate session ---

guestSelfServiceRouter.post(
  "/sessions/:id/invalidate",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id;
      const auditCtx = auditContextFromRequest(req);

      const invalidated = await withAuditContext(auditCtx, async (client) => {
        return invalidateSession(sessionId, client);
      });

      if (!invalidated) {
        res.status(404).json({
          success: false,
          error: "Session not found or already inactive.",
        });
        return;
      }

      await logAuditClaim(
        auditCtx,
        "POST /api/guest-self-service/sessions/:id/invalidate"
      );

      const event = createDomainEvent({
        eventName: "guest_form_session.invalidated",
        domain: "guest_form_session",
        action: "updated",
        recordId: sessionId,
        changedFields: ["status"],
        newValues: { status: "expired" },
        triggeredBy: req.user?.uid ?? "anonymous",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({
        success: true,
        data: { sessionId, status: "expired" },
      });
    } catch (err: unknown) {
      handleError(res, err, "invalidating session");
    }
  }
);

// --- Error handler ---

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Error ${context}`, { error: message });
  res.status(500).json({
    success: false,
    error: `Internal error while ${context}.`,
  });
}
