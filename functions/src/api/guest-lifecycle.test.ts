/**
 * Tests for Guest Lifecycle API Router
 *
 * Covers:
 * - GET /  — list guests by status
 * - GET /:id  — get single guest
 * - GET /:id/summary  — get guest summary
 * - POST /  — create guest with audit + events
 * - PUT /:id/status  — transition guest status
 * - Auth and role enforcement
 * - Validation errors
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import request from "supertest";
import express from "express";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockTransitionGuestStatus = vi.fn();
const mockGetGuestsByStatus = vi.fn();
const mockGetGuestById = vi.fn();
const mockGetGuestSummary = vi.fn();
const mockCreateGuest = vi.fn();
const mockIsValidTransition = vi.fn();
const mockGetValidTransitions = vi.fn();

vi.mock("../services/guest-lifecycle", () => ({
  transitionGuestStatus: (...args: unknown[]) => mockTransitionGuestStatus(...args),
  getGuestsByStatus: (...args: unknown[]) => mockGetGuestsByStatus(...args),
  getGuestById: (...args: unknown[]) => mockGetGuestById(...args),
  getGuestSummary: (...args: unknown[]) => mockGetGuestSummary(...args),
  createGuest: (...args: unknown[]) => mockCreateGuest(...args),
  isValidTransition: (...args: unknown[]) => mockIsValidTransition(...args),
  getValidTransitions: (...args: unknown[]) => mockGetValidTransitions(...args),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
  withAuditContext: async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = {};
    return fn(mockClient);
  },
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    const input = args[0] as Record<string, unknown>;
    return { eventId: "evt-1", eventName: input.eventName, ...input };
  },
}));

let mockRequireRoleReject = false;
vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (req: Request, res: Response, next: () => void) => {
    if (mockRequireRoleReject) {
      res.status(403).json({ success: false, error: "Insufficient permissions." });
      return;
    }
    next();
  },
}));

// --- Import and setup ---

import { guestLifecycleRouter } from "./guest-lifecycle";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: "user-1", email: "admin@test.com", name: "Admin" };
    req.role = { roleKey: "director", roleName: "Director", priority: 0 };
    next();
  });
  app.use("/api/guests", guestLifecycleRouter);
  return app;
}

// --- Tests ---

describe("Guest Lifecycle API Router", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    mockAuditContextFromRequest.mockReturnValue({
      actorId: "user-1",
      actorType: "human",
      changeSet: "cs-1",
    });
    mockGetValidTransitions.mockReturnValue(["invited", "canceled"]);
    app = createApp();
  });

  describe("GET /api/guests", () => {
    it("returns guests filtered by status", async () => {
      mockGetGuestsByStatus.mockResolvedValueOnce([
        { id: "g1", name: "Guest 1", status: "draft" },
      ]);

      const res = await request(app).get("/api/guests?status=draft");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it("returns 400 for invalid status", async () => {
      const res = await request(app).get("/api/guests?status=bogus");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("GET /api/guests/:id", () => {
    it("returns a guest record with valid transitions", async () => {
      mockGetGuestById.mockResolvedValueOnce({ id: "g1", name: "Guest 1", status: "draft" });

      const res = await request(app).get("/api/guests/g1");

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe("g1");
      expect(res.body.validTransitions).toBeDefined();
    });

    it("returns 404 when not found", async () => {
      mockGetGuestById.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/guests/bad-id");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/guests/:id/summary", () => {
    it("returns guest summary with stats", async () => {
      mockGetGuestSummary.mockResolvedValueOnce({
        guest: { id: "g1", name: "Guest 1", status: "confirmed" },
        prepCompletionPercent: 70,
        prepTotal: 10,
        prepComplete: 7,
        pairingCount: 2,
        scheduleCount: 3,
      });

      const res = await request(app).get("/api/guests/g1/summary");

      expect(res.status).toBe(200);
      expect(res.body.data.prepCompletionPercent).toBe(70);
      expect(res.body.data.pairingCount).toBe(2);
    });

    it("returns 404 when guest not found", async () => {
      mockGetGuestSummary.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/guests/bad-id/summary");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/guests", () => {
    it("creates a guest with audit and event", async () => {
      mockCreateGuest.mockResolvedValueOnce({ id: "g-new", name: "New Guest", status: "draft" });

      const res = await request(app)
        .post("/api/guests")
        .send({ name: "New Guest", type: "JP", department: "guest-relations" });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("New Guest");
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalled();
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "guest.created" })
      );
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/guests")
        .send({ type: "JP" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("returns 400 for invalid type", async () => {
      const res = await request(app)
        .post("/api/guests")
        .send({ name: "Test", type: "INVALID" });

      expect(res.status).toBe(400);
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app)
        .post("/api/guests")
        .send({ name: "Test" });

      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/guests/:id/status", () => {
    it("transitions guest status with audit and event", async () => {
      mockGetGuestById.mockResolvedValueOnce({ id: "g1", name: "Guest 1", status: "draft" });
      mockIsValidTransition.mockReturnValueOnce(true);
      mockTransitionGuestStatus.mockResolvedValueOnce({ id: "g1", name: "Guest 1", status: "invited" });

      const res = await request(app)
        .put("/api/guests/g1/status")
        .send({ status: "invited" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("invited");
      expect(res.body.previousStatus).toBe("draft");
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "guest.status_changed" })
      );
    });

    it("returns 404 when guest not found", async () => {
      mockGetGuestById.mockResolvedValueOnce(null);

      const res = await request(app)
        .put("/api/guests/bad-id/status")
        .send({ status: "invited" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid transition", async () => {
      mockGetGuestById.mockResolvedValueOnce({ id: "g1", name: "Guest 1", status: "draft" });
      mockIsValidTransition.mockReturnValueOnce(false);
      mockGetValidTransitions.mockReturnValueOnce(["invited", "canceled"]);

      const res = await request(app)
        .put("/api/guests/g1/status")
        .send({ status: "arrived" });

      expect(res.status).toBe(400);
      expect(res.body.currentStatus).toBe("draft");
      expect(res.body.validTransitions).toBeDefined();
    });

    it("returns 400 for invalid status value", async () => {
      const res = await request(app)
        .put("/api/guests/g1/status")
        .send({ status: "bogus" });

      expect(res.status).toBe(400);
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app)
        .put("/api/guests/g1/status")
        .send({ status: "invited" });

      expect(res.status).toBe(403);
    });
  });
});
