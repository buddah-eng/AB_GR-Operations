/**
 * Contract API Router
 *
 * Endpoints for contract management, leveraging the existing documents service:
 *   GET    /api/contracts/guest/:guestId             — list contracts for guest
 *   GET    /api/contracts/:id                         — get single contract
 *   POST   /api/contracts/generate                    — generate contract
 *   PUT    /api/contracts/:id/status                  — update contract status
 *   GET    /api/contracts/render/:guestId/:templateId — render contract HTML preview
 *
 * All endpoints require authentication. Mutations require coordinator+ (priority 20).
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
  renderContractHtml,
  createGuestContract,
} from "../documents/contracts";
import { query } from "../db/client";

// --- Validation schemas ---

const generateContractSchema = z.object({
  guest_id: z.string().uuid("Invalid guest ID format"),
  template_id: z.string().uuid("Invalid template ID format"),
});

const updateStatusSchema = z.object({
  status: z.enum(["draft", "sent", "signed", "countersigned", "expired"]),
});

// --- Status transition map ---

const CONTRACT_TRANSITIONS: Record<string, string[]> = {
  draft: ["sent"],
  sent: ["signed", "expired"],
  signed: ["countersigned"],
  // No transitions from expired or countersigned (terminal states)
};

// --- Router ---

export const contractsRouter = Router();

contractsRouter.use(requireAuth);

// --- GET /guest/:guestId  —  list contracts for guest ---

contractsRouter.get(
  "/guest/:guestId",
  async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT id, guest_id, template_id, status, created_by, created_at
         FROM guest_contracts
         WHERE guest_id = $1
         ORDER BY created_at DESC`,
        [req.params.guestId]
      );

      res.json({
        success: true,
        data: result.rows,
        meta: { total: result.rows.length },
      });
    } catch (err: unknown) {
      handleError(res, err, "listing contracts");
    }
  }
);

// --- GET /:id  —  get single contract ---

contractsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const result = await query(
      "SELECT * FROM guest_contracts WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: "Contract not found.",
      });
      return;
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err: unknown) {
    handleError(res, err, "fetching contract");
  }
});

// --- POST /generate  —  generate contract ---

contractsRouter.post(
  "/generate",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = generateContractSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Validation failed.",
          details: parsed.error.issues,
        });
        return;
      }

      const { guest_id, template_id } = parsed.data;
      const createdBy = req.user?.uid ?? "anonymous";
      const auditCtx = auditContextFromRequest(req);

      const contract = await withAuditContext(auditCtx, async () => {
        return createGuestContract(guest_id, template_id, createdBy);
      });

      await logAuditClaim(auditCtx, "POST /api/contracts/generate");

      const event = createDomainEvent({
        eventName: "contract.generated",
        domain: "guest_contract",
        action: "created",
        recordId: contract.id,
        newValues: {
          guest_id: contract.guest_id,
          template_id: contract.template_id,
          status: contract.status,
        },
        triggeredBy: createdBy,
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.status(201).json({ success: true, data: contract });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        res.status(404).json({ success: false, error: message });
        return;
      }
      handleError(res, err, "generating contract");
    }
  }
);

// --- PUT /:id/status  —  update contract status ---

contractsRouter.put(
  "/:id/status",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const parsed = updateStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: "Validation failed.",
          details: parsed.error.issues,
        });
        return;
      }

      const contractId = req.params.id;
      const { status: newStatus } = parsed.data;
      const auditCtx = auditContextFromRequest(req);

      // Fetch current contract
      const currentResult = await query(
        "SELECT id, status, guest_id FROM guest_contracts WHERE id = $1",
        [contractId]
      );

      if (currentResult.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: "Contract not found.",
        });
        return;
      }

      const previousStatus = currentResult.rows[0].status as string;

      // Validate status transition
      const allowedNextStatuses = CONTRACT_TRANSITIONS[previousStatus] ?? [];
      if (!allowedNextStatuses.includes(newStatus)) {
        res.status(400).json({
          success: false,
          error: `Invalid status transition: "${previousStatus}" -> "${newStatus}".`,
          currentStatus: previousStatus,
          validTransitions: allowedNextStatuses,
        });
        return;
      }

      await withAuditContext(auditCtx, async (client) => {
        const updateFields = newStatus === "signed"
          ? "status = $1, signed_at = now()"
          : "status = $1";

        await client.query(
          `UPDATE guest_contracts SET ${updateFields} WHERE id = $2`,
          [newStatus, contractId]
        );
      });

      await logAuditClaim(auditCtx, "PUT /api/contracts/:id/status");

      const event = createDomainEvent({
        eventName: `contract.${newStatus}`,
        domain: "guest_contract",
        action: "updated",
        recordId: contractId,
        changedFields: ["status"],
        previousValues: { status: previousStatus },
        newValues: { status: newStatus },
        triggeredBy: req.user?.uid ?? "anonymous",
        changeSet: auditCtx.changeSet,
      });
      await emit(event);

      res.json({
        success: true,
        data: {
          id: contractId,
          previousStatus,
          currentStatus: newStatus,
        },
      });
    } catch (err: unknown) {
      handleError(res, err, "updating contract status");
    }
  }
);

// --- GET /render/:guestId/:templateId  —  preview contract HTML ---

contractsRouter.get(
  "/render/:guestId/:templateId",
  async (req: Request, res: Response) => {
    try {
      const { guestId, templateId } = req.params;
      const html = await renderContractHtml(guestId, templateId);
      res.type("html").send(html);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        res.status(404).json({ success: false, error: message });
        return;
      }
      handleError(res, err, "rendering contract");
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
