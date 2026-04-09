/**
 * Rogue Actor Detection Service
 *
 * Detects unauthorized direct database access by comparing API audit claims
 * against Postgres trigger-generated audit rows. When mismatches are found,
 * creates admin alerts and fires events on the event bus.
 *
 * Two detection modes:
 * 1. Unclaimed trigger rows: audit rows with actor_id='pg_trigger_fallback'
 *    that have no matching api_audit_claims entry.
 * 2. Unmatched API claims: api_audit_claims entries with no corresponding
 *    audit rows (indicates disabled triggers).
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { emit, createDomainEvent } from "../events/bus";

// --- Types ---

export interface UnclaimedTriggerRow {
  readonly id: string;
  readonly table_name: string;
  readonly record_id: string;
  readonly action: string;
  readonly created_at: string;
}

export interface UnmatchedClaim {
  readonly change_set: string;
  readonly endpoint: string;
  readonly claimed_at: string;
}

export interface RogueDetectionResult {
  readonly unclaimedTriggerRows: ReadonlyArray<UnclaimedTriggerRow>;
  readonly unmatchedClaims: ReadonlyArray<UnmatchedClaim>;
  readonly alertsCreated: number;
}

// --- Known system actors ---

/**
 * Actor IDs that are expected to write directly to the database
 * (migrations, cron jobs, etc.). These are excluded from rogue detection.
 */
export const KNOWN_SYSTEM_ACTORS: ReadonlySet<string> = new Set([
  "migration",
  "pg_cron",
  "seed_script",
  "system_maintenance",
]);

// --- Detection ---

/**
 * Runs both rogue-actor detection queries and creates alerts for violations.
 *
 * @param minutesBack - How far back to scan (default 10 minutes, matching PRD)
 * @param knownActors - Override the set of known system actors to exclude
 */
export async function detectRogueAccess(
  minutesBack: number = 10,
  knownActors: ReadonlySet<string> = KNOWN_SYSTEM_ACTORS
): Promise<RogueDetectionResult> {
  const [unclaimedRows, unmatchedClaimRows] = await Promise.all([
    findUnclaimedTriggerRows(minutesBack),
    findUnmatchedApiClaims(minutesBack),
  ]);

  // Filter out known system actors from unclaimed rows
  const knownActorArray = Array.from(knownActors);
  const filteredUnclaimed = unclaimedRows.filter(
    (row) => !knownActorArray.some((actor) => row.table_name.includes(actor))
  );

  let alertsCreated = 0;

  if (filteredUnclaimed.length > 0) {
    await createAlert(
      "critical",
      "rogue_actor",
      "Unclaimed trigger rows detected — possible direct DB access",
      {
        type: "unclaimed_trigger_rows",
        count: filteredUnclaimed.length,
        rows: filteredUnclaimed,
        scannedMinutes: minutesBack,
      }
    );
    alertsCreated += 1;

    await fireRogueAlertEvent("unclaimed_trigger_rows", filteredUnclaimed.length);
  }

  if (unmatchedClaimRows.length > 0) {
    await createAlert(
      "critical",
      "rogue_actor",
      "Unmatched API claims detected — triggers may be disabled",
      {
        type: "unmatched_api_claims",
        count: unmatchedClaimRows.length,
        claims: unmatchedClaimRows,
        scannedMinutes: minutesBack,
      }
    );
    alertsCreated += 1;

    await fireRogueAlertEvent("unmatched_api_claims", unmatchedClaimRows.length);
  }

  if (alertsCreated === 0) {
    logger.info("Rogue detection scan complete — no violations found", {
      minutesBack,
    });
  }

  return {
    unclaimedTriggerRows: filteredUnclaimed,
    unmatchedClaims: unmatchedClaimRows,
    alertsCreated,
  };
}

// --- Internal queries ---

async function findUnclaimedTriggerRows(
  minutesBack: number
): Promise<ReadonlyArray<UnclaimedTriggerRow>> {
  const result = await query(
    `SELECT a.id, a.table_name, a.record_id, a.action, a.created_at
     FROM ontology_audit_log a
     LEFT JOIN api_audit_claims c ON a.change_set = c.change_set
     WHERE a.actor_id = 'pg_trigger_fallback'
       AND c.change_set IS NULL
       AND a.created_at > now() - make_interval(mins => $1)`,
    [minutesBack]
  );

  return result.rows as unknown as ReadonlyArray<UnclaimedTriggerRow>;
}

async function findUnmatchedApiClaims(
  minutesBack: number
): Promise<ReadonlyArray<UnmatchedClaim>> {
  const result = await query(
    `SELECT c.change_set, c.endpoint, c.claimed_at
     FROM api_audit_claims c
     LEFT JOIN ontology_audit_log a ON a.change_set = c.change_set
     WHERE a.change_set IS NULL
       AND c.claimed_at > now() - make_interval(mins => $1)`,
    [minutesBack]
  );

  return result.rows as unknown as ReadonlyArray<UnmatchedClaim>;
}

// --- Alert creation ---

async function createAlert(
  severity: "info" | "warning" | "critical",
  category: string,
  title: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO admin_alerts (severity, category, title, details)
       VALUES ($1, $2, $3, $4)`,
      [severity, category, title, JSON.stringify(details)]
    );
    logger.info("Admin alert created", { severity, category, title });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to create admin alert", { error: message });
  }
}

async function fireRogueAlertEvent(
  detectionType: string,
  violationCount: number
): Promise<void> {
  try {
    const event = createDomainEvent({
      eventName: "admin.alert.rogue_actor",
      domain: "admin",
      action: "created",
      recordId: "rogue-detection",
      newValues: {
        detectionType,
        violationCount,
      },
      triggeredBy: "system",
    });
    await emit(event);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to fire rogue alert event", { error: message });
  }
}
