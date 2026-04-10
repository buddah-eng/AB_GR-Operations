/**
 * Tests for Data Transform Engine
 *
 * Covers:
 * - field_rename renames correctly
 * - field_strip removes fields
 * - pii_strip removes PII fields
 * - format transforms (date, phone)
 * - compute with formula (sum, concat)
 * - conditional with ConditionExpression
 * - chain executes in order
 * - unknown transform type error handling
 * - validateTransformChain validation
 * - static adds fields
 * - lookup replaces values
 * - aggregate counts
 */

import { describe, it, expect, vi } from "vitest";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../encryption/crypto", () => ({
  isPiiField: (key: string) =>
    new Set(["email", "phone", "passport_number"]).has(key),
}));

vi.mock("../conditions/evaluator", () => ({
  evaluateCondition: (expr: { type: string; field?: string; operator?: string; value?: unknown }, ctx: Record<string, unknown>) => {
    if (expr.type === "field" && expr.field && expr.operator === "eq") {
      return ctx[expr.field] === expr.value;
    }
    return false;
  },
}));

// --- Import module under test ---

import {
  executeTransformChain,
  validateTransformChain,
} from "./transforms";
import type { TransformStep } from "./transforms";

// ============================================================
// field_rename
// ============================================================

describe("field_rename", () => {
  it("renames fields according to mappings", () => {
    const chain: TransformStep[] = [
      { type: "field_rename", config: { mappings: { first_name: "given_name", last_name: "family_name" } } },
    ];
    const record = { first_name: "Alice", last_name: "Smith", age: 30 };

    const result = executeTransformChain(chain, record);

    expect(result.record).toEqual({ given_name: "Alice", family_name: "Smith", age: 30 });
    expect(result.steps[0].success).toBe(true);
  });
});

// ============================================================
// field_strip
// ============================================================

describe("field_strip", () => {
  it("removes specified fields", () => {
    const chain: TransformStep[] = [
      { type: "field_strip", config: { fields: ["internal_id", "debug_flag"] } },
    ];
    const record = { name: "Alice", internal_id: "xyz", debug_flag: true, age: 30 };

    const result = executeTransformChain(chain, record);

    expect(result.record).toEqual({ name: "Alice", age: 30 });
    expect(result.steps[0].success).toBe(true);
  });
});

// ============================================================
// pii_strip
// ============================================================

describe("pii_strip", () => {
  it("removes PII fields from record", () => {
    const chain: TransformStep[] = [
      { type: "pii_strip", config: {} },
    ];
    const record = { name: "Alice", email: "alice@example.com", phone: "555-1234", age: 30 };

    const result = executeTransformChain(chain, record);

    expect(result.record).toEqual({ name: "Alice", age: 30 });
    expect(result.record).not.toHaveProperty("email");
    expect(result.record).not.toHaveProperty("phone");
  });
});

// ============================================================
// format
// ============================================================

describe("format", () => {
  it("formats date to ISO date string", () => {
    const chain: TransformStep[] = [
      { type: "format", config: { field: "created_at", format_type: "date_iso" } },
    ];
    const record = { created_at: "2026-04-08T15:30:00Z", name: "Test" };

    const result = executeTransformChain(chain, record);

    expect(result.record.created_at).toBe("2026-04-08");
    expect(result.record.name).toBe("Test");
  });

  it("formats phone number to E.164", () => {
    const chain: TransformStep[] = [
      { type: "format", config: { field: "contact", format_type: "phone_e164" } },
    ];
    const record = { contact: "(555) 123-4567" };

    const result = executeTransformChain(chain, record);

    expect(result.record.contact).toBe("+15551234567");
  });
});

// ============================================================
// compute
// ============================================================

describe("compute", () => {
  it("computes sum of fields", () => {
    const chain: TransformStep[] = [
      { type: "compute", config: { output_field: "total", formula: "sum", fields: ["price", "tax"] } },
    ];
    const record = { price: 100, tax: 8.5, name: "Order" };

    const result = executeTransformChain(chain, record);

    expect(result.record.total).toBe(108.5);
    expect(result.record.price).toBe(100);
  });

  it("computes concat of fields", () => {
    const chain: TransformStep[] = [
      { type: "compute", config: { output_field: "full_name", formula: "concat", fields: ["first", "last"] } },
    ];
    const record = { first: "Alice", last: "Smith" };

    const result = executeTransformChain(chain, record);

    expect(result.record.full_name).toBe("AliceSmith");
  });
});

// ============================================================
// conditional
// ============================================================

describe("conditional", () => {
  it("applies then chain when condition matches", () => {
    const chain: TransformStep[] = [
      {
        type: "conditional",
        config: {
          condition: { type: "field", field: "status", operator: "eq", value: "vip" },
          then: [{ type: "static", config: { fields: { priority: "high" } } }],
          else: [{ type: "static", config: { fields: { priority: "normal" } } }],
        },
      },
    ];
    const record = { name: "Alice", status: "vip" };

    const result = executeTransformChain(chain, record);

    expect(result.record.priority).toBe("high");
  });

  it("applies else chain when condition does not match", () => {
    const chain: TransformStep[] = [
      {
        type: "conditional",
        config: {
          condition: { type: "field", field: "status", operator: "eq", value: "vip" },
          then: [{ type: "static", config: { fields: { priority: "high" } } }],
          else: [{ type: "static", config: { fields: { priority: "normal" } } }],
        },
      },
    ];
    const record = { name: "Bob", status: "regular" };

    const result = executeTransformChain(chain, record);

    expect(result.record.priority).toBe("normal");
  });
});

// ============================================================
// chain execution order
// ============================================================

describe("chain execution order", () => {
  it("executes transforms in sequence, each receiving previous output", () => {
    const chain: TransformStep[] = [
      { type: "field_rename", config: { mappings: { old_name: "name" } } },
      { type: "static", config: { fields: { added: true } } },
      { type: "field_strip", config: { fields: ["temp"] } },
    ];
    const record = { old_name: "Alice", temp: "remove_me", keep: "yes" };

    const result = executeTransformChain(chain, record);

    expect(result.record).toEqual({ name: "Alice", keep: "yes", added: true });
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((s) => s.success)).toBe(true);
  });
});

// ============================================================
// static
// ============================================================

describe("static", () => {
  it("adds static fields to record", () => {
    const chain: TransformStep[] = [
      { type: "static", config: { fields: { source: "api", version: 2 } } },
    ];
    const record = { name: "Test" };

    const result = executeTransformChain(chain, record);

    expect(result.record).toEqual({ name: "Test", source: "api", version: 2 });
  });
});

// ============================================================
// lookup
// ============================================================

describe("lookup", () => {
  it("replaces field value from lookup table", () => {
    const chain: TransformStep[] = [
      {
        type: "lookup",
        config: {
          field: "country_code",
          table: { US: "United States", GB: "United Kingdom", FR: "France" },
          output_field: "country_name",
        },
      },
    ];
    const record = { country_code: "US", name: "Test" };

    const result = executeTransformChain(chain, record);

    expect(result.record.country_name).toBe("United States");
    expect(result.record.country_code).toBe("US");
  });
});

// ============================================================
// aggregate
// ============================================================

describe("aggregate", () => {
  it("counts array elements", () => {
    const chain: TransformStep[] = [
      { type: "aggregate", config: { output_field: "tag_count", operation: "count", field: "tags" } },
    ];
    const record = { tags: ["a", "b", "c"], name: "Test" };

    const result = executeTransformChain(chain, record);

    expect(result.record.tag_count).toBe(3);
  });
});

// ============================================================
// error handling
// ============================================================

describe("error handling", () => {
  it("passes record through on unknown transform type", () => {
    const chain: TransformStep[] = [
      { type: "nonexistent" as string, config: {} },
    ];
    const record = { name: "Alice" };

    const result = executeTransformChain(chain, record);

    expect(result.record).toEqual({ name: "Alice" });
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toContain("Unknown transform type");
  });
});

// ============================================================
// validateTransformChain
// ============================================================

describe("validateTransformChain", () => {
  it("returns null for valid chain", () => {
    const chain = [
      { type: "field_rename", config: { mappings: { a: "b" } } },
      { type: "pii_strip", config: {} },
    ];

    expect(validateTransformChain(chain)).toBeNull();
  });

  it("returns error for non-array", () => {
    expect(validateTransformChain("not an array")).toBe("Transform chain must be an array");
  });

  it("returns error for invalid step type", () => {
    const chain = [{ type: "invalid_type", config: {} }];

    const error = validateTransformChain(chain);
    expect(error).toContain("invalid type");
  });

  it("returns error for missing step object", () => {
    const chain = [null];

    const error = validateTransformChain(chain);
    expect(error).toContain("must be an object");
  });
});
