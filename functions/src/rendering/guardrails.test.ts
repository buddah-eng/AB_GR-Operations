import { describe, it, expect } from "vitest";
import { checkGuardrails } from "./guardrails";
import type { Concept, Property } from "../ontology/types";

// --- Helpers ---

const TEST_CONCEPT: Concept = {
  id: "c1",
  key: "guest",
  name: "Guest",
  pluralName: "Guests",
};

function makeProp(overrides: Partial<Property> & { key: string }): Property {
  return {
    id: `prop-${overrides.key}`,
    conceptKey: "guest",
    label: overrides.key,
    type: "text",
    required: false,
    sortOrder: 0,
    ...overrides,
  };
}

// --- Tests ---

describe("checkGuardrails", () => {
  it("empty label produces warning", () => {
    const properties = [
      makeProp({ key: "name", label: "" }),
    ];

    const result = checkGuardrails(TEST_CONCEPT, properties);

    const emptyLabelIssues = result.issues.filter((i) => i.code === "EMPTY_LABEL");
    expect(emptyLabelIssues).toHaveLength(1);
    expect(emptyLabelIssues[0].severity).toBe("warning");
    expect(result.canSave).toBe(true);
  });

  it("duplicate label produces warning", () => {
    const properties = [
      makeProp({ key: "first_name", label: "Name" }),
      makeProp({ key: "display_name", label: "Name" }),
    ];

    const result = checkGuardrails(TEST_CONCEPT, properties);

    const dupIssues = result.issues.filter((i) => i.code === "DUPLICATE_LABEL");
    expect(dupIssues).toHaveLength(1);
    expect(dupIssues[0].severity).toBe("warning");
    expect(result.canSave).toBe(true);
  });

  it("hidden + required produces error and blocks save", () => {
    const properties = [
      makeProp({ key: "secret", hidden: true, required: true }),
    ];

    const result = checkGuardrails(TEST_CONCEPT, properties);

    const hiddenReqIssues = result.issues.filter((i) => i.code === "HIDDEN_REQUIRED");
    expect(hiddenReqIssues).toHaveLength(1);
    expect(hiddenReqIssues[0].severity).toBe("error");
    expect(result.canSave).toBe(false);
  });

  it("too many fields (20+) produces warning", () => {
    const properties = Array.from({ length: 22 }, (_, i) =>
      makeProp({ key: `field_${i}`, sortOrder: i })
    );

    const result = checkGuardrails(TEST_CONCEPT, properties);

    const tooManyIssues = result.issues.filter((i) => i.code === "TOO_MANY_FIELDS");
    expect(tooManyIssues).toHaveLength(1);
    expect(tooManyIssues[0].severity).toBe("warning");
    expect(result.canSave).toBe(true);
  });

  it("no status field produces suggestion", () => {
    const properties = [
      makeProp({ key: "name", type: "text" }),
      makeProp({ key: "email", type: "email" }),
    ];

    const result = checkGuardrails(TEST_CONCEPT, properties);

    const statusIssues = result.issues.filter((i) => i.code === "NO_STATUS_FIELD");
    expect(statusIssues).toHaveLength(1);
    expect(statusIssues[0].severity).toBe("suggestion");
    expect(result.canSave).toBe(true);
  });

  it("clean concept with status produces no issues", () => {
    const properties = [
      makeProp({ key: "name", label: "Name", type: "text" }),
      makeProp({ key: "email", label: "Email", type: "email" }),
      makeProp({ key: "status", label: "Status", type: "status" }),
    ];

    const result = checkGuardrails(TEST_CONCEPT, properties);

    expect(result.issues).toHaveLength(0);
    expect(result.canSave).toBe(true);
  });

  it("duplicate labels are case-insensitive", () => {
    const properties = [
      makeProp({ key: "f1", label: "Full Name" }),
      makeProp({ key: "f2", label: "full name" }),
    ];

    const result = checkGuardrails(TEST_CONCEPT, properties);

    const dupIssues = result.issues.filter((i) => i.code === "DUPLICATE_LABEL");
    expect(dupIssues).toHaveLength(1);
  });
});
