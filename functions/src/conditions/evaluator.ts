/**
 * ConditionExpression Evaluator
 *
 * Pure function that resolves any ConditionExpression against a flat
 * key-value context to produce a boolean. Used by ontology constraints,
 * form visibility, workflows, contract clauses, and RBAC scoping.
 *
 * Four node types: field, and, or, not.
 * Ten field operators: eq, neq, gt, gte, lt, lte, contains, not_contains, is_empty, is_not_empty.
 */

import type { ConditionExpression, FieldCondition } from "../ontology/types";

/**
 * Evaluates a ConditionExpression against a flat context object.
 * Pure function — no side effects, no external dependencies.
 */
export function evaluateCondition(
  expression: ConditionExpression,
  context: Readonly<Record<string, unknown>>
): boolean {
  switch (expression.type) {
    case "field":
      return evaluateField(expression, context);

    case "and":
      // Short-circuit on first false. Empty array = vacuous truth.
      for (const child of expression.conditions) {
        if (!evaluateCondition(child, context)) return false;
      }
      return true;

    case "or":
      // Short-circuit on first true. Empty array = false.
      for (const child of expression.conditions) {
        if (evaluateCondition(child, context)) return true;
      }
      return false;

    case "not":
      return !evaluateCondition(expression.condition, context);

    default:
      return false;
  }
}

/**
 * Resolves a dot-path field reference against a context object.
 * "address.city" resolves by walking nested objects.
 */
function resolveField(
  context: Readonly<Record<string, unknown>>,
  field: string
): unknown {
  if (!field.includes(".")) {
    return context[field];
  }

  const segments = field.split(".");
  let current: unknown = context;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function evaluateField(
  expr: FieldCondition,
  context: Readonly<Record<string, unknown>>
): boolean {
  const resolved = resolveField(context, expr.field);

  switch (expr.operator) {
    case "eq":
      return looseEquals(resolved, expr.value);

    case "neq":
      return !looseEquals(resolved, expr.value);

    case "gt":
      return numericCompare(resolved, expr.value, (a, b) => a > b);

    case "gte":
      return numericCompare(resolved, expr.value, (a, b) => a >= b);

    case "lt":
      return numericCompare(resolved, expr.value, (a, b) => a < b);

    case "lte":
      return numericCompare(resolved, expr.value, (a, b) => a <= b);

    case "contains":
      return evaluateContains(resolved, expr.value);

    case "not_contains":
      return !evaluateContains(resolved, expr.value);

    case "is_empty":
      return isEmpty(resolved);

    case "is_not_empty":
      return !isEmpty(resolved);

    default:
      return false;
  }
}

/**
 * Loose equality matching: "3" == 3 is true.
 * null == undefined is true. Otherwise strict equality.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // eslint-disable-next-line eqeqeq
  return a == b;
}

/**
 * ISO 8601 date string pattern (YYYY-MM-DD with optional time component).
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Numeric comparison with NaN safety.
 * Both sides coerced via Number(). If either is NaN, returns false.
 *
 * When both values are ISO 8601 date strings, comparison is lexicographic
 * (which produces correct chronological ordering for ISO dates).
 */
function numericCompare(
  resolved: unknown,
  value: unknown,
  compareFn: (a: number, b: number) => boolean
): boolean {
  // ISO 8601 date string comparison (lexicographic)
  if (
    typeof resolved === "string" &&
    typeof value === "string" &&
    ISO_DATE_RE.test(resolved) &&
    ISO_DATE_RE.test(value)
  ) {
    const aStr = resolved;
    const bStr = value;
    // Map string comparison to numeric: use localeCompare result with the numeric compareFn
    const cmp = aStr.localeCompare(bStr);
    return compareFn(cmp, 0);
  }

  const a = Number(resolved);
  const b = Number(value);
  if (isNaN(a) || isNaN(b)) return false;
  return compareFn(a, b);
}

/**
 * String includes substring, or array includes element.
 */
function evaluateContains(resolved: unknown, value: unknown): boolean {
  if (typeof resolved === "string") {
    return resolved.includes(String(value));
  }
  if (Array.isArray(resolved)) {
    return resolved.includes(value);
  }
  return false;
}

/**
 * A value is "empty" if it's undefined, null, "", or an empty array.
 */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Validates that a ConditionExpression is structurally valid.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateCondition(
  expr: unknown,
  path = "root"
): string | null {
  if (!expr || typeof expr !== "object") {
    return `${path}: must be an object`;
  }

  const obj = expr as Record<string, unknown>;
  const type = obj.type;

  switch (type) {
    case "field": {
      if (typeof obj.field !== "string" || obj.field.length === 0) {
        return `${path}.field: must be a non-empty string`;
      }
      const validOps = new Set([
        "eq", "neq", "gt", "gte", "lt", "lte",
        "contains", "not_contains", "is_empty", "is_not_empty",
      ]);
      if (!validOps.has(obj.operator as string)) {
        return `${path}.operator: must be one of ${[...validOps].join(", ")}`;
      }
      const needsValue = !["is_empty", "is_not_empty"].includes(obj.operator as string);
      if (needsValue && obj.value === undefined) {
        return `${path}.value: required for operator "${obj.operator}"`;
      }
      return null;
    }

    case "and":
    case "or": {
      if (!Array.isArray(obj.conditions)) {
        return `${path}.conditions: must be an array`;
      }
      for (let i = 0; i < obj.conditions.length; i++) {
        const childError = validateCondition(obj.conditions[i], `${path}.conditions[${i}]`);
        if (childError) return childError;
      }
      return null;
    }

    case "not": {
      if (Array.isArray(obj.condition)) {
        return `${path}.condition: must be a single expression, not an array`;
      }
      return validateCondition(obj.condition, `${path}.condition`);
    }

    default:
      return `${path}.type: must be one of field, and, or, not (got "${type}")`;
  }
}
