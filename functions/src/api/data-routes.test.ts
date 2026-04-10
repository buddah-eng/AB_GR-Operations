/**
 * Tests for Data Routes API Router
 *
 * Covers:
 * - GET / — list data routes
 * - GET /:id — get single route
 * - POST / — create route with audit + events
 * - PUT /:id — update route with audit + events
 * - DELETE /:id — delete route with audit + events
 * - Auth enforcement on mutations
 * - 404 handling
 * - Validation of required fields
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

const mockListRoutes = vi.fn();
const mockGetRouteById = vi.fn();
const mockCreateRoute = vi.fn();
const mockUpdateRoute = vi.fn();
const mockDeleteRoute = vi.fn();

vi.mock("../data-routing/service", () => ({
  listRoutes: (...args: unknown[]) => mockListRoutes(...args),
  getRouteById: (...args: unknown[]) => mockGetRouteById(...args),
  createRoute: (...args: unknown[]) => mockCreateRoute(...args),
  updateRoute: (...args: unknown[]) => mockUpdateRoute(...args),
  deleteRoute: (...args: unknown[]) => mockDeleteRoute(...args),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    const input = args[0] as Record<string, unknown>;
    return { eventId: "evt-dr-1", eventName: input.eventName, ...input };
  },
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

import { dataRoutesRouter } from "./data-routes";

// --- Fixtures ---

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "human" as const,
  changeSet: "cs-dr-123",
};

// --- Mock request/response helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "admin@example.com" },
    role: { roleKey: "coordinator", roleName: "Coordinator", priority: 10 },
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
  const router = dataRoutesRouter as any;
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
// GET / — list data routes
// ============================================================

describe("GET /", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("get", "/");
  });

  it("returns list of data routes", async () => {
    const routes = [
      { id: "r-1", name: "Guest to Report", source_concept: "guest", active: true },
    ];
    mockListRoutes.mockResolvedValue(routes);

    const req = mockReq({ query: { source_concept: "guest" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(mockListRoutes).toHaveBeenCalledWith(
      expect.objectContaining({ source_concept: "guest" })
    );
  });
});

// ============================================================
// GET /:id — get single route
// ============================================================

describe("GET /:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("get", "/:id");
  });

  it("returns 404 when route not found", async () => {
    mockGetRouteById.mockResolvedValue(null);

    const req = mockReq({ params: { id: "route-missing" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("not found");
  });

  it("returns route when found", async () => {
    const route = { id: "r-1", name: "Test Route" };
    mockGetRouteById.mockResolvedValue(route);

    const req = mockReq({ params: { id: "r-1" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("r-1");
  });
});

// ============================================================
// POST / — create route
// ============================================================

describe("POST /", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("post", "/");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates route with audit context and fires event", async () => {
    const created = { id: "r-new", name: "New Route", source_concept: "guest", dest_concept: "report" };
    mockCreateRoute.mockResolvedValue(created);

    const req = mockReq({
      body: {
        name: "New Route",
        source_concept: "guest",
        dest_concept: "report",
        trigger_event: "guest.created",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("r-new");

    expect(mockLogAuditClaim).toHaveBeenCalledWith(AUDIT_CTX, "POST /api/data-routes");
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "data_route.created",
        changeSet: "cs-dr-123",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when required fields missing", async () => {
    const req = mockReq({ body: { name: "Incomplete" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Missing required fields");
  });
});

// ============================================================
// PUT /:id — update route
// ============================================================

describe("PUT /:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("put", "/:id");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("updates route and fires event", async () => {
    const updated = { id: "r-1", name: "Updated Route" };
    mockUpdateRoute.mockResolvedValue(updated);

    const req = mockReq({
      params: { id: "r-1" },
      body: { name: "Updated Route" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("r-1");

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "data_route.updated" })
    );
  });
});

// ============================================================
// DELETE /:id — delete route
// ============================================================

describe("DELETE /:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("delete", "/:id");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("deletes route and fires event", async () => {
    mockDeleteRoute.mockResolvedValue(true);

    const req = mockReq({ params: { id: "r-1" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string; deleted: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "data_route.deleted" })
    );
  });

  it("returns 404 when route not found", async () => {
    mockDeleteRoute.mockResolvedValue(false);

    const req = mockReq({ params: { id: "r-missing" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ============================================================
// Auth enforcement
// ============================================================

describe("Auth enforcement on mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = true;
  });

  it("POST / rejects without coordinator role", async () => {
    const req = mockReq({
      body: {
        name: "Test",
        source_concept: "guest",
        dest_concept: "report",
        trigger_event: "guest.created",
      },
    });
    const res = mockRes();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = dataRoutesRouter as any;
    const stack = router.stack as Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (...args: unknown[]) => unknown }>;
      };
    }>;

    const route = stack.find(
      (l) => l.route?.path === "/" && l.route?.methods.post
    );
    const roleMiddleware = route?.route?.stack[0]?.handle;

    if (roleMiddleware) {
      await roleMiddleware(req, res, () => {});
    }

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Insufficient permissions");
  });
});
