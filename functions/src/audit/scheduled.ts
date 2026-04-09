/**
 * Scheduled Audit Jobs
 *
 * Cloud Function entry points for periodic audit tasks:
 * - Rogue-actor detection (every 5 minutes)
 * - Expired confirmation token cleanup
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { detectRogueAccess } from "./rogue-detection";
import { clearExpiredConfirmations } from "../api/bulk-limit";

/**
 * Runs rogue-actor detection every 5 minutes.
 * Compares API audit claims against Postgres trigger-generated audit rows.
 * Creates admin alerts and fires events when violations are found.
 */
export const rogueDetectionJob = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "us-east1",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async () => {
    logger.info("Rogue detection scan starting");

    try {
      const result = await detectRogueAccess(10);

      logger.info("Rogue detection scan complete", {
        unclaimedTriggerRows: result.unclaimedTriggerRows.length,
        unmatchedClaims: result.unmatchedClaims.length,
        alertsCreated: result.alertsCreated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Rogue detection scan failed", { error: message });
    }
  }
);

/**
 * Cleans up expired bulk confirmation tokens every 10 minutes.
 */
export const cleanupExpiredTokensJob = onSchedule(
  {
    schedule: "every 10 minutes",
    region: "us-east1",
    memory: "128MiB",
    timeoutSeconds: 30,
  },
  async () => {
    clearExpiredConfirmations();
    logger.info("Expired confirmation tokens cleaned up");
  }
);
