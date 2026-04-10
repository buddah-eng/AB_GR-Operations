import { describe, it, expect } from "vitest";
import { evaluateCondition, validateCondition } from "./evaluator";
import type { ConditionExpression } from "../ontology/types";

// --- Helpers ---

function field(
  fieldName: string,
  operator: string,
  value?: unknown
): ConditionExpression {
  return { type: "field", field: fieldName, operator, value } as ConditionExpression;
}

function and(...conditions: ConditionExpression[]): ConditionExpression {
  return { type: "and", conditions };
}

function or(...conditions: ConditionExpression[]): ConditionExpression {
  return { type: "or", conditions };
}

function not(condition: ConditionExpression): ConditionExpression {
  return { type: "not", condition };
}

describe("evaluateCondition", () => {
  // --- 6.1 Field Operators ---

  describe("field operators", () => {
    it("eq match", () => {
      expect(evaluateCondition(field("x", "eq", 5), { x: 5 })).toBe(true);
    });

    it("eq mismatch", () => {
      expect(evaluateCondition(field("x", "eq", 5), { x: 6 })).toBe(false);
    });

    it("eq coercion: string '5' equals number 5", () => {
      expect(evaluateCondition(field("x", "eq", "5"), { x: 5 })).toBe(true);
    });

    it("neq match", () => {
      expect(evaluateCondition(field("x", "neq", 5), { x: 6 })).toBe(true);
    });

    it("neq mismatch", () => {
      expect(evaluateCondition(field("x", "neq", 5), { x: 5 })).toBe(false);
    });

    it("gt true", () => {
      expect(evaluateCondition(field("x", "gt", 10), { x: 11 })).toBe(true);
    });

    it("gt false (equal)", () => {
      expect(evaluateCondition(field("x", "gt", 10), { x: 10 })).toBe(false);
    });

    it("gt NaN returns false", () => {
      expect(evaluateCondition(field("x", "gt", 10), { x: "abc" })).toBe(false);
    });

    it("gte boundary", () => {
      expect(evaluateCondition(field("x", "gte", 10), { x: 10 })).toBe(true);
    });

    it("lt true", () => {
      expect(evaluateCondition(field("x", "lt", 10), { x: 9 })).toBe(true);
    });

    it("lte boundary", () => {
      expect(evaluateCondition(field("x", "lte", 10), { x: 10 })).toBe(true);
    });

    it("contains string", () => {
      expect(evaluateCondition(field("x", "contains", "oo"), { x: "food" })).toBe(true);
    });

    it("contains array", () => {
      expect(evaluateCondition(field("x", "contains", 3), { x: [1, 2, 3] })).toBe(true);
    });

    it("contains miss", () => {
      expect(evaluateCondition(field("x", "contains", "zz"), { x: "food" })).toBe(false);
    });

    it("not_contains true", () => {
      expect(evaluateCondition(field("x", "not_contains", "zz"), { x: "food" })).toBe(true);
    });

    it("not_contains false", () => {
      expect(evaluateCondition(field("x", "not_contains", "oo"), { x: "food" })).toBe(false);
    });

    it("is_empty null", () => {
      expect(evaluateCondition(field("x", "is_empty"), { x: null })).toBe(true);
    });

    it("is_empty undefined (missing field)", () => {
      expect(evaluateCondition(field("x", "is_empty"), {})).toBe(true);
    });

    it("is_empty empty string", () => {
      expect(evaluateCondition(field("x", "is_empty"), { x: "" })).toBe(true);
    });

    it("is_empty empty array", () => {
      expect(evaluateCondition(field("x", "is_empty"), { x: [] })).toBe(true);
    });

    it("is_empty false for non-empty", () => {
      expect(evaluateCondition(field("x", "is_empty"), { x: "a" })).toBe(false);
    });

    it("is_not_empty true", () => {
      expect(evaluateCondition(field("x", "is_not_empty"), { x: "a" })).toBe(true);
    });

    it("is_not_empty false for null", () => {
      expect(evaluateCondition(field("x", "is_not_empty"), { x: null })).toBe(false);
    });
  });

  // --- 6.2 Compound Conditions ---

  describe("compound conditions", () => {
    it("and: all true", () => {
      expect(evaluateCondition(
        and(field("x", "eq", 1), field("y", "gt", 0)),
        { x: 1, y: 5 }
      )).toBe(true);
    });

    it("and: one false", () => {
      expect(evaluateCondition(
        and(field("x", "eq", 1), field("y", "eq", 999)),
        { x: 1, y: 5 }
      )).toBe(false);
    });

    it("and: empty array = vacuous truth", () => {
      expect(evaluateCondition(and(), {})).toBe(true);
    });

    it("or: one true", () => {
      expect(evaluateCondition(
        or(field("x", "eq", 999), field("y", "eq", 5)),
        { x: 1, y: 5 }
      )).toBe(true);
    });

    it("or: all false", () => {
      expect(evaluateCondition(
        or(field("x", "eq", 999), field("y", "eq", 999)),
        { x: 1, y: 5 }
      )).toBe(false);
    });

    it("or: empty array = false", () => {
      expect(evaluateCondition(or(), {})).toBe(false);
    });

    it("not: inverts true to false", () => {
      expect(evaluateCondition(not(field("x", "eq", 1)), { x: 1 })).toBe(false);
    });

    it("not: inverts false to true", () => {
      expect(evaluateCondition(not(field("x", "eq", 999)), { x: 1 })).toBe(true);
    });

    it("nested 3 deep: and(or(field, field), not(field))", () => {
      const expr = and(
        or(field("a", "eq", 1), field("b", "eq", 2)),
        not(field("c", "eq", "blocked"))
      );
      expect(evaluateCondition(expr, { a: 1, b: 0, c: "active" })).toBe(true);
      expect(evaluateCondition(expr, { a: 1, b: 0, c: "blocked" })).toBe(false);
    });

    it("nested 5 deep", () => {
      const expr = not(
        and(
          or(
            not(and(field("a", "gt", 0), field("b", "lt", 10))),
            field("c", "eq", "yes")
          ),
          field("d", "is_not_empty")
        )
      );
      // a=5 (>0), b=3 (<10) => inner and = true => not(true)=false
      // c="yes" => true
      // or(false, true) = true
      // d="x" => is_not_empty = true
      // and(true, true) = true
      // not(true) = false
      expect(evaluateCondition(expr, { a: 5, b: 3, c: "yes", d: "x" })).toBe(false);
    });
  });

  // --- 6.3 Edge Cases ---

  describe("edge cases", () => {
    it("missing field, eq: returns false", () => {
      expect(evaluateCondition(field("y", "eq", 5), { x: 1 })).toBe(false);
    });

    it("missing field, is_empty: returns true", () => {
      expect(evaluateCondition(field("y", "is_empty"), { x: 1 })).toBe(true);
    });

    it("null value, contains: returns false", () => {
      expect(evaluateCondition(field("x", "contains", "a"), { x: null })).toBe(false);
    });

    it("boolean field, eq true", () => {
      expect(evaluateCondition(field("x", "eq", true), { x: true })).toBe(true);
    });

    it("date string comparison with gt", () => {
      expect(evaluateCondition(
        field("x", "gt", "2026-04-01"),
        { x: "2026-05-01" }
      )).toBe(true); // ISO 8601 date strings compared lexicographically
    });

    it("date string comparison with lt", () => {
      expect(evaluateCondition(
        field("x", "lt", "2026-05-01"),
        { x: "2026-04-01" }
      )).toBe(true);
    });

    it("date string comparison with gte (equal dates)", () => {
      expect(evaluateCondition(
        field("x", "gte", "2026-04-01"),
        { x: "2026-04-01" }
      )).toBe(true);
    });

    it("date string comparison with lte (equal dates)", () => {
      expect(evaluateCondition(
        field("x", "lte", "2026-04-01"),
        { x: "2026-04-01" }
      )).toBe(true);
    });

    it("date string comparison gt returns false when equal", () => {
      expect(evaluateCondition(
        field("x", "gt", "2026-04-01"),
        { x: "2026-04-01" }
      )).toBe(false);
    });

    it("type mismatch, gt: NaN returns false", () => {
      expect(evaluateCondition(field("x", "gt", 5), { x: "not-a-number" })).toBe(false);
    });

    it("dot-path field resolution", () => {
      expect(evaluateCondition(
        field("address.city", "eq", "Boston"),
        { address: { city: "Boston" } }
      )).toBe(true);
    });

    it("dot-path missing segment returns undefined", () => {
      expect(evaluateCondition(
        field("address.zip", "is_empty"),
        { address: { city: "Boston" } }
      )).toBe(true);
    });
  });
});

describe("validateCondition", () => {
  it("accepts valid field condition", () => {
    expect(validateCondition({ type: "field", field: "x", operator: "eq", value: 5 })).toBeNull();
  });

  it("accepts is_empty without value", () => {
    expect(validateCondition({ type: "field", field: "x", operator: "is_empty" })).toBeNull();
  });

  it("rejects unknown type", () => {
    expect(validateCondition({ type: "xor" })).toContain("must be one of");
  });

  it("rejects unknown operator", () => {
    expect(validateCondition({ type: "field", field: "x", operator: "like" })).toContain("must be one of");
  });

  it("rejects missing value for eq", () => {
    expect(validateCondition({ type: "field", field: "x", operator: "eq" })).toContain("required");
  });

  it("rejects conditions not array for and", () => {
    expect(validateCondition({ type: "and", conditions: {} })).toContain("must be an array");
  });

  it("rejects condition as array for not", () => {
    expect(validateCondition({ type: "not", condition: [] })).toContain("must be a single expression");
  });

  it("validates nested conditions recursively", () => {
    const expr = {
      type: "and",
      conditions: [
        { type: "field", field: "x", operator: "eq", value: 1 },
        { type: "field", field: "y", operator: "invalid_op" },
      ],
    };
    expect(validateCondition(expr)).toContain("conditions[1]");
  });

  it("accepts empty and condition", () => {
    expect(validateCondition({ type: "and", conditions: [] })).toBeNull();
  });

  it("accepts deeply nested valid expression", () => {
    const expr = {
      type: "not",
      condition: {
        type: "and",
        conditions: [
          { type: "or", conditions: [{ type: "field", field: "a", operator: "eq", value: 1 }] },
          { type: "field", field: "b", operator: "is_not_empty" },
        ],
      },
    };
    expect(validateCondition(expr)).toBeNull();
  });
});

// --- 6.4 Serialization Roundtrip ---

describe("serialization roundtrip", () => {
  it("simple field condition survives JSON roundtrip", () => {
    const original = field("status", "eq", "confirmed");
    const context = { status: "confirmed" };

    const originalResult = evaluateCondition(original, context);

    const serialized = JSON.stringify(original);
    const deserialized = JSON.parse(serialized) as ConditionExpression;

    const roundtripResult = evaluateCondition(deserialized, context);

    expect(roundtripResult).toBe(originalResult);
    expect(roundtripResult).toBe(true);
  });

  it("and with 2 field conditions survives JSON roundtrip", () => {
    const original = and(
      field("age", "gte", 18),
      field("status", "neq", "banned")
    );
    const context = { age: 25, status: "active" };

    const originalResult = evaluateCondition(original, context);

    const serialized = JSON.stringify(original);
    const deserialized = JSON.parse(serialized) as ConditionExpression;

    const roundtripResult = evaluateCondition(deserialized, context);

    expect(roundtripResult).toBe(originalResult);
    expect(roundtripResult).toBe(true);
  });

  it("deeply nested not(and(or(field, field), field)) survives JSON roundtrip", () => {
    const original = not(
      and(
        or(
          field("role", "eq", "admin"),
          field("role", "eq", "superadmin")
        ),
        field("active", "eq", false)
      )
    );
    // role=admin, active=true => or=true, field(active,eq,false)=false => and=false => not=true
    const context = { role: "admin", active: true };

    const originalResult = evaluateCondition(original, context);

    const serialized = JSON.stringify(original);
    const deserialized = JSON.parse(serialized) as ConditionExpression;

    const roundtripResult = evaluateCondition(deserialized, context);

    expect(roundtripResult).toBe(originalResult);
    expect(roundtripResult).toBe(true);
  });
});
