/**
 * Vercel Serverless Function — Real Express Backend
 *
 * Imports the actual Express app from functions/src/ with all routers,
 * RBAC, audit, workflows, and write pipeline. This is the production
 * backend running on Vercel instead of Firebase Cloud Functions.
 *
 * Auth: dev-bypass mode (no Firebase credentials on Vercel).
 * Database: Neon Postgres via DATABASE_URL.
 */

import { app } from '../functions/src/index'

export default app
