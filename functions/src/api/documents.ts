/**
 * Document API Router
 *
 * Exposes contract rendering/creation and itinerary rendering over HTTP.
 * All endpoints require authentication. Contract creation requires
 * coordinator role (priority 20).
 *
 * GET    /api/guests/:id/contract/:templateId  -- render contract HTML
 * POST   /api/guests/:id/contract/:templateId  -- create guest contract
 * GET    /api/guests/:id/itinerary             -- render itinerary HTML
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";
import { renderContractHtml, createGuestContract } from "../documents/contracts";
import { renderItineraryHtml } from "../documents/itineraries";

// --- Router ---

export const documentsRouter = Router();

documentsRouter.use(requireAuth);

// --- GET /guests/:id/contract/:templateId  --  render contract HTML ---

documentsRouter.get(
  "/guests/:id/contract/:templateId",
  async (req: Request, res: Response) => {
    try {
      const { id, templateId } = req.params;

      const html = await renderContractHtml(id, templateId);

      res.type("html").send(html);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Render contract failed", { error: message });
      res.status(500).json({
        success: false,
        error: `Render contract failed: ${message}`,
      });
    }
  }
);

// --- POST /guests/:id/contract/:templateId  --  create guest contract (coordinator+) ---

documentsRouter.post(
  "/guests/:id/contract/:templateId",
  requireRole(20),
  async (req: Request, res: Response) => {
    try {
      const { id, templateId } = req.params;
      const createdBy = req.user?.uid ?? "anonymous";

      const contract = await createGuestContract(id, templateId, createdBy);

      res.status(201).json({ success: true, data: contract });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Create guest contract failed", { error: message });
      res.status(500).json({
        success: false,
        error: `Create contract failed: ${message}`,
      });
    }
  }
);

// --- GET /guests/:id/itinerary  --  render itinerary HTML ---

documentsRouter.get(
  "/guests/:id/itinerary",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const html = await renderItineraryHtml(id);

      res.type("html").send(html);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Render itinerary failed", { error: message });
      res.status(500).json({
        success: false,
        error: `Render itinerary failed: ${message}`,
      });
    }
  }
);
