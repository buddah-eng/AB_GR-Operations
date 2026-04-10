/**
 * Data Transform Engine
 *
 * Pure-function transform chain executor. Each transform takes a record
 * and config, returning a new record (immutable). Chains execute in order.
 *
 * Supported transform types:
 *   field_rename, field_strip, pii_strip, format, compute,
 *   aggregate, static, conditional, lookup
 */

import { isPiiField } from "../encryption/crypto";
import { evaluateCondition } from "../conditions/evaluator";
import type { ConditionExpression } from "../ontology/types";

// --- Types ---

export interface TransformStep {
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface TransformResult {
  readonly record: Readonly<Record<string, unknown>>;
  readonly steps: ReadonlyArray<{
    readonly type: string;
    readonly success: boolean;
    readonly error?: string;
  }>;
}

// --- Chain executor ---

/**
 * Applies a sequence of transforms to a record. Each step receives the
 * output of the previous step. If any step fails, the chain halts
 * immediately and throws — no partial results are produced.
 */
export function executeTransformChain(
  chain: ReadonlyArray<TransformStep>,
  record: Readonly<Record<string, unknown>>
): TransformResult {
  const steps: Array<{
    readonly type: string;
    readonly success: boolean;
    readonly error?: string;
  }> = [];

  let current: Readonly<Record<string, unknown>> = record;

  for (const step of chain) {
    try {
      current = applyTransform(step, current);
      steps.push({ type: step.type, success: true });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      steps.push({ type: step.type, success: false, error });
      throw new Error(`Transform chain halted at step "${step.type}": ${error}`);
    }
  }

  return { record: current, steps };
}

// --- Individual transform functions ---

function applyTransform(
  step: TransformStep,
  record: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  switch (step.type) {
    case "field_rename":
      return applyFieldRename(record, step.config);

    case "field_strip":
      return applyFieldStrip(record, step.config);

    case "pii_strip":
      return applyPiiStrip(record);

    case "format":
      return applyFormat(record, step.config);

    case "compute":
      return applyCompute(record, step.config);

    case "aggregate":
      return applyAggregate(record, step.config);

    case "static":
      return applyStatic(record, step.config);

    case "conditional":
      return applyConditional(record, step.config);

    case "lookup":
      return applyLookup(record, step.config);

    default:
      throw new Error(`Unknown transform type: ${step.type}`);
  }
}

// --- field_rename: { mappings: { oldKey: newKey } } ---

function applyFieldRename(
  record: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const mappings = config.mappings as Readonly<Record<string, string>> | undefined;
  if (!mappings) return record;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const newKey = mappings[key] ?? key;
    result[newKey] = value;
  }
  return result;
}

// --- field_strip: { fields: string[] } ---

function applyFieldStrip(
  record: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const fields = config.fields as ReadonlyArray<string> | undefined;
  if (!fields || fields.length === 0) return record;

  const stripSet = new Set(fields);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!stripSet.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

// --- pii_strip: removes all PII fields ---

function applyPiiStrip(
  record: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!isPiiField(key)) {
      result[key] = value;
    }
  }
  return result;
}

// --- format: { field, format_type } ---

function applyFormat(
  record: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const field = config.field as string | undefined;
  const formatType = config.format_type as string | undefined;
  if (!field || !formatType) return record;

  const value = record[field];
  if (value === undefined || value === null) return record;

  const formatted = formatValue(value, formatType);
  return { ...record, [field]: formatted };
}

function formatValue(value: unknown, formatType: string): unknown {
  const strValue = String(value);

  switch (formatType) {
    case "date_iso":
      return new Date(strValue).toISOString().split("T")[0];

    case "phone_e164": {
      const digits = strValue.replace(/\D/g, "");
      if (digits.length === 10) return `+1${digits}`;
      if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
      return `+${digits}`;
    }

    case "uppercase":
      return strValue.toUpperCase();

    case "lowercase":
      return strValue.toLowerCase();

    case "trim":
      return strValue.trim();

    default:
      return value;
  }
}

// --- compute: { output_field, formula, fields } ---

function applyCompute(
  record: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const outputField = config.output_field as string | undefined;
  const formula = config.formula as string | undefined;
  const fields = config.fields as ReadonlyArray<string> | undefined;

  if (!outputField || !formula || !fields) return record;

  const values = fields.map((f) => Number(record[f]) || 0);

  let result: number;
  switch (formula) {
    case "sum":
      result = values.reduce((acc, v) => acc + v, 0);
      break;
    case "multiply":
      result = values.reduce((acc, v) => acc * v, 1);
      break;
    case "subtract":
      result = values.length > 0 ? values[0] - values.slice(1).reduce((acc, v) => acc + v, 0) : 0;
      break;
    case "average":
      result = values.length > 0 ? values.reduce((acc, v) => acc + v, 0) / values.length : 0;
      break;
    case "concat": {
      const concatValue = fields.map((f) => String(record[f] ?? "")).join("");
      return { ...record, [outputField]: concatValue };
    }
    default:
      throw new Error(`Unknown formula: ${formula}`);
  }

  return { ...record, [outputField]: result };
}

// --- aggregate: { output_field, operation, field } ---

function applyAggregate(
  record: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const outputField = config.output_field as string | undefined;
  const operation = config.operation as string | undefined;
  const field = config.field as string | undefined;

  if (!outputField || !operation || !field) return record;

  const value = record[field];

  switch (operation) {
    case "count":
      return { ...record, [outputField]: Array.isArray(value) ? value.length : (value != null ? 1 : 0) };
    case "flatten":
      return { ...record, [outputField]: Array.isArray(value) ? value.join(", ") : value };
    default:
      return record;
  }
}

// --- static: { fields: { key: value } } ---

function applyStatic(
  record: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const fields = config.fields as Readonly<Record<string, unknown>> | undefined;
  if (!fields) return record;

  return { ...record, ...fields };
}

// --- conditional: { condition: ConditionExpression, then: TransformStep[], else?: TransformStep[] } ---

function applyConditional(
  record: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const condition = config.condition as ConditionExpression | undefined;
  const thenChain = config.then as ReadonlyArray<TransformStep> | undefined;
  const elseChain = config.else as ReadonlyArray<TransformStep> | undefined;

  if (!condition || !thenChain) return record;

  const matches = evaluateCondition(condition, record);

  if (matches) {
    return executeTransformChain(thenChain, record).record;
  }

  if (elseChain) {
    return executeTransformChain(elseChain, record).record;
  }

  return record;
}

// --- lookup: { field, table: { [key]: value } } ---

function applyLookup(
  record: Readonly<Record<string, unknown>>,
  config: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  const field = config.field as string | undefined;
  const table = config.table as Readonly<Record<string, unknown>> | undefined;
  const outputField = (config.output_field as string) ?? field;

  if (!field || !table) return record;

  const key = String(record[field] ?? "");
  const lookedUp = table[key];

  if (lookedUp !== undefined) {
    return { ...record, [outputField!]: lookedUp };
  }

  return record;
}

// --- Validation ---

const VALID_TRANSFORM_TYPES = new Set([
  "field_rename",
  "field_strip",
  "pii_strip",
  "format",
  "compute",
  "aggregate",
  "static",
  "conditional",
  "lookup",
]);

/**
 * Validates a transform chain configuration.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateTransformChain(
  chain: unknown
): string | null {
  if (!Array.isArray(chain)) {
    return "Transform chain must be an array";
  }

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (!step || typeof step !== "object") {
      return `Step ${i}: must be an object`;
    }

    const { type, config } = step as { type?: string; config?: unknown };

    if (typeof type !== "string" || !VALID_TRANSFORM_TYPES.has(type)) {
      return `Step ${i}: invalid type "${type}". Valid types: ${[...VALID_TRANSFORM_TYPES].join(", ")}`;
    }

    if (config !== undefined && (typeof config !== "object" || config === null)) {
      return `Step ${i}: config must be an object`;
    }
  }

  return null;
}
