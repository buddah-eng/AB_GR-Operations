/**
 * Builder Guardrails
 *
 * Validates a concept's property configuration and returns warnings,
 * errors, and suggestions to help builders avoid common mistakes.
 * Errors block save; warnings and suggestions are advisory.
 */

import type { Concept, Property } from "../ontology/types";

// --- Issue types ---

export type GuardrailSeverity = "error" | "warning" | "suggestion";

export interface GuardrailIssue {
  readonly severity: GuardrailSeverity;
  readonly code: string;
  readonly message: string;
  readonly propertyKey?: string;
}

export interface GuardrailResult {
  readonly issues: ReadonlyArray<GuardrailIssue>;
  readonly canSave: boolean;
}

// --- Constants ---

const MAX_RECOMMENDED_FIELDS = 20;

// --- Main entry point ---

/**
 * Checks a concept and its properties for builder guardrail issues.
 * Returns a list of issues and whether the configuration can be saved
 * (canSave is false if any error-level issue is present).
 */
export function checkGuardrails(
  _concept: Concept,
  properties: ReadonlyArray<Property>
): GuardrailResult {
  const issues: GuardrailIssue[] = [
    ...checkEmptyLabels(properties),
    ...checkDuplicateLabels(properties),
    ...checkHiddenRequired(properties),
    ...checkFieldCount(properties),
    ...checkMissingStatus(properties),
  ];

  const hasErrors = issues.some((i) => i.severity === "error");

  return {
    issues,
    canSave: !hasErrors,
  };
}

// --- Individual checks ---

function checkEmptyLabels(
  properties: ReadonlyArray<Property>
): ReadonlyArray<GuardrailIssue> {
  return properties
    .filter((p) => !p.label || p.label.trim().length === 0)
    .map((p) => ({
      severity: "warning" as const,
      code: "EMPTY_LABEL",
      message: `Property "${p.key}" has an empty label. Users will see the key name instead.`,
      propertyKey: p.key,
    }));
}

function checkDuplicateLabels(
  properties: ReadonlyArray<Property>
): ReadonlyArray<GuardrailIssue> {
  const labelCounts = new Map<string, string[]>();
  for (const p of properties) {
    if (!p.label || p.label.trim().length === 0) continue;
    const normalized = p.label.trim().toLowerCase();
    const existing = labelCounts.get(normalized) ?? [];
    labelCounts.set(normalized, [...existing, p.key]);
  }

  const issues: GuardrailIssue[] = [];
  for (const [label, keys] of labelCounts.entries()) {
    if (keys.length > 1) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_LABEL",
        message: `Label "${label}" is used by multiple properties: ${keys.join(", ")}. This may confuse operators.`,
      });
    }
  }
  return issues;
}

function checkHiddenRequired(
  properties: ReadonlyArray<Property>
): ReadonlyArray<GuardrailIssue> {
  return properties
    .filter((p) => p.hidden && p.required)
    .map((p) => ({
      severity: "error" as const,
      code: "HIDDEN_REQUIRED",
      message: `Property "${p.key}" is both hidden and required. Operators cannot fill in a field they cannot see.`,
      propertyKey: p.key,
    }));
}

function checkFieldCount(
  properties: ReadonlyArray<Property>
): ReadonlyArray<GuardrailIssue> {
  const visibleCount = properties.filter((p) => !p.hidden).length;
  if (visibleCount >= MAX_RECOMMENDED_FIELDS) {
    return [{
      severity: "warning",
      code: "TOO_MANY_FIELDS",
      message: `This concept has ${visibleCount} visible fields (recommended max: ${MAX_RECOMMENDED_FIELDS}). Consider grouping fields into sections or using a multi-step form.`,
    }];
  }
  return [];
}

function checkMissingStatus(
  properties: ReadonlyArray<Property>
): ReadonlyArray<GuardrailIssue> {
  const hasStatus = properties.some((p) => p.type === "status");
  if (!hasStatus) {
    return [{
      severity: "suggestion",
      code: "NO_STATUS_FIELD",
      message: "This concept has no status field. Adding one enables kanban views and workflow automation.",
    }];
  }
  return [];
}
