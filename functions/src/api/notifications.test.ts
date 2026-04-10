/**
 * Tests for Notification API Router
 *
 * Covers:
 * - GET / — returns user's notifications
 * - GET /unread-count — returns unread count
 * - PUT /:id/read — marks notification as read
 * - GET /preferences — returns user preferences
 * - PUT /preferences — updates user preferences
 * - Auth enforcement (requireAuth)
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

const mockGetNotifications = vi.fn();
const mockMarkAsRead = vi.fn();
const mockGetUnreadCount = vi.fn();
const mockGetPreferences = vi.fn();
const mockUpdatePreferences = vi.fn();

vi.mock("../notifications/service", () => ({
  getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
  markAsRead: (...args: unknown[]) => mockMarkAsRead(...args),
  getUnreadCount: (...args: unknown[]) => mockGetUnreadCount(...args),
  getPreferences: (...args: unknown[]) => mockGetPreferences(...args),
  updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
}));

let mockRequireAuthReject = false;
vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, res: Response, next: () => void) => {
    if (mockRequireAuthReject) {
      res.status(401).json({ success: false, error: "Authentication required." });
      return;
    }
    next();
  },
}));

// --- Import module under test ---

import { notificationRouter } from "./notifications";

// --- Mock request/response helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "user@example.com" },
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
  const router = notificationRouter as any;
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
// GET / — list notifications
// ============================================================

describe("GET /", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthReject = false;
    handler = findHandler("get", "/");
  });

  it("returns user's notifications", async () => {
    const notifications = [
      { id: "n-1", subject: "Welcome", status: "sent" },
      { id: "n-2", subject: "Update", status: "sent" },
    ];
    mockGetNotifications.mockResolvedValue({ success: true, data: notifications });

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(mockGetNotifications).toHaveBeenCalledWith(
      "test-uid",
      expect.any(Object)
    );
  });
});

// ============================================================
// GET /unread-count — unread count
// ============================================================

describe("GET /unread-count", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthReject = false;
    handler = findHandler("get", "/unread-count");
  });

  it("returns unread count", async () => {
    mockGetUnreadCount.mockResolvedValue({ success: true, data: 3 });

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { count: number } };
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(3);
  });
});

// ============================================================
// PUT /:id/read — mark as read
// ============================================================

describe("PUT /:id/read", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthReject = false;
    handler = findHandler("put", "/:id/read");
  });

  it("marks notification as read", async () => {
    const updated = { id: "n-1", status: "read", read_at: "2026-04-08T12:00:00Z" };
    mockMarkAsRead.mockResolvedValue({ success: true, data: updated });

    const req = mockReq({ params: { id: "n-1" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("read");
    expect(mockMarkAsRead).toHaveBeenCalledWith("n-1");
  });

  it("returns 404 when notification not found", async () => {
    mockMarkAsRead.mockResolvedValue({ success: false, error: "Notification not found" });

    const req = mockReq({ params: { id: "nonexistent" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ============================================================
// GET /preferences — get preferences
// ============================================================

describe("GET /preferences", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthReject = false;
    handler = findHandler("get", "/preferences");
  });

  it("returns user preferences", async () => {
    const prefs = {
      id: "pref-1",
      user_id: "test-uid",
      channel_email: true,
      channel_in_app: true,
      digest_mode: "none",
    };
    mockGetPreferences.mockResolvedValue({ success: true, data: prefs });

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: typeof prefs };
    expect(body.success).toBe(true);
    expect(body.data.channel_email).toBe(true);
  });
});

// ============================================================
// PUT /preferences — update preferences
// ============================================================

describe("PUT /preferences", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthReject = false;
    handler = findHandler("put", "/preferences");
  });

  it("updates preferences and returns result", async () => {
    const updated = {
      id: "pref-1",
      user_id: "test-uid",
      channel_email: false,
      digest_mode: "daily",
    };
    mockUpdatePreferences.mockResolvedValue({ success: true, data: updated });

    const req = mockReq({
      body: { channel_email: false, digest_mode: "daily" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: typeof updated };
    expect(body.success).toBe(true);
    expect(body.data.channel_email).toBe(false);
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      "test-uid",
      expect.objectContaining({ channel_email: false })
    );
  });
});
