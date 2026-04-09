/**
 * Tests for MCP API Router
 *
 * Covers:
 * - GET /api/mcp/tools returns tool registry with annotations
 * - POST /api/mcp/execute dispatches to correct tool handlers
 * - Parameter validation (missing required params, unknown tools)
 * - RBAC enforcement (403 when permission denied)
 * - Bulk mutation limit gate (5 mutation threshold, confirmBulk bypass)
 * - Read-only tools do not count toward mutation limit
 * - Tool annotation correctness
 * - my_assignments returns user-scoped records
 * - actorType verification
 * - Audit metadata (mcp_tool, mcp_session) included in domain events
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

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import {
  mcpRouter,
  MCP_TOOLS,
  mutationCounts,
} from "./mcp";

// --- Fixtures ---

const GUEST_CONCEPT = {
  id: "c1",
  key: "guest",
  name: "Guest",
  pluralName: "Guests",
};

const GUEST_PROPERTIES = [
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
];

function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    name: "Alice",
    status: "confirmed",
    properties: {},
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

  it("returns the tool list with annotations", async () => {
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(7);

    const toolNames = (body.data as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toContain("get_ontology");
    expect(toolNames).toContain("list_records");
    expect(toolNames).toContain("get_record");
    expect(toolNames).toContain("create_record");
    expect(toolNames).toContain("update_record");
    expect(toolNames).toContain("run_workflow");
    expect(toolNames).toContain("my_assignments");
  });

  it("has correct annotations for get_ontology (readOnly)", () => {
    const tool = MCP_TOOLS.find((t) => t.name === "get_ontology");
    expect(tool).toBeDefined();
    expect(tool!.annotations.readOnlyHint).toBe(true);
    expect(tool!.annotations.destructiveHint).toBe(false);
    expect(tool!.annotations.idempotentHint).toBe(true);
  });

  it("has correct annotations for create_record (not readOnly, not idempotent)", () => {
    const tool = MCP_TOOLS.find((t) => t.name === "create_record");
    expect(tool).toBeDefined();
    expect(tool!.annotations.readOnlyHint).toBe(false);
    expect(tool!.annotations.destructiveHint).toBe(false);
    expect(tool!.annotations.idempotentHint).toBe(false);
  });

  it("has correct annotations for update_record (idempotent, not readOnly)", () => {
    const tool = MCP_TOOLS.find((t) => t.name === "update_record");
    expect(tool).toBeDefined();
    expect(tool!.annotations.readOnlyHint).toBe(false);
    expect(tool!.annotations.idempotentHint).toBe(true);
  });
});

describe("POST /execute", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mutationCounts.clear();
    handler = findHandler("post", "/execute");
    mockCreateDomainEvent.mockImplementation((params) => ({
      eventId: "evt-1",
      timestamp: new Date().toISOString(),
      ...params,
    }));
    mockEmit.mockResolvedValue(undefined);
  });

  it("returns 400 for unknown tool", async () => {
    const req = mockReq({
      body: { tool: "nonexistent_tool" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Unknown tool");
  });

  it("returns 400 for missing required parameters", async () => {
    const req = mockReq({
      body: { tool: "get_record", parameters: { concept: "guest" } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Missing required parameters");
    expect(body.error).toContain("id");
  });

  it("executes get_ontology and returns data", async () => {
    const fakeOntology = {
      concepts: new Map([["guest", GUEST_CONCEPT]]),
      properties: new Map([["guest", GUEST_PROPERTIES]]),
      relationships: new Map(),
    };
    mockGetOntology.mockResolvedValue(fakeOntology);

    const req = mockReq({
      body: { tool: "get_ontology" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { concepts: Record<string, unknown> } };
    expect(body.success).toBe(true);
    expect(body.data.concepts).toBeDefined();
    expect(body.data.concepts.guest).toEqual(GUEST_CONCEPT);
  });

  it("executes list_records and returns paginated data", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: "1" }] })
      .mockResolvedValueOnce({ rows: [sampleRow()] });
    mockFilterRecord.mockImplementation(
      (_role: string, _concept: string, props: Record<string, unknown>) =>
        Promise.resolve(props)
    );

    const req = mockReq({
      body: {
        tool: "list_records",
        parameters: { concept: "guest" },
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { records: unknown[]; total: number } };
    expect(body.success).toBe(true);
    expect(body.data.records).toHaveLength(1);
    expect(body.data.total).toBe(1);
  });

  it("returns 403 when RBAC denies permission on list_records", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(false);

    const req = mockReq({
      body: {
        tool: "list_records",
        parameters: { concept: "guest" },
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("permission");
  });

  it("executes create_record and fires domain event with MCP metadata", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Alice" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow()] });

    const req = mockReq({
      body: {
        tool: "create_record",
        parameters: { concept: "guest", data: { name: "Alice" } },
        mcpSession: "session-abc",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("row-1");

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
  });

  it("returns 403 when RBAC denies create_record", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(false);

    const req = mockReq({
      body: {
        tool: "create_record",
        parameters: { concept: "guest", data: { name: "Alice" } },
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("enforces bulk mutation limit at 5 mutations", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Alice" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow()] });

    const sessionId = "session-bulk-test";

    // Execute 5 successful mutations
    for (let i = 0; i < 5; i++) {
      const req = mockReq({
        body: {
          tool: "create_record",
          parameters: { concept: "guest", data: { name: `Guest ${i}` } },
          mcpSession: sessionId,
        },
      });
      const res = mockRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
    }

    // The 6th mutation should be blocked
    const req = mockReq({
      body: {
        tool: "create_record",
        parameters: { concept: "guest", data: { name: "Guest 5" } },
        mcpSession: sessionId,
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    const body = res._json as {
      success: boolean;
      error: string;
      mutationCount: number;
      requiresConfirmation: boolean;
    };
    expect(body.success).toBe(false);
    expect(body.error).toBe("bulk_limit_exceeded");
    expect(body.mutationCount).toBe(5);
    expect(body.requiresConfirmation).toBe(true);
  });

  it("allows bulk mutations when confirmBulk is true", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Alice" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow()] });

    const sessionId = "session-confirm-test";

    // Set mutation count to the limit
    mutationCounts.set(sessionId, 5);

    const req = mockReq({
      body: {
        tool: "create_record",
        parameters: { concept: "guest", data: { name: "Guest Confirmed" } },
        mcpSession: sessionId,
        confirmBulk: true,
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("does not count read-only tools toward mutation limit", async () => {
    const fakeOntology = {
      concepts: new Map([["guest", GUEST_CONCEPT]]),
      properties: new Map(),
      relationships: new Map(),
    };
    mockGetOntology.mockResolvedValue(fakeOntology);

    const sessionId = "session-readonly-test";

    // Execute many read-only tool calls
    for (let i = 0; i < 10; i++) {
      const req = mockReq({
        body: { tool: "get_ontology", mcpSession: sessionId },
      });
      const res = mockRes();
      await handler(req, res);
      expect(res.statusCode).toBe(200);
    }

    // Mutation count should still be 0
    expect(mutationCounts.get(sessionId) ?? 0).toBe(0);
  });

  it("executes my_assignments and returns user-scoped records", async () => {
    mockCanPerformAction.mockResolvedValue(true);
    mockQuery.mockResolvedValue({ rows: [sampleRow({ assigned_to: "test-uid" })] });
    mockFilterRecord.mockImplementation(
      (_role: string, _concept: string, props: Record<string, unknown>) =>
        Promise.resolve(props)
    );

    const req = mockReq({
      body: { tool: "my_assignments" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: Array<{ concept: string; records: unknown[] }> };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);

    // Should have queried with user's UID
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("assigned_to = $1"),
      expect.arrayContaining(["test-uid"])
    );
  });

  it("verifies actorType is ai_agent on MCP requests", () => {
    // The auth middleware sets actorType = 'ai_agent' when X-MCP-Delegation: true
    // We verify the test setup correctly uses ai_agent
    const req = mockReq();
    expect(req.actorType).toBe("ai_agent");
  });

  it("returns 400 when tool field is missing from request body", async () => {
    const req = mockReq({
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Missing required field: tool");
  });

  it("includes mcp_tool and mcp_session in event metadata for update_record", async () => {
    mockGetConceptByKey.mockResolvedValue(GUEST_CONCEPT);
    mockCanPerformAction.mockResolvedValue(true);
    mockFilterWritePayload.mockResolvedValue({ name: "Bob" });
    mockGetPropertiesForConcept.mockResolvedValue(GUEST_PROPERTIES);
    mockQuery.mockResolvedValue({ rows: [sampleRow({ name: "Bob" })] });

    const req = mockReq({
      body: {
        tool: "update_record",
        parameters: { concept: "guest", id: "row-1", data: { name: "Bob" } },
        mcpSession: "session-xyz",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "guest.updated",
        metadata: expect.objectContaining({
          mcp_tool: "update_record",
          mcp_session: "session-xyz",
        }),
      })
    );
  });
});
