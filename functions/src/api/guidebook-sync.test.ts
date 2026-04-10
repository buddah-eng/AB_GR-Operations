/**
 * Tests for Guidebook Sync API Router
 *
 * Covers:
 * - GET /status: returns recent sync logs
 * - POST /publish: success, missing syncType, invalid syncType
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

const mockPublishToGuidebook = vi.fn();
const mockGetPublishStatus = vi.fn();
vi.mock("../services/guidebook-sync", () => ({
  publishToGuidebook: (...args: unknown[]) => mockPublishToGuidebook(...args),
  getPublishStatus: (...args: unknown[]) => mockGetPublishStatus(...args),
}));

// --- Import ---

import { guidebookSyncRouter } from "./guidebook-sync";

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
  const router = guidebookSyncRouter as unknown as {
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

const AUDIT_CTX = { actorId: "user-1", actorType: "human" as const, changeSet: "cs-gb-123" };

// --- Tests ---

describe("GET /status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recent sync logs", async () => {
    mockGetPublishStatus.mockResolvedValueOnce([
      { id: "log-1", sync_type: "schedule", records_pushed: 25, status: "completed" },
      { id: "log-2", sync_type: "guest_bios", records_pushed: 30, status: "completed" },
    ]);

    const handler = findHandler("get", "/status");
    const req = mockReq({ query: {} });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
  });

  it("passes limit parameter", async () => {
    mockGetPublishStatus.mockResolvedValueOnce([]);

    const handler = findHandler("get", "/status");
    const req = mockReq({ query: { limit: "5" } });
    const res = mockRes();

    await handler(req, res);

    expect(mockGetPublishStatus).toHaveBeenCalledWith(5);
  });

  it("defaults limit to 10", async () => {
    mockGetPublishStatus.mockResolvedValueOnce([]);

    const handler = findHandler("get", "/status");
    const req = mockReq({ query: {} });
    const res = mockRes();

    await handler(req, res);

    expect(mockGetPublishStatus).toHaveBeenCalledWith(10);
  });
});

describe("POST /publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
  });

  it("publishes schedule data", async () => {
    mockPublishToGuidebook.mockResolvedValueOnce({
      syncLogId: "log-new",
      syncType: "schedule",
      recordsPushed: 15,
      status: "completed",
    });

    const handler = findHandler("post", "/publish");
    const req = mockReq({ body: { syncType: "schedule" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { syncType: string; recordsPushed: number } };
    expect(body.success).toBe(true);
    expect(body.data.syncType).toBe("schedule");
    expect(body.data.recordsPushed).toBe(15);
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("publishes full sync", async () => {
    mockPublishToGuidebook.mockResolvedValueOnce({
      syncLogId: "log-full",
      syncType: "full",
      recordsPushed: 50,
      status: "completed",
    });

    const handler = findHandler("post", "/publish");
    const req = mockReq({ body: { syncType: "full" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { syncType: string } };
    expect(body.success).toBe(true);
    expect(body.data.syncType).toBe("full");
  });

  it("returns 400 when syncType is missing", async () => {
    const handler = findHandler("post", "/publish");
    const req = mockReq({ body: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  it("returns 400 when syncType is invalid", async () => {
    const handler = findHandler("post", "/publish");
    const req = mockReq({ body: { syncType: "invalid" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });
});
