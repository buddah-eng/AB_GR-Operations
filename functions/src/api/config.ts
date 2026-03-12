/**
 * Platform Config API
 *
 * GET  /api/config  — Returns the current platform config (Firestore-backed, falls back to defaults)
 * POST /api/config  — Saves the full platform config to Firestore (requires role priority <= 10)
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { requireAuth, requireRole } from "../auth/middleware";

export const configRouter = Router();

// --- Default config (seed data) ---

const DEFAULT_CONFIG: Readonly<Record<string, unknown>> = Object.freeze({
  departments: [
    { "Department Name": "Anime" },
    { "Department Name": "Gaming" },
    { "Department Name": "Music" },
    { "Department Name": "Cosplay" },
    { "Department Name": "Panels" },
    { "Department Name": "Artists" },
    { "Department Name": "Industry" },
    { "Department Name": "To Be Determined" },
  ],
  roles: [
    { "Role Name": "Main Liaison" },
    { "Role Name": "Backup Liaison" },
    { "Role Name": "Interpreter" },
    { "Role Name": "Security Escort" },
    { "Role Name": "Department Head" },
    { "Role Name": "Volunteer" },
  ],
  eventTypes: [
    { "Type Name": "Panel" },
    { "Type Name": "Autograph Session" },
    { "Type Name": "Photo Op" },
    { "Type Name": "Meal" },
    { "Type Name": "Photoshoot" },
    { "Type Name": "Interview" },
    { "Type Name": "Rehearsal" },
    { "Type Name": "Meet & Greet" },
    { "Type Name": "Other" },
  ],
  venues: [
    { "Venue Name": "Main Events Hall A" },
    { "Venue Name": "Main Events Hall B" },
    { "Venue Name": "Panel Room 1" },
    { "Venue Name": "Panel Room 2" },
    { "Venue Name": "Panel Room 3" },
    { "Venue Name": "Autograph Hall" },
    { "Venue Name": "Press Room" },
    { "Venue Name": "Green Room" },
    { "Venue Name": "Restaurant (Hotel)" },
    { "Venue Name": "Lobby Meeting Point" },
  ],
  prepTemplates: [],
  constraints: [],
  convention: {
    name: "Anime Boston 2026",
    startDate: "2026-04-03",
    endDate: "2026-04-05",
    venue: "Hynes Convention Center",
  },
});

function cloneDefaults(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>;
}

// --- Firestore document path ---

const CONFIG_COLLECTION = "platform";
const CONFIG_DOC_ID = "config";

function getConfigRef(): FirebaseFirestore.DocumentReference {
  return admin.firestore().collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID);
}

// --- In-memory cache for config (avoids Firestore read on every request) ---

let cachedConfig: Record<string, unknown> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10_000; // 10 seconds (short to minimize cross-instance staleness)

function isCacheFresh(): boolean {
  return cachedConfig !== null && Date.now() - cacheTimestamp < CACHE_TTL_MS;
}

// --- GET /api/config (requires auth) ---

configRouter.get("/", requireAuth, async (_req: Request, res: Response) => {
  try {
    if (isCacheFresh()) {
      res.json({ success: true, data: cachedConfig });
      return;
    }

    const doc = await getConfigRef().get();
    if (doc.exists) {
      const data = doc.data() as Record<string, unknown>;
      cachedConfig = data;
      cacheTimestamp = Date.now();
      res.json({ success: true, data });
    } else {
      // No saved config yet — return deep-cloned defaults
      const defaults = cloneDefaults();
      cachedConfig = defaults;
      cacheTimestamp = Date.now();
      res.json({ success: true, data: defaults });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Failed to load config from Firestore, returning defaults", { error: message });
    res.json({ success: true, data: cloneDefaults() });
  }
});

// --- POST /api/config (requires auth + director/coordinator role) ---

const ALLOWED_CONFIG_KEYS = new Set([
  "departments",
  "roles",
  "eventTypes",
  "venues",
  "prepTemplates",
  "constraints",
  "convention",
]);

const ARRAY_KEYS = ["departments", "roles", "eventTypes", "venues", "prepTemplates", "constraints"];
const MAX_ARRAY_LENGTH = 200;

configRouter.post(
  "/",
  requireAuth,
  requireRole(10), // Director (0) or Coordinator (10) only
  async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;

    if (!body || typeof body !== "object") {
      res.status(400).json({
        success: false,
        error: "Request body must be a config object.",
      });
      return;
    }

    // Strip any keys not in the allowed set
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (ALLOWED_CONFIG_KEYS.has(key)) {
        sanitized[key] = body[key];
      }
    }

    // Validate arrays: must be arrays and within size limit
    for (const key of ARRAY_KEYS) {
      if (key in sanitized) {
        if (!Array.isArray(sanitized[key])) {
          res.status(400).json({
            success: false,
            error: `"${key}" must be an array.`,
          });
          return;
        }
        if ((sanitized[key] as unknown[]).length > MAX_ARRAY_LENGTH) {
          res.status(400).json({
            success: false,
            error: `"${key}" exceeds maximum of ${MAX_ARRAY_LENGTH} items.`,
          });
          return;
        }
      }
    }

    // Validate convention is an object
    if ("convention" in sanitized && (typeof sanitized.convention !== "object" || sanitized.convention === null)) {
      res.status(400).json({
        success: false,
        error: '"convention" must be an object.',
      });
      return;
    }

    try {
      // Use a Firestore transaction to avoid race conditions on concurrent writes
      const docRef = getConfigRef();
      const merged = await admin.firestore().runTransaction(async (txn) => {
        const snap = await txn.get(docRef);
        const existing = snap.exists
          ? (snap.data() as Record<string, unknown>)
          : cloneDefaults();
        const result = { ...existing, ...sanitized };
        txn.set(docRef, result);
        return result;
      });

      // Update cache after successful transaction
      cachedConfig = merged;
      cacheTimestamp = Date.now();

      logger.info("Config saved", {
        updatedKeys: Object.keys(sanitized),
        user: req.user?.email,
      });

      res.json({ success: true, data: merged });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to save config", { error: message });
      res.status(500).json({
        success: false,
        error: "Failed to save configuration.",
      });
    }
  },
);
