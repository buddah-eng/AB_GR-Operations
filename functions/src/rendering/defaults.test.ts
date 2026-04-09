import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Property, PropertyType } from "../ontology/types";
import {
  generateDefaultForm,
  generateDefaultView,
  PROPERTY_TO_INPUT_MAP,
  PROPERTY_TO_COLUMN_MAP,
} from "./defaults";

// --- Mock ontology loader ---

vi.mock("../ontology/loader", () => ({
  getPropertiesForConcept: vi.fn(),
}));

import { getPropertiesForConcept } from "../ontology/loader";
const mockGetProperties = vi.mocked(getPropertiesForConcept);

// --- Helpers ---

function makeProp(overrides: Partial<Property> & { key: string }): Property {
  return {
    id: `prop-${overrides.key}`,
    conceptKey: "test_concept",
    label: overrides.key,
    type: "text",
    required: false,
    sortOrder: 0,
    ...overrides,
  };
}

const ALL_PROPERTY_TYPES: ReadonlyArray<PropertyType> = [
  "text", "rich_text", "number", "select", "multi_select",
  "date", "datetime", "checkbox", "url", "email",
  "phone", "relation", "formula", "rollup", "files",
  "people", "status",
];

beforeEach(() => {
  vi.clearAllMocks();
});

// --- generateDefaultForm ---

describe("generateDefaultForm", () => {
  it("creates FormConfig with all non-hidden properties", async () => {
    mockGetProperties.mockResolvedValue([
      makeProp({ key: "name", sortOrder: 1 }),
      makeProp({ key: "email", sortOrder: 2 }),
      makeProp({ key: "internal_id", sortOrder: 3, hidden: true }),
    ]);

    const form = await generateDefaultForm("test_concept");

    expect(form.conceptKey).toBe("test_concept");
    expect(form.layout).toBe("single");
    expect(form.fields).toHaveLength(2);
    expect(form.fields.map((f) => f.propertyKey)).toEqual(["name", "email"]);
  });

  it("marks required fields correctly (fields present, required is on property)", async () => {
    mockGetProperties.mockResolvedValue([
      makeProp({ key: "name", required: true, sortOrder: 1 }),
      makeProp({ key: "bio", required: false, sortOrder: 2 }),
    ]);

    const form = await generateDefaultForm("test_concept");

    // Form fields reference propertyKey; the required flag lives on the Property itself
    expect(form.fields).toHaveLength(2);
    expect(form.fields[0].propertyKey).toBe("name");
    expect(form.fields[1].propertyKey).toBe("bio");
  });

  it("excludes formula and rollup (read-only display types)", async () => {
    mockGetProperties.mockResolvedValue([
      makeProp({ key: "name", type: "text", sortOrder: 1 }),
      makeProp({ key: "total", type: "formula", sortOrder: 2 }),
      makeProp({ key: "count", type: "rollup", sortOrder: 3 }),
    ]);

    const form = await generateDefaultForm("test_concept");

    expect(form.fields).toHaveLength(1);
    expect(form.fields[0].propertyKey).toBe("name");
  });

  it("returns empty fields for concept with only hidden properties", async () => {
    mockGetProperties.mockResolvedValue([
      makeProp({ key: "internal", hidden: true, sortOrder: 1 }),
    ]);

    const form = await generateDefaultForm("test_concept");
    expect(form.fields).toHaveLength(0);
  });
});

// --- generateDefaultView ---

describe("generateDefaultView", () => {
  it("creates table with first 6 non-hidden columns", async () => {
    const props = Array.from({ length: 10 }, (_, i) =>
      makeProp({ key: `field_${i}`, sortOrder: i })
    );
    mockGetProperties.mockResolvedValue(props);

    const view = await generateDefaultView("test_concept");

    expect(view.viewType).toBe("table");
    expect(view.columns).toHaveLength(6);
    expect(view.columns?.map((c) => c.propertyKey)).toEqual([
      "field_0", "field_1", "field_2", "field_3", "field_4", "field_5",
    ]);
  });

  it("includes status column when present", async () => {
    const props = [
      makeProp({ key: "name", type: "text", sortOrder: 1 }),
      makeProp({ key: "email", type: "email", sortOrder: 2 }),
      makeProp({ key: "phone", type: "phone", sortOrder: 3 }),
      makeProp({ key: "status", type: "status", sortOrder: 4 }),
    ];
    mockGetProperties.mockResolvedValue(props);

    const view = await generateDefaultView("test_concept");

    const keys = view.columns?.map((c) => c.propertyKey) ?? [];
    expect(keys).toContain("status");
  });

  it("sorts by created_at DESC by default", async () => {
    mockGetProperties.mockResolvedValue([
      makeProp({ key: "name", sortOrder: 1 }),
    ]);

    const view = await generateDefaultView("test_concept");

    expect(view.sort).toEqual({ field: "created_at", direction: "desc" });
  });

  it("skips hidden properties in columns", async () => {
    mockGetProperties.mockResolvedValue([
      makeProp({ key: "name", sortOrder: 1 }),
      makeProp({ key: "secret", sortOrder: 2, hidden: true }),
      makeProp({ key: "email", sortOrder: 3 }),
    ]);

    const view = await generateDefaultView("test_concept");

    const keys = view.columns?.map((c) => c.propertyKey) ?? [];
    expect(keys).not.toContain("secret");
    expect(keys).toEqual(["name", "email"]);
  });
});

// --- PROPERTY_TO_INPUT_MAP ---

describe("PROPERTY_TO_INPUT_MAP", () => {
  it("has all 17 property types mapped", () => {
    for (const propType of ALL_PROPERTY_TYPES) {
      expect(PROPERTY_TO_INPUT_MAP[propType]).toBeDefined();
    }
    expect(Object.keys(PROPERTY_TO_INPUT_MAP)).toHaveLength(17);
  });
});

// --- PROPERTY_TO_COLUMN_MAP ---

describe("PROPERTY_TO_COLUMN_MAP", () => {
  it("has all 17 property types mapped", () => {
    for (const propType of ALL_PROPERTY_TYPES) {
      expect(PROPERTY_TO_COLUMN_MAP[propType]).toBeDefined();
    }
    expect(Object.keys(PROPERTY_TO_COLUMN_MAP)).toHaveLength(17);
  });
});
