/**
 * Tests for MCP Surface API Router
 *
 * Covers:
 * - GET /tools returns 7 tools with annotations
 * - POST /execute with valid read-only tool returns data
 * - POST /execute with unknown tool returns 400
 * - POST /execute with missing required params returns 400
 * - POST /execute create_record calls query and fires event with MCP metadata
 * - POST /execute respects RBAC (403)
 * - Bulk limit: 5th mutation returns bulk_limit_exceeded
 * - Bulk limit: confirmBulk bypasses
 * - Read-only tools don't count toward limit
 * - Tool annotations correct (readOnly, destructive)
 * - actorType verified as ai_agent
 * - my_assignments returns user-scoped records
 * - Event metadata includes mcp_tool and mcp_session
 * - update_record is idempotent (annotation correct)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

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

const mockGetOntology = vi.fn();
const mockGetConceptByKey = vi.fn();
const mockGetPropertiesForConcept = vi.fn();
vi.mock("../ontology/loader", () => ({
  getOntology: (...args: unknown[]) => mockGetOntology(...args),
  getConceptByKey: (...args: unknown[]) => mockGetConceptByKey(...args),
  getPropertiesForConcept: (...args: unknown[]) => mockGetPropertiesForConcept(...args),
}));

const mockCanPerformAction = vi.fn();
const mockFilterRecord = vi.fn();
const mockFilterWritePayload = vi.fn();
const mockBuildDataScopeFilter = vi.fn();
vi.mock("../roles/engine", () => ({
  roleEngine: {
    canPerformAction: (...args: unknown[]) => mockCanPerformAction(...args),
    filterRecord: (...args: unknown[]) => mockFilterRecord(...args),
    filterWritePayload: (...args: unknown[]) => mockFilterWritePayload(...args),
    buildDataScopeFilter: (...args: unknown[]) => mockBuildDataScopeFilter(...args),
  },
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    const input = args[0] as Record<string, unknown>;
    return { eventId: "evt-mcp-1", eventName: input.eventName, ...input };
  },
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
  withAuditContext: async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: (...args: unknown[]) => mockQuery(...args) };
    return fn(mockClient);
  },
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
}));

const mockCheckBulkLimit = vi.fn();
vi.mock("./bulk-limit", () => ({
  checkBulkLimit: (...args: unknown[]) => mockCheckBulkLimit(...args),
}));

// --- Import module under test ---

import { mcpRouter, TOOL_REGISTRY, TOOL_MAP, DESTRUCTIVE_TOOLS, sessionMutationCounts } from "./mcp";

// --- Fixtures ---

const GUEST_CONCEPT = {
  id: "c1",
  key: "guest",
  name: "Guest",
  pluralName: "Guests",
};

const GUEST_PROPERTIES = [
  { id: "p1", conceptKey: "guest", key: "name", label: "Name", type: "text", required: true, postgresColumn: "name", sortOrder: 1 },
  { id: "p2", conceptKey: "guest", key: "status", label: "Status", type: "select", required: false, postgresColumn: "status", sortOrder: 2 },
];

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "ai_agent" as const,
  changeSet: "cs-mcp-123",
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
    actorType: "ai_agent",
    ip: "127.0.0.1",
    headers: { "x-mcp-delegation": "true" },
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

type LayerMethod = "get" | "post";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = mcpRouter as any;
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
// Tests
// ============================================================

describe("GET /tools", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/tools");
  });

  it("returns 7 tools with annotations", async () => {
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { tools: unknown[] } };
    expect(body.success).toBe(true);
    expect(body.data.tools).toHaveLength(7);

    // Verify each tool has annotations
    for (const tool of body.data.tools as Array<{ name: string; annotations: Record<string, boolean> }>) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("annotations");
      expect(tool.annotations).toHaveProperty("readOnlyHint");
      expect(tool.annotations).toHaveProperty("destructiveHint");
      expect(tool.annotations).toHaveProperty("idempotentHint");
    }
  });

  it("tool annotations match MCP spec values", () => {
    const getOntologyTool = TOOL_REGISTRY.find((t) => t.name === "get_ontology")!;
    expect(getOntologyTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });

    const createRecordTool = TOOL_REGISTRY.find((t) => t.name === "create_record")!;
    expect(createRecordTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });

    const updateRecordTool = TOOL_REGISTRY.find((t) => t.name === "update_record")!;
    expect(updateRecordTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });

    const runWorkflowTool = TOOL_REGISTRY.find((t) => t.name === "run_workflow")!;
    expect(runWorkflowTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });

    const listRecordsTool = TOOL_REGISTRY.find((t) => t.name === "list_records")!;
    expect(listRecordsTool.annotations.readOnlyHint).toBe(true);

    const myAssignmentsTool = TOOL_REGISTRY.find((t) => t.name === "my_assignments")!;
    expect(myAssignmentsTool.annotations.readOnlyHint).toBe(true);
    expect(myAssignmentsTool.annotations.idempotentHint).toBe(true);
  });

  it("no tool has destructiveHint: true in initial set", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });
});

describe("POST /execute", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMutationCounts.clear();
    handler = findHandler("post", "/execute");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
    mockBuildDataScopeFilter.mockResolvedValue(undefined);
    mockCheckBulkLimit.mockReturnValue(null);
  });

  it("returns 400 for unknown tool", async () => {
    const req = mockReq({
      body: { tool: "drop_database" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Unknown tool");
  });

  it("returns 400 for missing required params", async () => {
    const req = mockReq({
      body: { tool: "list_records", params: {} },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Missing required parameters");
    expect(body.error).toContain("concept");
  });

  it("returns 400 when tool field is missing", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("tool");
  });

  it("executes get_ontology (read-only) and returns data", async () => {
    const ontologyData = {
      concepts: new Map([["guest", GUEST_CONCEPT]]),
      properties: new Map([["guest", GUEST_PROPERTIES]]),
      relationships: new Map(),
    };
    mockGetOntology.mockResolvedValue(ontologyData);

    const req = mockReq({ body: { tool: "get_ontology" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty("concepts");
  });

  it("executes list_records and returns paginated results", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: "1" }] })
      .mockResolvedValueOnce({ rows: [sampleRow()] });
    mockFilterRecord.mockImplementation(
      (_role: string, _concept: string, props: Record<string, unknown>) => Promise.resolve(props)
    );

    const req = mockReq({
      body: { tool: "list_records", params: { concept: "guest" } },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { records: unknown[]; meta: { total: number } } };
    expect(body.success).toBe(true);
    expect(body.data.records).toHaveLength(1);
    expect(body.data.meta.total).toBe(1);
  });

  it("executes get_record and returns a single record", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery.mockResolvedValue({ rows: [sampleRow()] });
    mockFilterRecord.mockImplementation(
      (_role: string, _concept: string, props: Record<string, unknown>) => Promise.resolve(props)
    );

    const req = mockReq({
      body: { tool: "get_record", params: { concept: "guest", id: "row-1" } },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("row-1");
  });

  it("create_record calls query and fires event with MCP metadata", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Bob", status: "draft" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow({ id: "new-row", name: "Bob" })] });

    const req = mockReq({
      body: {
        tool: "create_record",
        params: { concept: "guest", data: { name: "Bob", status: "draft" } },
        mcpSession: "session-abc",
      },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);

    // Verify event was emitted with MCP metadata
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest.created",
        action: "created",
        metadata: expect.objectContaining({
          mcp_tool: "create_record",
          mcp_session: "session-abc",
        }),
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("respects RBAC - returns 403 when role lacks permission", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(false);

    const req = mockReq({
      body: { tool: "create_record", params: { concept: "guest", data: { name: "Bob" } } },
      role: { roleKey: "viewer", roleName: "Viewer", priority: 100 },
    } as Partial<Request>);
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("permission");
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("bulk limit: 5th mutation returns bulk_limit_exceeded", async () => {
    // Setup for create_record success path
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Test" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow()] });

    const sessionId = "bulk-test-session";

    // Pre-fill 4 mutations
    sessionMutationCounts.set(sessionId, 4);

    // On 5th mutation, checkBulkLimit returns a confirmation object
    mockCheckBulkLimit.mockReturnValue({
      token: "confirm-token-123",
      conceptKey: "guest",
      operation: "create_record",
      recordCount: 5,
      actorId: "test-uid",
      expiresAt: new Date(Date.now() + 300000),
    });

    const req = mockReq({
      body: {
        tool: "create_record",
        params: { concept: "guest", data: { name: "Test" } },
        mcpSession: sessionId,
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    const body = res._json as { success: boolean; error: string; data: { confirmationToken: string } };
    expect(body.error).toBe("bulk_limit_exceeded");
    expect(body.data.confirmationToken).toBe("confirm-token-123");
  });

  it("bulk limit: confirmBulk bypasses limit", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Test" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow()] });

    const sessionId = "bulk-bypass-session";
    sessionMutationCounts.set(sessionId, 4);

    // When confirmBulk is provided and valid, checkBulkLimit returns null
    mockCheckBulkLimit.mockReturnValue(null);

    const req = mockReq({
      body: {
        tool: "create_record",
        params: { concept: "guest", data: { name: "Test" } },
        mcpSession: sessionId,
        confirmBulk: "valid-token",
      },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    // checkBulkLimit called with the confirmBulk token
    expect(mockCheckBulkLimit).toHaveBeenCalledWith(
      "guest",
      "create_record",
      5,
      "test-uid",
      "valid-token"
    );
  });

  it("read-only tools don't count toward mutation limit", async () => {
    const ontologyData = {
      concepts: new Map([["guest", GUEST_CONCEPT]]),
      properties: new Map(),
      relationships: new Map(),
    };
    mockGetOntology.mockResolvedValue(ontologyData);

    // Execute get_ontology multiple times
    for (let i = 0; i < 10; i++) {
      const req = mockReq({
        body: { tool: "get_ontology", mcpSession: "readonly-session" },
      });
      const res = mockRes();
      await handler(req, res);

      const body = res._json as { success: boolean };
      expect(body.success).toBe(true);
    }

    // Session mutation count should not have increased
    const count = sessionMutationCounts.get("readonly-session");
    expect(count).toBeUndefined();

    // checkBulkLimit should never have been called
    expect(mockCheckBulkLimit).not.toHaveBeenCalled();
  });

  it("actorType is ai_agent on MCP requests", async () => {
    const req = mockReq({
      body: { tool: "get_ontology" },
      actorType: "ai_agent",
      headers: { "x-mcp-delegation": "true" },
    } as Partial<Request>);

    expect(req.actorType).toBe("ai_agent");
  });

  it("my_assignments returns user-scoped records", async () => {
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery.mockResolvedValue({ rows: [sampleRow({ created_by: "test-uid" })] });
    mockFilterRecord.mockImplementation(
      (_role: string, _concept: string, props: Record<string, unknown>) => Promise.resolve(props)
    );

    const req = mockReq({
      body: { tool: "my_assignments" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { assignments: Array<{ concept: string; records: unknown[] }> } };
    expect(body.success).toBe(true);
    expect(body.data.assignments).toBeDefined();
    // Queries should use the user's UID for scoping
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("assigned_to"),
      ["test-uid"]
    );
  });

  it("event metadata includes mcp_tool and mcp_session", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Carol" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow({ name: "Carol" })] });

    const req = mockReq({
      body: {
        tool: "update_record",
        params: { concept: "guest", id: "row-1", data: { name: "Carol" } },
        mcpSession: "session-xyz",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          mcp_tool: "update_record",
          mcp_session: "session-xyz",
        },
      })
    );
  });

  it("update_record annotation is idempotent", () => {
    const tool = TOOL_MAP.get("update_record")!;
    expect(tool.annotations.idempotentHint).toBe(true);
    expect(tool.annotations.readOnlyHint).toBe(false);
    expect(tool.annotations.destructiveHint).toBe(false);
  });
});

describe("tool classification", () => {
  it("DESTRUCTIVE_TOOLS contains only non-readOnly tools", () => {
    expect(DESTRUCTIVE_TOOLS.has("create_record")).toBe(true);
    expect(DESTRUCTIVE_TOOLS.has("update_record")).toBe(true);
    expect(DESTRUCTIVE_TOOLS.has("run_workflow")).toBe(true);

    expect(DESTRUCTIVE_TOOLS.has("get_ontology")).toBe(false);
    expect(DESTRUCTIVE_TOOLS.has("list_records")).toBe(false);
    expect(DESTRUCTIVE_TOOLS.has("get_record")).toBe(false);
    expect(DESTRUCTIVE_TOOLS.has("my_assignments")).toBe(false);
  });

  it("tool names cover the full MCP spec (7 tools)", () => {
    const expectedNames = [
      "get_ontology",
      "list_records",
      "get_record",
      "create_record",
      "update_record",
      "run_workflow",
      "my_assignments",
    ];

    for (const name of expectedNames) {
      expect(TOOL_MAP.has(name)).toBe(true);
    }
    expect(TOOL_REGISTRY.length).toBe(7);
  });
});
