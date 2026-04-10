import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Postgres and logger before importing the module under test
const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import {
  loadOntology,
  getOntology,
  reloadOntology,
  getConceptByKey,
  getPropertiesForConcept,
  getRelationshipsForConcept,
  getEventsForConcept,
  getConstraintsForConcept,
  getFormConfig,
  getViewConfigs,
  getPageConfigs,
} from "./loader";
import { cache } from "../cache";

// --- Test data helpers ---

function makeConcept(key: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `concept-${key}`,
    key,
    name,
    plural_name: `${name}s`,
    extends: null,
    icon: null,
    description: null,
    is_registry: false,
    is_config: false,
    status: "active",
    ...extra,
  };
}

function makeProperty(conceptKey: string, key: string, extra: Record<string, unknown> = {}) {
  return {
    id: `prop-${conceptKey}-${key}`,
    concept_key: conceptKey,
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    type: "text",
    required: false,
    default_value: null,
    placeholder: null,
    description: null,
    postgres_column: null,
    options: null,
    validation_rules: null,
    sort_order: 0,
    hidden: false,
    read_only: false,
    status: "active",
    ...extra,
  };
}

function makeConstraint(conceptKey: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `constraint-${conceptKey}-${name}`,
    concept_key: conceptKey,
    name,
    extends: null,
    condition: { type: "field", field: "type", operator: "eq", value: conceptKey },
    defaults: null,
    required_fields: null,
    description: null,
    status: "active",
    ...extra,
  };
}

function makeRelationship(
  sourceConceptKey: string,
  targetConceptKey: string,
  key: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `rel-${sourceConceptKey}-${key}`,
    source_concept_key: sourceConceptKey,
    target_concept_key: targetConceptKey,
    key,
    label: key,
    cardinality: "has-many",
    inverse_key: null,
    description: null,
    status: "active",
    ...extra,
  };
}

function makeEvent(
  conceptKey: string,
  eventKey: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `event-${conceptKey}-${eventKey}`,
    concept_key: conceptKey,
    event_key: eventKey,
    full_event_name: null,
    trigger_type: "on_create",
    description: null,
    changed_fields: null,
    schedule: null,
    status: "active",
    ...extra,
  };
}

function makeFormConfig(
  conceptKey: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `form-${conceptKey}`,
    concept_key: conceptKey,
    name: "default",
    fields: [{ propertyKey: "name" }],
    layout: "single",
    steps: null,
    status: "active",
    ...extra,
  };
}

function makeViewConfig(
  conceptKey: string,
  name: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `view-${conceptKey}-${name}`,
    concept_key: conceptKey,
    name,
    view_type: "table",
    columns: [{ propertyKey: "name" }],
    filters: null,
    sort: null,
    group_by: null,
    timeline_start: null,
    timeline_end: null,
    row_action: null,
    presets: null,
    status: "active",
    ...extra,
  };
}

function makePageConfig(
  name: string,
  slug: string,
  extra: Record<string, unknown> = {}
) {
  return {
    id: `page-${slug}`,
    name,
    slug,
    widgets: [{ widgetId: "w1", type: "stat_card", title: "Count" }],
    breakpoints: null,
    status: "active",
    ...extra,
  };
}

function setupQueryMock(
  concepts: Record<string, unknown>[],
  properties: Record<string, unknown>[] = [],
  relationships: Record<string, unknown>[] = [],
  events: Record<string, unknown>[] = [],
  constraints: Record<string, unknown>[] = []
) {
  let callIndex = 0;
  const responses = [
    { rows: concepts, rowCount: concepts.length },
    { rows: properties, rowCount: properties.length },
    { rows: relationships, rowCount: relationships.length },
    { rows: events, rowCount: events.length },
    { rows: constraints, rowCount: constraints.length },
  ];

  mockQuery.mockImplementation(() => {
    const response = responses[callIndex] ?? { rows: [], rowCount: 0 };
    callIndex++;
    return Promise.resolve(response);
  });
}

/** SQL-aware mock: returns data based on which table is being queried. */
function setupSqlAwareMock(
  tableData: Record<string, Record<string, unknown>[]>
) {
  mockQuery.mockImplementation((sql: string) => {
    for (const [tableName, rows] of Object.entries(tableData)) {
      if (sql.includes(tableName)) {
        return Promise.resolve({ rows, rowCount: rows.length });
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe("Ontology Loader", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("loadOntology", () => {
    it("loads concepts from Postgres", async () => {
      setupQueryMock([
        makeConcept("guest", "Guest"),
        makeConcept("staff", "Staff"),
      ]);

      const cache = await loadOntology();

      expect(cache.concepts.size).toBe(2);
      expect(cache.concepts.get("guest")?.name).toBe("Guest");
      expect(cache.concepts.get("staff")?.name).toBe("Staff");
    });

    it("loads properties grouped by concept key", async () => {
      setupQueryMock(
        [makeConcept("guest", "Guest")],
        [
          makeProperty("guest", "name", { sort_order: 0 }),
          makeProperty("guest", "status", { sort_order: 1 }),
          makeProperty("guest", "type", { sort_order: 2 }),
        ]
      );

      const cache = await loadOntology();
      const guestProps = cache.properties.get("guest");

      expect(guestProps).toHaveLength(3);
      expect(guestProps![0].key).toBe("name");
      expect(guestProps![1].key).toBe("status");
      expect(guestProps![2].key).toBe("type");
    });

    it("skips rows with missing required fields", async () => {
      setupQueryMock([
        makeConcept("guest", "Guest"),
        { id: "bad", key: null, name: null }, // missing key and name
      ]);

      const cache = await loadOntology();
      expect(cache.concepts.size).toBe(1);
    });

    it("records loadedAt timestamp", async () => {
      setupQueryMock([]);
      const before = Date.now();
      const cache = await loadOntology();
      const after = Date.now();

      expect(cache.loadedAt).toBeGreaterThanOrEqual(before);
      expect(cache.loadedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("inheritance resolution", () => {
    it("child concept inherits parent properties", async () => {
      setupQueryMock(
        [
          makeConcept("guest", "Guest"),
          makeConcept("vip_guest", "VIP Guest", { extends: "guest" }),
        ],
        [
          makeProperty("guest", "name", { sort_order: 0 }),
          makeProperty("guest", "status", { sort_order: 1 }),
          makeProperty("vip_guest", "greenRoomRequired", { sort_order: 2 }),
        ]
      );

      const cache = await loadOntology();
      const vipProps = cache.properties.get("vip_guest");

      expect(vipProps).toHaveLength(3);
      expect(vipProps!.map((p) => p.key)).toEqual(["name", "status", "greenRoomRequired"]);
    });

    it("child property with same key overrides parent", async () => {
      setupQueryMock(
        [
          makeConcept("guest", "Guest"),
          makeConcept("vip_guest", "VIP Guest", { extends: "guest" }),
        ],
        [
          makeProperty("guest", "status", { sort_order: 0, default_value: "draft" }),
          makeProperty("vip_guest", "status", { sort_order: 0, default_value: "vip_draft" }),
        ]
      );

      const cache = await loadOntology();
      const vipProps = cache.properties.get("vip_guest");

      expect(vipProps).toHaveLength(1);
      expect(vipProps![0].defaultValue).toBe("vip_draft");
    });

    it("child inherits parent constraints", async () => {
      setupQueryMock(
        [
          makeConcept("guest", "Guest"),
          makeConcept("vip_guest", "VIP Guest", { extends: "guest" }),
        ],
        [],
        [],
        [],
        [
          makeConstraint("guest", "Base Constraint"),
          makeConstraint("vip_guest", "VIP Constraint"),
        ]
      );

      const cache = await loadOntology();
      const vipConstraints = cache.constraints.get("vip_guest");

      expect(vipConstraints).toHaveLength(2);
      expect(vipConstraints![0].name).toBe("Base Constraint");
      expect(vipConstraints![1].name).toBe("VIP Constraint");
    });

    it("handles circular inheritance gracefully", async () => {
      setupQueryMock(
        [
          makeConcept("a", "A", { extends: "b" }),
          makeConcept("b", "B", { extends: "a" }),
        ],
        [
          makeProperty("a", "fieldA"),
          makeProperty("b", "fieldB"),
        ]
      );

      // Should not throw — circular inheritance is detected and logged
      const cache = await loadOntology();
      expect(cache.concepts.size).toBe(2);
    });

    it("handles 3-level deep inheritance chain", async () => {
      setupQueryMock(
        [
          makeConcept("base", "Base"),
          makeConcept("mid", "Mid", { extends: "base" }),
          makeConcept("leaf", "Leaf", { extends: "mid" }),
        ],
        [
          makeProperty("base", "baseField", { sort_order: 0 }),
          makeProperty("mid", "midField", { sort_order: 1 }),
          makeProperty("leaf", "leafField", { sort_order: 2 }),
        ]
      );

      const cache = await loadOntology();
      const leafProps = cache.properties.get("leaf");

      expect(leafProps).toHaveLength(3);
      expect(leafProps!.map((p) => p.key)).toEqual(["baseField", "midField", "leafField"]);
    });
  });
});

// =========================================================================
// Parser edge case tests
// =========================================================================

describe("Parser edge cases", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("parseConcept with null name returns null (concept skipped)", async () => {
    setupQueryMock([
      { id: "c1", key: "guest", name: null },
    ]);

    const ontology = await loadOntology();

    expect(ontology.concepts.size).toBe(0);
  });

  it("parseProperty with missing type defaults to 'text'", async () => {
    setupQueryMock(
      [makeConcept("guest", "Guest")],
      [makeProperty("guest", "name", { type: null })]
    );

    const ontology = await loadOntology();
    const props = ontology.properties.get("guest");

    expect(props).toHaveLength(1);
    expect(props![0].type).toBe("text");
  });

  it("parseProperty with options as object array (JSONB) preserves them", async () => {
    const optionsArray = [
      { value: "confirmed", label: "Confirmed", color: "green" },
      { value: "pending", label: "Pending", color: "yellow" },
    ];
    setupQueryMock(
      [makeConcept("guest", "Guest")],
      [makeProperty("guest", "status", { type: "select", options: optionsArray })]
    );

    const ontology = await loadOntology();
    const props = ontology.properties.get("guest");

    expect(props).toHaveLength(1);
    expect(props![0].options).toEqual(optionsArray);
  });

  it("parseProperty with options as string array converts to SelectOption objects", async () => {
    const optionsArray = ["confirmed", "pending", "cancelled"];
    setupQueryMock(
      [makeConcept("guest", "Guest")],
      [makeProperty("guest", "status", { type: "select", options: optionsArray })]
    );

    const ontology = await loadOntology();
    const props = ontology.properties.get("guest");

    expect(props![0].options).toEqual([
      { value: "confirmed", label: "confirmed" },
      { value: "pending", label: "pending" },
      { value: "cancelled", label: "cancelled" },
    ]);
  });

  it("parseRelationship with missing source_concept_key returns null", async () => {
    setupQueryMock(
      [makeConcept("guest", "Guest")],
      [],
      [
        {
          id: "rel-bad",
          source_concept_key: null,
          target_concept_key: "venue",
          key: "assigned_venue",
          label: "Venue",
          cardinality: "has-one",
          status: "active",
        },
      ]
    );

    const ontology = await loadOntology();

    // No relationships should be loaded since source_concept_key is null
    expect(ontology.relationships.size).toBe(0);
  });

  it("parseDomainEventDef with missing event_key returns null", async () => {
    setupQueryMock(
      [makeConcept("guest", "Guest")],
      [],
      [],
      [
        {
          id: "evt-bad",
          concept_key: "guest",
          event_key: null,
          full_event_name: null,
          trigger_type: "on_create",
          status: "active",
        },
      ]
    );

    const ontology = await loadOntology();

    expect(ontology.events.size).toBe(0);
  });

  it("parseDomainEventDef builds fullEventName from conceptKey + eventKey when not provided", async () => {
    setupQueryMock(
      [makeConcept("guest", "Guest")],
      [],
      [],
      [makeEvent("guest", "checked_in")]
    );

    const ontology = await loadOntology();
    const events = ontology.events.get("guest");

    expect(events).toHaveLength(1);
    expect(events![0].fullEventName).toBe("guest.checked_in");
  });

  it("parseDomainEventDef uses provided fullEventName when present", async () => {
    setupQueryMock(
      [makeConcept("guest", "Guest")],
      [],
      [],
      [makeEvent("guest", "checked_in", { full_event_name: "custom.event.name" })]
    );

    const ontology = await loadOntology();
    const events = ontology.events.get("guest");

    expect(events![0].fullEventName).toBe("custom.event.name");
  });

  it("parseConstraint with object condition (JSONB) passes through", async () => {
    const condition = {
      type: "and" as const,
      conditions: [
        { type: "field" as const, field: "type", operator: "eq" as const, value: "vip" },
        { type: "field" as const, field: "status", operator: "eq" as const, value: "confirmed" },
      ],
    };
    setupQueryMock(
      [makeConcept("guest", "Guest")],
      [],
      [],
      [],
      [makeConstraint("guest", "VIP Constraint", { condition })]
    );

    const ontology = await loadOntology();
    const constraints = ontology.constraints.get("guest");

    expect(constraints).toHaveLength(1);
    expect(constraints![0].condition).toEqual(condition);
  });
});

// =========================================================================
// Config loader tests
// =========================================================================

describe("Config loaders", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    cache.clear();
  });

  describe("getFormConfig", () => {
    it("returns parsed FormConfig for existing concept", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeFormConfig("guest")],
        rowCount: 1,
      });

      const config = await getFormConfig("guest");

      expect(config).toBeDefined();
      expect(config!.conceptKey).toBe("guest");
      expect(config!.name).toBe("default");
      expect(config!.layout).toBe("single");
      expect(config!.fields).toEqual([{ propertyKey: "name" }]);
    });

    it("returns undefined for unknown concept (empty result)", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const config = await getFormConfig("nonexistent");

      expect(config).toBeUndefined();
    });

    it("uses cache on second call (query called once)", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeFormConfig("guest")],
        rowCount: 1,
      });

      const first = await getFormConfig("guest");
      const second = await getFormConfig("guest");

      expect(first).toEqual(second);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe("getViewConfigs", () => {
    it("returns array of ViewConfigs", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeViewConfig("guest", "table-view"),
          makeViewConfig("guest", "kanban-view", { view_type: "kanban" }),
        ],
        rowCount: 2,
      });

      const configs = await getViewConfigs("guest");

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe("table-view");
      expect(configs[1].name).toBe("kanban-view");
      expect(configs[1].viewType).toBe("kanban");
    });

    it("returns empty array for unknown concept", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const configs = await getViewConfigs("nonexistent");

      expect(configs).toEqual([]);
    });
  });

  describe("getPageConfigs", () => {
    it("returns all active page configs", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          makePageConfig("Dashboard", "/dashboard"),
          makePageConfig("Guest List", "/guests"),
        ],
        rowCount: 2,
      });

      const pages = await getPageConfigs();

      expect(pages).toHaveLength(2);
      expect(pages[0].name).toBe("Dashboard");
      expect(pages[0].slug).toBe("/dashboard");
      expect(pages[1].name).toBe("Guest List");
      expect(pages[1].slug).toBe("/guests");
      expect(pages[0].widgets).toHaveLength(1);
    });
  });
});

// =========================================================================
// Public API tests
// =========================================================================

describe("Public API", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    cache.clear();
  });

  it("getOntology returns cached result on second call", async () => {
    setupQueryMock([makeConcept("guest", "Guest")]);

    const first = await getOntology();
    const second = await getOntology();

    expect(first).toBe(second);
    // loadOntology calls query 5 times (one per table). Only one load should happen.
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("reloadOntology clears cache and reloads (query called twice)", async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [],
      ontology_relationships: [],
      ontology_events: [],
      ontology_constraints: [],
    });

    await getOntology();
    const callsAfterFirst = mockQuery.mock.calls.length;

    await reloadOntology();
    const callsAfterReload = mockQuery.mock.calls.length;

    // reloadOntology should trigger 5 additional queries (one per table)
    expect(callsAfterReload - callsAfterFirst).toBe(5);
  });

  it('getConceptByKey("guest") returns concept', async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [],
      ontology_relationships: [],
      ontology_events: [],
      ontology_constraints: [],
    });

    const concept = await getConceptByKey("guest");

    expect(concept).toBeDefined();
    expect(concept!.key).toBe("guest");
    expect(concept!.name).toBe("Guest");
  });

  it('getConceptByKey("nonexistent") returns undefined', async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [],
      ontology_relationships: [],
      ontology_events: [],
      ontology_constraints: [],
    });

    const concept = await getConceptByKey("nonexistent");

    expect(concept).toBeUndefined();
  });

  it('getPropertiesForConcept("nonexistent") returns empty array', async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [makeProperty("guest", "name")],
      ontology_relationships: [],
      ontology_events: [],
      ontology_constraints: [],
    });

    const props = await getPropertiesForConcept("nonexistent");

    expect(props).toEqual([]);
  });

  it('getConstraintsForConcept("nonexistent") returns empty array', async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [],
      ontology_relationships: [],
      ontology_events: [],
      ontology_constraints: [makeConstraint("guest", "Base Constraint")],
    });

    const constraints = await getConstraintsForConcept("nonexistent");

    expect(constraints).toEqual([]);
  });

  it("getRelationshipsForConcept returns relationships for known concept", async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest"), makeConcept("venue", "Venue")],
      ontology_properties: [],
      ontology_relationships: [makeRelationship("guest", "venue", "assigned_venue")],
      ontology_events: [],
      ontology_constraints: [],
    });

    const rels = await getRelationshipsForConcept("guest");

    expect(rels).toHaveLength(1);
    expect(rels[0].key).toBe("assigned_venue");
    expect(rels[0].targetConceptKey).toBe("venue");
  });

  it("getEventsForConcept returns events for known concept", async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [],
      ontology_relationships: [],
      ontology_events: [makeEvent("guest", "checked_in")],
      ontology_constraints: [],
    });

    const events = await getEventsForConcept("guest");

    expect(events).toHaveLength(1);
    expect(events[0].eventKey).toBe("checked_in");
  });
});

// =========================================================================
// Cache behavior tests
// =========================================================================

describe("Cache behavior", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    cache.clear();
  });

  it("cache miss triggers Postgres query", async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [],
      ontology_relationships: [],
      ontology_events: [],
      ontology_constraints: [],
    });

    expect(mockQuery).not.toHaveBeenCalled();

    await getOntology();

    expect(mockQuery).toHaveBeenCalled();
  });

  it("cache hit returns without query", async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [],
      ontology_relationships: [],
      ontology_events: [],
      ontology_constraints: [],
    });

    await getOntology();
    const callsAfterFirst = mockQuery.mock.calls.length;

    await getOntology();
    const callsAfterSecond = mockQuery.mock.calls.length;

    // No additional calls on cache hit
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it("cache invalidation via reloadOntology triggers fresh query", async () => {
    setupSqlAwareMock({
      ontology_concepts: [makeConcept("guest", "Guest")],
      ontology_properties: [],
      ontology_relationships: [],
      ontology_events: [],
      ontology_constraints: [],
    });

    await getOntology();
    const callsAfterFirst = mockQuery.mock.calls.length;

    await reloadOntology();
    const callsAfterReload = mockQuery.mock.calls.length;

    // Fresh queries should have been made
    expect(callsAfterReload).toBeGreaterThan(callsAfterFirst);
  });
});
