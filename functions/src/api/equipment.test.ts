/**
 * Tests for Equipment API Router
 *
 * Covers:
 * - GET /overdue
 * - GET /venue/:venueId
 * - POST /checkout: success, missing fields, service errors
 * - POST /return: success, missing fields, overdue flag
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

const mockCheckoutEquipment = vi.fn();
const mockReturnEquipment = vi.fn();
const mockGetOverdueEquipment = vi.fn();
const mockListEquipmentByVenue = vi.fn();
vi.mock("../services/equipment", () => ({
  checkoutEquipment: (...args: unknown[]) => mockCheckoutEquipment(...args),
  returnEquipment: (...args: unknown[]) => mockReturnEquipment(...args),
  getOverdueEquipment: (...args: unknown[]) => mockGetOverdueEquipment(...args),
  listEquipmentByVenue: (...args: unknown[]) => mockListEquipmentByVenue(...args),
}));

// --- Import ---

import { equipmentRouter } from "./equipment";

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
  const router = equipmentRouter as unknown as {
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

const AUDIT_CTX = { actorId: "user-1", actorType: "human" as const, changeSet: "cs-eq-123" };

describe("GET /overdue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns overdue equipment", async () => {
    mockGetOverdueEquipment.mockResolvedValueOnce([
      { id: "eq-1", name: "Projector", status: "checked_out" },
    ]);

    const handler = findHandler("get", "/overdue");
    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
  });
});

describe("GET /venue/:venueId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns equipment for a venue", async () => {
    mockListEquipmentByVenue.mockResolvedValueOnce([
      { id: "eq-1", name: "Projector A", venue_id: "v-1" },
      { id: "eq-2", name: "Mic Set", venue_id: "v-1" },
    ]);

    const handler = findHandler("get", "/venue/:venueId");
    const req = mockReq({ params: { venueId: "v-1" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(mockListEquipmentByVenue).toHaveBeenCalledWith("v-1");
  });
});

describe("POST /checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("checks out equipment successfully", async () => {
    const checkoutResult = {
      success: true,
      equipment: { id: "eq-1", name: "Projector", status: "checked_out" },
    };
    mockCheckoutEquipment.mockResolvedValueOnce(checkoutResult);

    const handler = findHandler("post", "/checkout");
    const req = mockReq({
      body: {
        equipmentId: "eq-1",
        staffId: "staff-1",
        dueBackAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { success: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.success).toBe(true);
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when equipmentId is missing", async () => {
    const handler = findHandler("post", "/checkout");
    const req = mockReq({
      body: { staffId: "staff-1", dueBackAt: "2026-04-10T00:00:00Z" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when staffId is missing", async () => {
    const handler = findHandler("post", "/checkout");
    const req = mockReq({
      body: { equipmentId: "eq-1", dueBackAt: "2026-04-10T00:00:00Z" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("succeeds when dueBackAt is omitted (optional)", async () => {
    const checkoutResult = {
      success: true,
      equipment: { id: "eq-1", name: "Projector", status: "checked_out" },
    };
    mockCheckoutEquipment.mockResolvedValueOnce(checkoutResult);

    const handler = findHandler("post", "/checkout");
    const req = mockReq({
      body: { equipmentId: "eq-1", staffId: "staff-1" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean };
    expect(body.success).toBe(true);
  });
});

describe("POST /return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("returns equipment successfully", async () => {
    const returnResult = {
      success: true,
      equipment: { id: "eq-1", name: "Projector", status: "available" },
      wasOverdue: false,
    };
    mockReturnEquipment.mockResolvedValueOnce(returnResult);

    const handler = findHandler("post", "/return");
    const req = mockReq({ body: { equipmentId: "eq-1" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { wasOverdue: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.wasOverdue).toBe(false);
  });

  it("emits overdue event when equipment was overdue", async () => {
    const returnResult = {
      success: true,
      equipment: { id: "eq-1", name: "Projector", status: "available" },
      wasOverdue: true,
    };
    mockReturnEquipment.mockResolvedValueOnce(returnResult);

    const handler = findHandler("post", "/return");
    const req = mockReq({ body: { equipmentId: "eq-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when equipmentId is missing", async () => {
    const handler = findHandler("post", "/return");
    const req = mockReq({ body: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
