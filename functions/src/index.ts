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
import { adminAuditRouter } from "./api/admin-audit";
import { versioningRouter } from "./api/versioning";
import { registryRouter } from "./api/registry";
import { externalRouter } from "./api/external";
import { mcpRouter } from "./api/mcp";
import { ontologyBuilderRouter } from "./api/ontology-builder";
import { configBuilderRouter } from "./api/config-builder";
import { ciQaRouter } from "./api/ci-qa";
import { templateRouter } from "./api/templates";
import { registerWebhookDelivery } from "./api/webhooks";
import { workflowRouter } from "./api/workflows";
import { documentsRouter } from "./api/documents";
import { dataQualityRouter } from "./api/data-quality";
import { dataLineageRouter } from "./api/data-lineage";
import { dataSecurityRouter } from "./api/data-security";
import { registerWorkflowEngine } from "./workflows/engine";
import { registerQualityChecker } from "./data-quality/service";
import { dataRoutesRouter } from "./api/data-routes";
import { registerDataRouting } from "./data-routing/service";
import { notificationRouter } from "./api/notifications";
import { registerNotificationHandler } from "./notifications/service";
import { createSSEHandler, registerRealtimeHandler } from "./real-time/service";
import { rateLimiter } from "./api/rate-limiter";
import { pipelinesRouter } from "./api/pipelines";
import { externalConnectionsRouter } from "./api/external-connections";
import { observabilityRouter } from "./api/observability";
import { registerPipelineEngine } from "./pipelines/service";
import { searchRouter } from "./api/search";
import { staffRouter } from "./api/staff";
import { volunteerRouter } from "./api/volunteers";
import { schedulingRouter } from "./api/scheduling";
import { venueRouter } from "./api/venues";
import { equipmentRouter } from "./api/equipment";
import { calendarSyncRouter } from "./api/calendar-sync";
import { guidebookSyncRouter } from "./api/guidebook-sync";
import { visualizationRouter } from "./api/visualization";

// --- Initialize Firebase Admin (skip on Vercel / non-Firebase environments) ---

if (!process.env.VERCEL && !process.env.SKIP_FIREBASE_INIT) {
  admin.initializeApp();
}

// --- Express App ---

const app = express();

// CORS: allow all origins in dev/Vercel, restrict in production Firebase
const isDevOrVercel = !!process.env.VERCEL || !!process.env.FUNCTIONS_EMULATOR;
app.use(
  cors({
    origin: isDevOrVercel
      ? true  // Allow all origins in dev/Vercel
      : [
          new RegExp(`^https://${process.env.GCLOUD_PROJECT}\\.web\\.app$`),
          new RegExp(`^https://${process.env.GCLOUD_PROJECT}\\.firebaseapp\\.com$`),
          /^http:\/\/localhost:\d+$/,
          /^http:\/\/127\.0\.0\.1:\d+$/,
        ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-MCP-Delegation",
      "X-Guest-Token",
      "X-Driver-Token",
      "X-Dev-Email", "X-Dev-Role", "X-Dev-Actor-Type",
    ],
    credentials: true,
    maxAge: 3600,
  })
);

// Parse JSON request bodies (limit to 1MB to prevent abuse)
app.use(express.json({ limit: "1mb" }));

// Auth middleware — runs on all routes, attaches user if token is valid
app.use(authMiddleware);

// Role resolution — runs on all routes, attaches role if user is authenticated
app.use(resolveRole);

// Rate limiter — runs after auth resolution, before route handlers
app.use("/api/domains", rateLimiter());
app.use("/api/action", rateLimiter());

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
app.use("/api/admin", adminAuditRouter);
app.use("/api/ontology", versioningRouter);
app.use("/api/registry", registryRouter);
app.use("/api/external", externalRouter);
app.use("/api/mcp", mcpRouter);
app.use("/api/builder", ontologyBuilderRouter);
app.use("/api/form-configs", configBuilderRouter.formRouter);
app.use("/api/view-configs", configBuilderRouter.viewRouter);
app.use("/api/config-changes", ciQaRouter);
app.use("/api/templates", templateRouter);
app.use("/api/workflows", workflowRouter);
app.use("/api", documentsRouter);
app.use("/api/quality", dataQualityRouter);
app.use("/api/lineage", dataLineageRouter);
app.use("/api/security", dataSecurityRouter);
app.use("/api/data-routes", dataRoutesRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/pipelines", pipelinesRouter);
app.use("/api/external-connections", externalConnectionsRouter);
app.use("/api/observability", observabilityRouter);
app.get("/api/stream", createSSEHandler());
app.use("/api/search", searchRouter);
app.use("/api/staff", staffRouter);
app.use("/api/volunteers", volunteerRouter);
app.use("/api/scheduling", schedulingRouter);
app.use("/api/venues", venueRouter);
app.use("/api/equipment", equipmentRouter);
app.use("/api/calendar-sync", calendarSyncRouter);
app.use("/api/guidebook-sync", guidebookSyncRouter);
app.use("/api/visualization", visualizationRouter);
app.use("/api/ontology/visualization", visualizationRouter);

// --- Webhook delivery & workflow engine ---

registerWebhookDelivery();
registerWorkflowEngine();
registerQualityChecker();
registerDataRouting();
registerNotificationHandler();
registerRealtimeHandler();
registerPipelineEngine();

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

// --- Export raw Express app (for Vercel / non-Firebase deployments) ---

export { app };

// --- Export Cloud Functions (Firebase deployment) ---

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
