/**
 * Data Quality Service
 *
 * Evaluates quality rules against domain records on every domain event.
 * Rules use ConditionExpression from the ontology conditions engine.
 * Violations are stored in Postgres and emitted as domain events.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { subscribe, emit, createDomainEvent } from "../events/bus";
import { evaluateCondition } from "../conditions/evaluator";
import type { ConditionExpression } from "../ontology/types";
import type { DomainEvent } from "../events/types";

// --- Types ---

export interface QualityRule {
  readonly id: string;
  readonly name: string;
  readonly concept_key: string;
  readonly rule_type: string;
  readonly condition: ConditionExpression;
  readonly severity: string;
  readonly active: boolean;
  readonly created_at: string;
}

export interface QualityViolation {
  readonly id: string;
  readonly rule_id: string;
  readonly record_id: string;
  readonly concept_key: string;
  readonly severity: string;
  readonly message: string;
  readonly resolved: boolean;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

export interface QualityScore {
  readonly total: number;
  readonly passing: number;
  readonly score_pct: number;
}

// --- Event bus registration ---

/**
 * Subscribe to domain events at priority 650 to evaluate quality rules
 * after core processing (workflows at 500, routing at 600).
 */
export function registerQualityChecker(): () => void {
  return subscribe("*.*", handleDomainEvent, 650);
}

// --- Event handler ---

export async function handleDomainEvent(event: DomainEvent): Promise<void> {
  if (event.action === "deleted") return;

  try {
    const rules = await loadRulesForConcept(event.domain);
    if (rules.length === 0) return;

    const record: Record<string, unknown> = {
      ...(event.previousValues ?? {}),
      ...(event.newValues ?? {}),
    };

    for (const rule of rules) {
      const passes = evaluateRule(rule, record);
      if (!passes) {
        await createViolation(
          rule.id,
          event.recordId,
          event.domain,
          rule.severity,
          `Quality rule "${rule.name}" failed for record ${event.recordId}`
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Quality check failed", { error: message, event: event.eventName });
  }
}

// --- Rule evaluation ---

/**
 * Evaluates a quality rule against a record.
 * Returns true if the record passes the rule (condition is satisfied).
 */
export function evaluateRule(
  rule: QualityRule,
  record: Readonly<Record<string, unknown>>
): boolean {
  return evaluateCondition(rule.condition, record);
}

// --- Violations ---

export async function createViolation(
  ruleId: string,
  recordId: string,
  conceptKey: string,
  severity: string,
  message: string
): Promise<QualityViolation> {
  const result = await query(
    `INSERT INTO quality_violations (rule_id, record_id, concept_key, severity, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [ruleId, recordId, conceptKey, severity, message]
  );

  const violation = result.rows[0] as unknown as QualityViolation;

  // Emit violation event (fire-and-forget)
  emit(
    createDomainEvent({
      eventName: `quality.violation_created`,
      domain: "quality",
      action: "created",
      recordId: violation.id,
      triggeredBy: "system",
      metadata: { ruleId, conceptKey, severity },
    })
  ).catch((err) => {
    logger.warn("Failed to emit quality violation event", { error: err });
  });

  return violation;
}

export async function getViolations(
  conceptKey?: string,
  resolved?: boolean
): Promise<ReadonlyArray<QualityViolation>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (conceptKey !== undefined) {
    conditions.push(`concept_key = $${paramIdx++}`);
    params.push(conceptKey);
  }

  if (resolved !== undefined) {
    conditions.push(`resolved = $${paramIdx++}`);
    params.push(resolved);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query(
    `SELECT * FROM quality_violations ${where} ORDER BY created_at DESC`,
    params
  );

  return result.rows as unknown as ReadonlyArray<QualityViolation>;
}

export async function resolveViolation(violationId: string): Promise<QualityViolation | null> {
  const result = await query(
    `UPDATE quality_violations
     SET resolved = true, resolved_at = now()
     WHERE id = $1
     RETURNING *`,
    [violationId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as QualityViolation;
}

export async function getQualityScore(conceptKey: string): Promise<QualityScore> {
  const result = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE resolved)::int AS passing
     FROM quality_violations
     WHERE concept_key = $1`,
    [conceptKey]
  );

  const row = result.rows[0] as Record<string, unknown>;
  const total = (row.total as number) || 0;
  const passing = (row.passing as number) || 0;
  const score_pct = total === 0 ? 100 : Math.round((passing / total) * 100);

  return { total, passing, score_pct };
}

// --- Rule CRUD ---

async function loadRulesForConcept(conceptKey: string): Promise<ReadonlyArray<QualityRule>> {
  const result = await query(
    `SELECT * FROM quality_rules WHERE concept_key = $1 AND active = true ORDER BY created_at`,
    [conceptKey]
  );
  return result.rows as unknown as ReadonlyArray<QualityRule>;
}

export async function listRules(conceptKey?: string): Promise<ReadonlyArray<QualityRule>> {
  if (conceptKey) {
    const result = await query(
      `SELECT * FROM quality_rules WHERE concept_key = $1 ORDER BY created_at`,
      [conceptKey]
    );
    return result.rows as unknown as ReadonlyArray<QualityRule>;
  }

  const result = await query(`SELECT * FROM quality_rules ORDER BY created_at`);
  return result.rows as unknown as ReadonlyArray<QualityRule>;
}

export async function createRule(params: {
  readonly name: string;
  readonly concept_key: string;
  readonly rule_type: string;
  readonly condition: ConditionExpression;
  readonly severity?: string;
}): Promise<QualityRule> {
  const result = await query(
    `INSERT INTO quality_rules (name, concept_key, rule_type, condition, severity)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      params.name,
      params.concept_key,
      params.rule_type,
      JSON.stringify(params.condition),
      params.severity ?? "warning",
    ]
  );

  return result.rows[0] as unknown as QualityRule;
}

export async function updateRule(
  ruleId: string,
  updates: {
    readonly name?: string;
    readonly condition?: ConditionExpression;
    readonly severity?: string;
    readonly active?: boolean;
  }
): Promise<QualityRule | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIdx++}`);
    params.push(updates.name);
  }
  if (updates.condition !== undefined) {
    setClauses.push(`condition = $${paramIdx++}`);
    params.push(JSON.stringify(updates.condition));
  }
  if (updates.severity !== undefined) {
    setClauses.push(`severity = $${paramIdx++}`);
    params.push(updates.severity);
  }
  if (updates.active !== undefined) {
    setClauses.push(`active = $${paramIdx++}`);
    params.push(updates.active);
  }

  if (setClauses.length === 0) return null;

  params.push(ruleId);

  const result = await query(
    `UPDATE quality_rules SET ${setClauses.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
    params
  );

  if (result.rows.length === 0) return null;
  return result.rows[0] as unknown as QualityRule;
}

export async function deleteRule(ruleId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM quality_rules WHERE id = $1`,
    [ruleId]
  );

  return (result.rowCount ?? 0) > 0;
}
