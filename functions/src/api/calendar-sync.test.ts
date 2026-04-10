/**
 * Tests for Calendar Sync API Router
 *
 * Covers:
 * - GET /status/:department: found, not found
 * - POST /push: success, missing department
 * - POST /pull: success, missing department
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

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
}));

const mockSyncToGoogleCalendar = vi.fn();
const mockSyncFromGoogleCalendar = vi.fn();
const mockGetSyncState = vi.fn();
vi.mock("../services/calendar-sync", () => ({
  syncToGoogleCalendar: (...args: unknown[]) => mockSyncToGoogleCalendar(...args),
  syncFromGoogleCalendar: (...args: unknown[]) => mockSyncFromGoogleCalendar(...args),
  getSyncState: (...args: unknown[]) => mockGetSyncState(...args),
}));

// --- Import ---

import { calendarSyncRouter } from "./calendar-sync";

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
  const router = calendarSyncRouter as unknown as {
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

const AUDIT_CTX = { actorId: "user-1", actorType: "human" as const, changeSet: "cs-cal-123" };

// --- Tests ---

describe("GET /status/:department", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sync state when found", async () => {
    mockGetSyncState.mockResolvedValueOnce({
      department: "gr",
      status: "idle",
      last_sync_at: "2026-04-07T12:00:00Z",
      records_synced: 10,
    });

    const handler = findHandler("get", "/status/:department");
    const req = mockReq({ params: { department: "gr" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { department: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.department).toBe("gr");
    expect(body.data.status).toBe("idle");
  });

  it("returns never_synced when no state exists", async () => {
    mockGetSyncState.mockResolvedValueOnce(null);

    const handler = findHandler("get", "/status/:department");
    const req = mockReq({ params: { department: "new-dept" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("never_synced");
  });
});

describe("POST /push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
  });

  it("triggers push sync", async () => {
    mockSyncToGoogleCalendar.mockResolvedValueOnce({
      department: "gr",
      direction: "push",
      recordsSynced: 15,
      status: "completed",
    });

    const handler = findHandler("post", "/push");
    const req = mockReq({ body: { department: "gr" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { recordsSynced: number } };
    expect(body.success).toBe(true);
    expect(body.data.recordsSynced).toBe(15);
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when department is missing", async () => {
    const handler = findHandler("post", "/push");
    const req = mockReq({ body: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("POST /pull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
  });

  it("triggers pull sync", async () => {
    mockSyncFromGoogleCalendar.mockResolvedValueOnce({
      department: "gr",
      direction: "pull",
      recordsSynced: 0,
      status: "completed",
    });

    const handler = findHandler("post", "/pull");
    const req = mockReq({ body: { department: "gr" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { direction: string } };
    expect(body.success).toBe(true);
    expect(body.data.direction).toBe("pull");
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when department is missing", async () => {
    const handler = findHandler("post", "/pull");
    const req = mockReq({ body: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
