/**
 * Search API Router
 *
 * Thin wrapper around the search service with requireAuth middleware.
 *
 * Auth levels:
 *   - All endpoints: authentication required
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../auth/middleware";
import { search } from "../search/service";

// --- Router ---

export const searchRouter = Router();

searchRouter.use(requireAuth);

// --- GET / --- search across concepts ---

searchRouter.get("/", async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) ?? "";
    const concepts = req.query.concepts
      ? (req.query.concepts as string).split(",").map((c) => c.trim())
      : undefined;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : undefined;
    const roleKey = req.role?.roleKey ?? "viewer";

    const result = await search(q, roleKey, concepts, undefined, undefined, limit);

    if (!result.success) {
      res.status(500).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: `Search failed: ${message}` });
  }
});
