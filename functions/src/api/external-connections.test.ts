/**
 * Tests for External Connections API Router
 *
 * Covers:
 * - GET / lists connections
 * - POST / creates connection with audit + events
 * - POST /:id/sync triggers manual sync
 * - GET /:id/sync-state returns sync state
 * - Validation of required fields
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockListConnections = vi.fn();
const mockGetConnectionById = vi.fn();
const mockCreateConnection = vi.fn();
const mockUpdateConnection = vi.fn();
const mockDeleteConnection = vi.fn();
const mockExecuteInboundSync = vi.fn();
const mockExecuteOutboundPush = vi.fn();
const mockGetSyncState = vi.fn();

vi.mock("../pipelines/external", () => ({
  listConnections: (...args: unknown[]) => mockListConnections(...args),
  getConnectionById: (...args: unknown[]) => mockGetConnectionById(...args),
  createConnection: (...args: unknown[]) => mockCreateConnection(...args),
  updateConnection: (...args: unknown[]) => mockUpdateConnection(...args),
  deleteConnection: (...args: unknown[]) => mockDeleteConnection(...args),
  executeInboundSync: (...args: unknown[]) => mockExecuteInboundSync(...args),
  executeOutboundPush: (...args: unknown[]) => mockExecuteOutboundPush(...args),
  getSyncState: (...args: unknown[]) => mockGetSyncState(...args),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
}));

const mockEmit = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: vi.fn((input: Record<string, unknown>) => ({
    eventId: "evt-ec-1",
    eventName: input.eventName,
    ...input,
  })),
}));

let mockRequireRoleReject = false;
vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (req: Request, res: Response, next: () => void) => {
    if (mockRequireRoleReject) {
      res.status(403).json({ success: false, error: "Insufficient permissions for this action." });
      return;
    }
    next();
  },
}));

// --- Import module under test ---

import { externalConnectionsRouter } from "./external-connections";

// --- Fixtures ---

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "human" as const,
  changeSet: "cs-ec-123",
};

// --- Helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "director@example.com" },
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

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  const router = externalConnectionsRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (...args: unknown[]) => unknown }>;
      };
    }>;
  };

  for (const layer of router.stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

// ============================================================
// Tests
// ============================================================

describe("GET /", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
  });

  it("returns list of connections", async () => {
    const connections = [{ id: "conn-1", name: "FlightAware" }];
    mockListConnections.mockResolvedValue(connections);

    const req = mockReq();
    const res = mockRes();

    await findHandler("get", "/")(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

describe("POST /", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates connection with audit context", async () => {
    const created = { id: "conn-new", name: "New Provider" };
    mockCreateConnection.mockResolvedValue(created);

    const req = mockReq({
      body: {
        name: "New Provider",
        provider: "test",
        endpoint_url: "https://api.test.com",
        auth_method: "api_key",
        direction: "inbound",
        concept_key: "guest",
      },
    });
    const res = mockRes();

    await findHandler("post", "/")(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("conn-new");
  });

  it("returns 400 when required fields missing", async () => {
    const req = mockReq({ body: { name: "Incomplete" } });
    const res = mockRes();

    await findHandler("post", "/")(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("POST /:id/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
  });

  it("triggers inbound sync", async () => {
    mockExecuteInboundSync.mockResolvedValue({ recordsSynced: 5, errors: [] });

    const req = mockReq({ params: { id: "conn-1" } });
    const res = mockRes();

    await findHandler("post", "/:id/sync")(req, res);

    const body = res._json as { success: boolean; data: { recordsSynced: number } };
    expect(body.success).toBe(true);
    expect(body.data.recordsSynced).toBe(5);
  });
});

describe("GET /:id/sync-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
  });

  it("returns sync state when it exists", async () => {
    mockGetSyncState.mockResolvedValue({
      id: "ss-1",
      connection_id: "conn-1",
      status: "idle",
      records_synced: 42,
    });

    const req = mockReq({ params: { id: "conn-1" } });
    const res = mockRes();

    await findHandler("get", "/:id/sync-state")(req, res);

    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("idle");
  });

  it("returns never_synced when no state exists", async () => {
    mockGetSyncState.mockResolvedValue(null);

    const req = mockReq({ params: { id: "conn-new" } });
    const res = mockRes();

    await findHandler("get", "/:id/sync-state")(req, res);

    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("never_synced");
  });
});
