/**
 * Scheduled Backup Jobs
 *
 * Cloud Function entry point for nightly database snapshots.
 * Exports each table as JSON and uploads to Cloud Storage.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { runNightlyBackup } from "./snapshot";

const BACKUP_BUCKET = process.env.BACKUP_BUCKET ?? "gr-ops-backups";

/**
 * Uploads snapshot data to Cloud Storage.
 * Path: gs://{bucket}/nightly/{tableName}_{YYYY-MM-DD}.json
 */
async function uploadToCloudStorage(
  tableName: string,
  date: string,
  data: string
): Promise<void> {
  const bucket = admin.storage().bucket(BACKUP_BUCKET);
  const fileName = `nightly/${tableName}_${date}.json`;
  const file = bucket.file(fileName);

  await file.save(data, {
    contentType: "application/json",
    metadata: {
      table: tableName,
      date,
      rowCount: String(JSON.parse(data)?.length ?? 0),
    },
  });

  logger.info(`Snapshot uploaded: ${fileName}`, { tableName, date });
}

/**
 * Runs nightly at 03:00 UTC.
 * Exports each table as JSON and uploads to Cloud Storage.
 * Continues on single-table failure.
 */
export const nightlyBackupJob = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "UTC",
    region: "us-east1",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    logger.info("Nightly backup starting");

    try {
      const summary = await runNightlyBackup(uploadToCloudStorage);

      logger.info("Nightly backup complete", {
        tablesBackedUp: summary.tablesBackedUp,
        totalRows: summary.totalRows,
        errors: summary.errors,
        durationMs: summary.duration,
      });

      if (summary.errors.length > 0) {
        logger.error(`Nightly backup completed with ${summary.errors.length} error(s)`, {
          failedTables: summary.errors.map((e) => e.table),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Nightly backup failed", { error: message });
    }
  }
);
