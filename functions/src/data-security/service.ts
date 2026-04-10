/**
 * Data Security Service
 *
 * Provides data access logging, anomalous access detection,
 * field classification, retention policy lookups, and record anonymization.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { isPiiField } from "../encryption/crypto";

// --- Types ---

export interface DataAccessEntry {
  readonly id: string;
  readonly actor_id: string;
  readonly actor_type: string;
  readonly concept_key: string;
  readonly record_id: string;
  readonly fields_accessed: ReadonlyArray<string>;
  readonly classification: string;
  readonly created_at: string;
}

export type FieldClassification = "pii" | "sensitive" | "internal" | "public";

export interface AnomalousAccessResult {
  readonly actor_id: string;
  readonly actor_type: string;
  readonly access_count: number;
  readonly avg_count: number;
  readonly stddev: number;
}

export interface RetentionPolicy {
  readonly concept_key: string;
  readonly retention_days: number;
  readonly policy: string;
}

// --- Predefined sensitive fields (non-PII but still guarded) ---

const SENSITIVE_FIELDS = new Set([
  "salary", "compensation", "performance_rating",
  "disciplinary_notes", "background_check",
  "bank_account", "routing_number", "ssn",
]);

// --- Default retention policies per concept type ---

const DEFAULT_RETENTION: Readonly<Record<string, RetentionPolicy>> = {
  guest: {
    concept_key: "guest",
    retention_days: 365,
    policy: "Retain for 1 year after event completion, then anonymize PII.",
  },
  staff: {
    concept_key: "staff",
    retention_days: 730,
    policy: "Retain for 2 years after last assignment, then anonymize PII.",
  },
  driver: {
    concept_key: "driver",
    retention_days: 365,
    policy: "Retain for 1 year after last assignment, then anonymize PII.",
  },
  schedule: {
    concept_key: "schedule",
    retention_days: 1825,
    policy: "Retain for 5 years for operational analysis.",
  },
};

const DEFAULT_FALLBACK_POLICY: RetentionPolicy = {
  concept_key: "default",
  retention_days: 730,
  policy: "Default: retain for 2 years, then review for anonymization.",
};

// --- Data access logging ---

export async function logDataAccess(
  actorId: string,
  actorType: string,
  conceptKey: string,
  recordId: string,
  fieldsAccessed: ReadonlyArray<string>,
  classification: string
): Promise<DataAccessEntry> {
  const result = await query(
    `INSERT INTO data_access_log (actor_id, actor_type, concept_key, record_id, fields_accessed, classification)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [actorId, actorType, conceptKey, recordId, fieldsAccessed, classification]
  );

  return result.rows[0] as unknown as DataAccessEntry;
}

// --- Anomalous access detection ---

/**
 * Finds actors with unusually high access counts in the given window.
 * "Anomalous" is defined as access counts exceeding 2 standard deviations
 * above the mean for all actors in the same time window.
 */
export async function detectAnomalousAccess(
  hours: number = 24
): Promise<ReadonlyArray<AnomalousAccessResult>> {
  try {
    const result = await query(
      `WITH actor_counts AS (
         SELECT actor_id, actor_type, COUNT(*)::int AS access_count
         FROM data_access_log
         WHERE created_at > now() - make_interval(hours => $1)
         GROUP BY actor_id, actor_type
       ),
       stats AS (
         SELECT
           AVG(access_count)::float AS avg_count,
           COALESCE(STDDEV(access_count), 0)::float AS stddev
         FROM actor_counts
       )
       SELECT ac.actor_id, ac.actor_type, ac.access_count,
              s.avg_count, s.stddev
       FROM actor_counts ac, stats s
       WHERE ac.access_count > s.avg_count + 2 * GREATEST(s.stddev, 1)
       ORDER BY ac.access_count DESC`,
      [hours]
    );

    return result.rows as unknown as ReadonlyArray<AnomalousAccessResult>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Anomalous access detection failed", { error: message });
    return [];
  }
}

// --- Field classification ---

/**
 * Returns the data classification for a field based on its key.
 * Uses the PII field set from crypto module and a local sensitive set.
 */
export function getFieldClassification(
  _conceptKey: string,
  fieldKey: string
): FieldClassification {
  if (isPiiField(fieldKey)) return "pii";
  if (SENSITIVE_FIELDS.has(fieldKey)) return "sensitive";

  // Fields that are clearly internal
  const internalPatterns = ["_id", "created_at", "updated_at", "change_set", "actor_id"];
  if (internalPatterns.some((p) => fieldKey.includes(p))) return "internal";

  return "public";
}

// --- Retention policy ---

export function getRetentionPolicy(conceptKey: string): RetentionPolicy {
  return DEFAULT_RETENTION[conceptKey] ?? {
    ...DEFAULT_FALLBACK_POLICY,
    concept_key: conceptKey,
  };
}

// --- Record anonymization ---

/**
 * Replaces PII fields with "[REDACTED]" in a domain record.
 * Returns the count of fields anonymized.
 */
export async function anonymizeRecord(
  conceptKey: string,
  recordId: string
): Promise<{ readonly fields_anonymized: ReadonlyArray<string> }> {
  try {
    // Load ontology properties for this concept to find PII fields
    const propResult = await query(
      `SELECT key FROM ontology_properties
       WHERE concept_key = $1 AND status = 'active'`,
      [conceptKey]
    );

    const piiFields: string[] = [];
    for (const row of propResult.rows) {
      const r = row as Record<string, unknown>;
      const fieldKey = r.key as string;
      if (isPiiField(fieldKey) || SENSITIVE_FIELDS.has(fieldKey)) {
        piiFields.push(fieldKey);
      }
    }

    if (piiFields.length === 0) {
      return { fields_anonymized: [] };
    }

    // Build dynamic UPDATE that sets each PII column to '[REDACTED]'
    // We use the concept_key as table name (domain tables follow this convention)
    const tableName = `domain_${conceptKey}`;
    const setClauses = piiFields.map((field, i) => `${field} = $${i + 2}`);
    const values = piiFields.map(() => "[REDACTED]");

    await query(
      `UPDATE ${tableName} SET ${setClauses.join(", ")} WHERE id = $1`,
      [recordId, ...values]
    );

    logger.info("Record anonymized", { conceptKey, recordId, fieldsAnonymized: piiFields });

    return { fields_anonymized: piiFields };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Record anonymization failed", { error: message, conceptKey, recordId });
    throw new Error(`Anonymization failed: ${message}`);
  }
}

// --- Access log query ---

export async function getAccessLog(
  actorId?: string,
  hours: number = 24
): Promise<ReadonlyArray<DataAccessEntry>> {
  if (actorId) {
    const result = await query(
      `SELECT * FROM data_access_log
       WHERE actor_id = $1 AND created_at > now() - make_interval(hours => $2)
       ORDER BY created_at DESC
       LIMIT 500`,
      [actorId, hours]
    );
    return result.rows as unknown as ReadonlyArray<DataAccessEntry>;
  }

  const result = await query(
    `SELECT * FROM data_access_log
     WHERE created_at > now() - make_interval(hours => $1)
     ORDER BY created_at DESC
     LIMIT 500`,
    [hours]
  );
  return result.rows as unknown as ReadonlyArray<DataAccessEntry>;
}
