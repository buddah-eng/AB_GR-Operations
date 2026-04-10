/**
 * Itinerary API Router
 *
 * Endpoints for itinerary generation, leveraging the existing documents service:
 *   GET    /api/itineraries/guest/:guestId   — generate guest itinerary (JSON)
 *   GET    /api/itineraries/render/:guestId  — render itinerary as HTML
 *
 * All endpoints require authentication.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { requireAuth } from "../auth/middleware";
import {
  generateItinerary,
  renderItineraryHtml,
} from "../documents/itineraries";

// --- Router ---

export const itinerariesRouter = Router();

itinerariesRouter.use(requireAuth);

// --- GET /guest/:guestId  —  generate itinerary JSON ---

itinerariesRouter.get(
  "/guest/:guestId",
  async (req: Request, res: Response) => {
    try {
      const days = await generateItinerary(req.params.guestId);

      if (days.length === 0) {
        res.json({
          success: true,
          data: {
            guestId: req.params.guestId,
            days: [],
            message: "No events scheduled.",
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          guestId: req.params.guestId,
          days,
          totalEvents: days.reduce((sum, day) => sum + day.items.length, 0),
        },
      });
    } catch (err: unknown) {
      handleError(res, err, "generating itinerary");
    }
  }
);

// --- GET /render/:guestId  —  render itinerary HTML ---

itinerariesRouter.get(
  "/render/:guestId",
  async (req: Request, res: Response) => {
    try {
      const html = await renderItineraryHtml(req.params.guestId);
      res.type("html").send(html);
    } catch (err: unknown) {
      handleError(res, err, "rendering itinerary");
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
