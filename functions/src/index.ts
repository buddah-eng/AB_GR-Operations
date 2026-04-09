/**
 * Cloud Functions Entry Point
 *
 * Initializes Firebase Admin, configures Express with CORS and auth,
 * mounts the domain CRUD and ontology API routers, and exports a
 * single Cloud Function named `api`.
 */

import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import express from "express";
import cors from "cors";
import { authMiddleware, resolveRole } from "./auth/middleware";
import { domainRouter } from "./api/domains";
import { ontologyRouter } from "./api/ontology-routes";
import { actionRouter } from "./api/actions";
import { configRouter } from "./api/config";

// --- Initialize Firebase Admin ---

admin.initializeApp();

// --- Express App ---

const app = express();

// CORS: allow Firebase Hosting origins and localhost for development
app.use(
  cors({
    origin: [
      new RegExp(`^https://${process.env.GCLOUD_PROJECT}\\.web\\.app$`),
      new RegExp(`^https://${process.env.GCLOUD_PROJECT}\\.firebaseapp\\.com$`),
      /^http:\/\/localhost:\d+$/,                      // Local development
      /^http:\/\/127\.0\.0\.1:\d+$/,                  // Local development alt
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-MCP-Delegation",
      // Dev headers — only effective in emulator (auth middleware rejects bypass tokens in prod)
      ...(process.env.FUNCTIONS_EMULATOR ? ["X-Dev-Email", "X-Dev-Role", "X-Dev-Actor-Type"] : []),
    ],
    credentials: true,
    maxAge: 3600, // Pre-flight cache: 1 hour
  })
);

// Parse JSON request bodies (limit to 1MB to prevent abuse)
app.use(express.json({ limit: "1mb" }));

// Auth middleware — runs on all routes, attaches user if token is valid
app.use(authMiddleware);

// Role resolution — runs on all routes, attaches role if user is authenticated
app.use(resolveRole);

// --- Health check ---

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: process.env.K_REVISION ?? "local",
    },
  });
});

// --- Mount routers ---

app.use("/api/config", configRouter);

app.use("/api/action", actionRouter);
app.use("/api/domains", domainRouter);
app.use("/api/ontology", ontologyRouter);

// --- 404 handler ---

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found. See /api/ontology for available resources.",
  });
});

// --- Global error handler ---

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error("Unhandled error", { error: err.message, stack: err.stack });
    res.status(500).json({
      success: false,
      error: "An unexpected error occurred.",
    });
  }
);

// --- Export Cloud Functions ---

export const api = onRequest(
  {
    memory: "512MiB",
    timeoutSeconds: 120,
    maxInstances: 10,
    region: "us-east1",
  },
  app
);

// Scheduled jobs
export { rogueDetectionJob, cleanupExpiredTokensJob } from "./audit/scheduled";
export { nightlyBackupJob } from "./backups/scheduled";
