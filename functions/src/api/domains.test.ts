/**
 * Tests for the Generic CRUD Router for Domain Concepts
 *
 * Covers:
 * - Helper functions: conceptToTable, isSafeIdentifier, separateProperties,
 *   buildWhereClause, buildOrderBy, rowToDomainRecord
 * - Route integration: GET list, GET single, POST create, PUT update, DELETE archive
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import type { Property } from "../ontology/types";

// --- Mocks (must be before import of module under test) ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockGetConceptByKey = vi.fn();
const mockGetPropertiesForConcept = vi.fn();
vi.mock("../ontology/loader", () => ({
  getConceptByKey: (...args: unknown[]) => mockGetConceptByKey(...args),
  getPropertiesForConcept: (...args: unknown[]) => mockGetPropertiesForConcept(...args),
}));

const mockCanPerformAction = vi.fn();
const mockFilterRecord = vi.fn();
const mockFilterWritePayload = vi.fn();
vi.mock("../roles/engine", () => ({
  roleEngine: {
    canPerformAction: (...args: unknown[]) => mockCanPerformAction(...args),
    filterRecord: (...args: unknown[]) => mockFilterRecord(...args),
    filterWritePayload: (...args: unknown[]) => mockFilterWritePayload(...args),
  },
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(...args),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import {
  domainRouter,
  conceptToTable,
  isSafeIdentifier,
  separateProperties,
  buildWhereClause,
  buildOrderBy,
  rowToDomainRecord,
} from "./domains";

// --- Fixtures ---

const GUEST_CONCEPT = {
  id: "c1",
  key: "guest",
  name: "Guest",
  pluralName: "Guests",
};

const GUEST_PROPERTIES: ReadonlyArray<Property> = [
  {
    id: "p1",
    conceptKey: "guest",
    key: "name",
    label: "Name",
    type: "text",
    required: true,
    postgresColumn: "name",
    sortOrder: 1,
  },
  {
    id: "p2",
    conceptKey: "guest",
    key: "status",
    label: "Status",
    type: "select",
    required: false,
    postgresColumn: "status",
    sortOrder: 2,
  },
  {
    id: "p3",
    conceptKey: "guest",
    key: "dietary_notes",
    label: "Dietary Notes",
    type: "text",
    required: false,
    sortOrder: 3,
  },
];

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "human" as const,
  changeSet: "cs-123",
};

function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    name: "Alice",
    status: "confirmed",
    properties: { dietary_notes: "vegan" },
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-02T00:00:00Z"),
    created_by: "user-1",
    archived: false,
    ...overrides,
  };
}

// --- Mock request/response helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "test@example.com" },
    role: { roleKey: "director", roleName: "Director", priority: 0 },
    actorType: "human",
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null as unknown,
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._json = data;
      return this;
    }),
  };
  return res as unknown as Response & { _json: unknown; statusCode: number };
}

// --- Find a route handler from the Express Router stack ---

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = domainRouter as any;
  const stack = router.stack as Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (...args: unknown[]) => unknown }>;
    };
  }>;

  for (const layer of stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

// ============================================================
// Helper function tests
// ============================================================

describe("conceptToTable", () => {
  it("maps 'guest' to 'guests'", () => {
    expect(conceptToTable("guest")).toBe("guests");
  });

  it("maps 'staff' to 'staff'", () => {
    expect(conceptToTable("staff")).toBe("staff");
  });

  it("maps 'schedule_event' to 'schedule_events'", () => {
    expect(conceptToTable("schedule_event")).toBe("schedule_events");
  });

  it("maps 'volunteer' to 'staff' (alias)", () => {
    expect(conceptToTable("volunteer")).toBe("staff");
  });

  it("throws with status 400 for unknown concept", () => {
    try {
      conceptToTable("unknown_concept");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("No table mapping");
      expect((err as { status: number }).status).toBe(400);
    }
  });
});

describe("isSafeIdentifier", () => {
  it("accepts simple lowercase name", () => {
    expect(isSafeIdentifier("name")).toBe(true);
  });

  it("accepts name with underscores and digits", () => {
    expect(isSafeIdentifier("created_at_2")).toBe(true);
  });

  it("accepts uppercase letters", () => {
    expect(isSafeIdentifier("Name")).toBe(true);
  });

  it("rejects SQL injection attempt", () => {
    expect(isSafeIdentifier("Robert'; DROP TABLE guests;--")).toBe(false);
  });

  it("rejects names starting with a digit", () => {
    expect(isSafeIdentifier("1column")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeIdentifier("")).toBe(false);
  });

  it("rejects names with spaces", () => {
    expect(isSafeIdentifier("column name")).toBe(false);
  });
});

describe("separateProperties", () => {
  it("routes postgresColumn fields to coreColumns", () => {
    const payload = { name: "Alice", status: "confirmed" };
    const { coreColumns, jsonbProperties } = separateProperties(payload, GUEST_PROPERTIES);

    expect(coreColumns).toEqual({ name: "Alice", status: "confirmed" });
    expect(jsonbProperties).toEqual({});
  });

  it("routes well-known fields to coreColumns even without postgresColumn", () => {
    const propsWithoutColumn: ReadonlyArray<Property> = [
      { id: "p4", conceptKey: "guest", key: "company", label: "Company", type: "text", required: false, sortOrder: 4 },
    ];
    const payload = { company: "Acme Corp" };
    const { coreColumns } = separateProperties(payload, propsWithoutColumn);

    expect(coreColumns.company).toBe("Acme Corp");
  });

  it("routes unknown fields to jsonbProperties", () => {
    const payload = { name: "Alice", custom_field: "custom_value" };
    const { coreColumns, jsonbProperties } = separateProperties(payload, GUEST_PROPERTIES);

    expect(coreColumns).toEqual({ name: "Alice" });
    expect(jsonbProperties).toEqual({ custom_field: "custom_value" });
  });

  it("routes property with postgresColumn mapping to the correct column name", () => {
    const propsWithMapping: ReadonlyArray<Property> = [
      { id: "p5", conceptKey: "guest", key: "arrival_date", label: "Arrival", type: "date", required: false, postgresColumn: "arrives_at", sortOrder: 5 },
    ];
    const payload = { arrival_date: "2026-05-01" };
    const { coreColumns } = separateProperties(payload, propsWithMapping);

    expect(coreColumns).toEqual({ arrives_at: "2026-05-01" });
  });

  it("handles empty payload", () => {
    const { coreColumns, jsonbProperties } = separateProperties({}, GUEST_PROPERTIES);

    expect(coreColumns).toEqual({});
    expect(jsonbProperties).toEqual({});
  });
});

describe("buildWhereClause", () => {
  it("builds parameterized WHERE for filter[status]=active", () => {
    const queryParams = { "filter[status]": "active" };
    const { whereClause, params } = buildWhereClause(queryParams, GUEST_PROPERTIES, "director", "guest", "uid-1");

    expect(whereClause).toContain("AND status = $1");
    expect(params).toEqual(["active"]);
  });

  it("skips fields not in property list", () => {
    const queryParams = { "filter[nonexistent]": "value" };
    const { whereClause, params } = buildWhereClause(queryParams, GUEST_PROPERTIES, "director", "guest", "uid-1");

    expect(whereClause).toBe("");
    expect(params).toEqual([]);
  });

  it("handles JSONB property filters (no postgresColumn)", () => {
    const queryParams = { "filter[dietary_notes]": "vegan" };
    const { whereClause, params } = buildWhereClause(queryParams, GUEST_PROPERTIES, "director", "guest", "uid-1");

    expect(whereClause).toContain("properties->>'dietary_notes'");
    expect(params).toEqual(["vegan"]);
  });

  it("skips unsafe field names", () => {
    const unsafeProps: ReadonlyArray<Property> = [
      { id: "p-bad", conceptKey: "guest", key: "bad; DROP TABLE", label: "Bad", type: "text", required: false, sortOrder: 99 },
    ];
    const queryParams = { "filter[bad; DROP TABLE]": "x" };
    const { whereClause, params } = buildWhereClause(queryParams, unsafeProps, "director", "guest", "uid-1");

    expect(whereClause).toBe("");
    expect(params).toEqual([]);
  });

  it("builds multiple filter conditions", () => {
    const queryParams = { "filter[name]": "Alice", "filter[status]": "confirmed" };
    const { whereClause, params } = buildWhereClause(queryParams, GUEST_PROPERTIES, "director", "guest", "uid-1");

    expect(whereClause).toContain("AND name = $1");
    expect(whereClause).toContain("AND status = $2");
    expect(params).toEqual(["Alice", "confirmed"]);
  });

  it("ignores non-filter query params", () => {
    const queryParams = { page: "1", limit: "10", sort: "name" };
    const { whereClause, params } = buildWhereClause(queryParams, GUEST_PROPERTIES, "director", "guest", "uid-1");

    expect(whereClause).toBe("");
    expect(params).toEqual([]);
  });
});

describe("buildOrderBy", () => {
  it("defaults to ORDER BY created_at DESC when no sort given", () => {
    const result = buildOrderBy({}, GUEST_PROPERTIES);
    expect(result).toBe("ORDER BY created_at DESC");
  });

  it("uses sort key with postgresColumn", () => {
    const result = buildOrderBy({ sort: "name" }, GUEST_PROPERTIES);
    expect(result).toBe("ORDER BY name ASC");
  });

  it("respects direction=desc", () => {
    const result = buildOrderBy({ sort: "name", direction: "desc" }, GUEST_PROPERTIES);
    expect(result).toBe("ORDER BY name DESC");
  });

  it("falls back to default for unknown sort key", () => {
    const result = buildOrderBy({ sort: "nonexistent" }, GUEST_PROPERTIES);
    expect(result).toBe("ORDER BY created_at DESC");
  });

  it("uses JSONB path for property without postgresColumn", () => {
    const result = buildOrderBy({ sort: "dietary_notes" }, GUEST_PROPERTIES);
    expect(result).toContain("properties->>'dietary_notes'");
    expect(result).toContain("ASC");
  });
});

describe("rowToDomainRecord", () => {
  it("merges typed columns and JSONB properties", () => {
    const row = sampleRow();
    const record = rowToDomainRecord(row, "guest");

    expect(record.id).toBe("row-1");
    expect(record.conceptKey).toBe("guest");
    expect(record.properties.name).toBe("Alice");
    expect(record.properties.status).toBe("confirmed");
    expect(record.properties.dietary_notes).toBe("vegan");
  });

  it("excludes meta keys from properties", () => {
    const row = sampleRow();
    const record = rowToDomainRecord(row, "guest");

    expect(record.properties).not.toHaveProperty("id");
    expect(record.properties).not.toHaveProperty("properties");
    expect(record.properties).not.toHaveProperty("created_at");
    expect(record.properties).not.toHaveProperty("updated_at");
    expect(record.properties).not.toHaveProperty("created_by");
    expect(record.properties).not.toHaveProperty("archived");
  });

  it("populates createdAt and updatedAt as ISO strings", () => {
    const row = sampleRow();
    const record = rowToDomainRecord(row, "guest");

    expect(record.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(record.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("skips null column values in properties", () => {
    const row = sampleRow({ phone: null });
    const record = rowToDomainRecord(row, "guest");

    expect(record.properties).not.toHaveProperty("phone");
  });

  it("initializes relations as empty object", () => {
    const row = sampleRow();
    const record = rowToDomainRecord(row, "guest");

    expect(record.relations).toEqual({});
  });
});

// ============================================================
// Route integration tests
// ============================================================

describe("GET /:concept (list)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/:concept");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
  });

  it("returns paginated records for valid concept", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({ rows: [sampleRow(), sampleRow({ id: "row-2", name: "Bob" })] });
    mockFilterRecord.mockImplementation((_role: string, _concept: string, props: Record<string, unknown>) =>
      Promise.resolve(props)
    );

    const req = mockReq({ params: { concept: "guest" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[]; meta: { total: number } };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
  });

  it("returns 404 for unknown concept", async () => {
    mockGetConceptByKey.mockResolvedValue(undefined);

    const req = mockReq({ params: { concept: "unicorn" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Unknown concept");
  });

  it("returns 403 without view permission", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(false);

    const req = mockReq({ params: { concept: "guest" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("permission");
  });
});

describe("GET /:concept/:id (single)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/:concept/:id");
  });

  it("returns single record for valid id", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery.mockResolvedValue({ rows: [sampleRow()] });
    mockFilterRecord.mockImplementation((_role: string, _concept: string, props: Record<string, unknown>) =>
      Promise.resolve(props)
    );

    const req = mockReq({ params: { concept: "guest", id: "row-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("row-1");
  });

  it("returns 404 when record not found", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery.mockResolvedValue({ rows: [] });

    const req = mockReq({ params: { concept: "guest", id: "missing" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("not found");
  });

  it("returns 403 without view permission", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(false);

    const req = mockReq({ params: { concept: "guest", id: "row-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("POST /:concept (create)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/:concept");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-1", eventName: "guest.created" });
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates record and fires event", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Alice", status: "confirmed" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow()] });

    const req = mockReq({
      params: { concept: "guest" },
      body: { name: "Alice", status: "confirmed" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("row-1");

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest.created",
        action: "created",
      })
    );
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("returns 403 without create permission", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(false);

    const req = mockReq({
      params: { concept: "guest" },
      body: { name: "Alice" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown concept", async () => {
    mockGetConceptByKey.mockResolvedValue(undefined);

    const req = mockReq({
      params: { concept: "unicorn" },
      body: { name: "Alice" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("PUT /:concept/:id (update)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("put", "/:concept/:id");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-2", eventName: "guest.updated" });
    mockEmit.mockResolvedValue(undefined);
  });

  it("updates record and fires event with changed fields", async () => {
    const existingRow = sampleRow();
    const updatedRow = sampleRow({ name: "Bob" });

    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery
      .mockResolvedValueOnce({ rows: [existingRow] })   // SELECT existing
      .mockResolvedValueOnce({ rows: [updatedRow] });    // UPDATE RETURNING
    mockFilterWritePayload.mockResolvedValue({ name: "Bob" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);

    const req = mockReq({
      params: { concept: "guest", id: "row-1" },
      body: { name: "Bob" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest.updated",
        action: "updated",
        changedFields: ["name"],
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns existing record without event when no changes", async () => {
    const existingRow = sampleRow();

    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [existingRow] });
    mockFilterWritePayload.mockResolvedValue({ name: "Alice" }); // same as existing
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);

    const req = mockReq({
      params: { concept: "guest", id: "row-1" },
      body: { name: "Alice" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("row-1");

    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockCreateDomainEvent).not.toHaveBeenCalled();
  });

  it("returns 404 when record not found", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const req = mockReq({
      params: { concept: "guest", id: "missing" },
      body: { name: "Bob" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 403 without edit permission", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(false);

    const req = mockReq({
      params: { concept: "guest", id: "row-1" },
      body: { name: "Bob" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("DELETE /:concept/:id (archive)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("delete", "/:concept/:id");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-3", eventName: "guest.deleted" });
    mockEmit.mockResolvedValue(undefined);
  });

  it("archives record and fires event", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const req = mockReq({
      params: { concept: "guest", id: "row-1" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: null };
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET archived = true"),
      ["row-1"]
    );
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest.deleted",
        action: "deleted",
        recordId: "row-1",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("returns 403 without delete permission", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(false);

    const req = mockReq({
      params: { concept: "guest", id: "row-1" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown concept", async () => {
    mockGetConceptByKey.mockResolvedValue(undefined);

    const req = mockReq({
      params: { concept: "unicorn", id: "row-1" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
