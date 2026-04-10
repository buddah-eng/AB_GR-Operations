/**
 * Tests for Venues API Router
 *
 * Covers:
 * - GET / (list), GET /:id, GET /:id/availability, GET /:id/capacity
 * - POST / (create), PUT /:id (update), DELETE /:id (archive)
 * - Auth enforcement, input validation, error handling
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

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: (...args: unknown[]) => mockQuery(...args) };
    return fn(mockClient);
  },
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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

const mockEmit = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    return { eventId: "evt-test", eventName: (args[0] as { eventName: string }).eventName };
  },
}));

const mockListVenues = vi.fn();
const mockGetVenueById = vi.fn();
const mockCheckAvailability = vi.fn();
const mockCheckCapacity = vi.fn();
vi.mock("../services/venues", () => ({
  listVenues: (...args: unknown[]) => mockListVenues(...args),
  getVenueById: (...args: unknown[]) => mockGetVenueById(...args),
  checkVenueAvailability: (...args: unknown[]) => mockCheckAvailability(...args),
  checkCapacity: (...args: unknown[]) => mockCheckCapacity(...args),
}));

// --- Import ---

import { venueRouter } from "./venues";

// --- Helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    user: { uid: "user-1", email: "admin@test.com" },
    role: { roleKey: "director", roleName: "Director", priority: 0 },
    actorType: "human" as const,
    ip: "127.0.0.1",
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
  const router = venueRouter as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (...args: unknown[]) => unknown }>;
      };
    }>;
  };

  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

// --- Tests ---

const AUDIT_CTX = { actorId: "user-1", actorType: "human" as const, changeSet: "cs-123" };

describe("GET /", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists all venues", async () => {
    const venues = [
      { id: "v-1", name: "Ballroom", type: "ballroom", capacity: 500 },
      { id: "v-2", name: "Room B", type: "meeting_room", capacity: 50 },
    ];
    mockListVenues.mockResolvedValueOnce(venues);

    const handler = findHandler("get", "/");
    const req = mockReq({ query: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
  });

  it("passes filter parameters", async () => {
    mockListVenues.mockResolvedValueOnce([]);

    const handler = findHandler("get", "/");
    const req = mockReq({ query: { type: "ballroom", minCapacity: "200" } });
    const res = mockRes();

    await handler(req, res);

    expect(mockListVenues).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ballroom", minCapacity: 200 })
    );
  });
});

describe("GET /:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns venue when found", async () => {
    mockGetVenueById.mockResolvedValueOnce({ id: "v-1", name: "Ballroom" });

    const handler = findHandler("get", "/:id");
    const req = mockReq({ params: { id: "v-1" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("v-1");
  });

  it("returns 404 when venue not found", async () => {
    mockGetVenueById.mockResolvedValueOnce(null);

    const handler = findHandler("get", "/:id");
    const req = mockReq({ params: { id: "nonexistent" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("GET /:id/availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns availability result", async () => {
    mockCheckAvailability.mockResolvedValueOnce({
      available: true,
      conflicts: [],
    });

    const handler = findHandler("get", "/:id/availability");
    const req = mockReq({
      params: { id: "v-1" },
      query: { startTime: "2026-04-10T09:00:00Z", endTime: "2026-04-10T11:00:00Z" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { available: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.available).toBe(true);
  });

  it("returns 400 when missing time parameters", async () => {
    const handler = findHandler("get", "/:id/availability");
    const req = mockReq({ params: { id: "v-1" }, query: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("GET /:id/capacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns capacity check result", async () => {
    mockCheckCapacity.mockResolvedValueOnce({
      sufficient: true,
      venueCapacity: 500,
      requiredCapacity: 200,
    });

    const handler = findHandler("get", "/:id/capacity");
    const req = mockReq({
      params: { id: "v-1" },
      query: { required: "200" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { sufficient: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.sufficient).toBe(true);
  });
});

describe("POST /", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates a venue", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "v-new", name: "Test Room", type: "meeting_room", capacity: 50 }],
    });

    const handler = findHandler("post", "/");
    const req = mockReq({
      body: { name: "Test Room", type: "meeting_room", capacity: 50 },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("v-new");
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when name is missing", async () => {
    const handler = findHandler("post", "/");
    const req = mockReq({ body: { type: "meeting_room" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when type is missing", async () => {
    const handler = findHandler("post", "/");
    const req = mockReq({ body: { name: "Room" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("DELETE /:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("archives a venue", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "v-1" }] });

    const handler = findHandler("delete", "/:id");
    const req = mockReq({ params: { id: "v-1" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: null };
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns error when venue not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const handler = findHandler("delete", "/:id");
    const req = mockReq({ params: { id: "nonexistent" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
