/**
 * Tests for Prep Tracking API Router
 *
 * Covers:
 * - GET /overdue  — overdue items
 * - GET /departments  — completion by department
 * - GET /guest/:guestId  — items for a guest
 * - GET /guest/:guestId/rate  — completion rate
 * - GET /:id  — single prep item
 * - POST /guest/:guestId  — batch create
 * - PUT /:id/status  — update status
 * - POST /mark-overdue  — mark overdue items
 * - Auth and role enforcement
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

const mockCreatePrepItems = vi.fn();
const mockUpdatePrepItemStatus = vi.fn();
const mockGetCompletionRate = vi.fn();
const mockGetPrepItemsByGuest = vi.fn();
const mockGetPrepItemById = vi.fn();
const mockGetOverdueItems = vi.fn();
const mockGetCompletionByDepartment = vi.fn();
const mockMarkOverdueItems = vi.fn();

vi.mock("../services/prep-tracking", () => ({
  createPrepItems: (...args: unknown[]) => mockCreatePrepItems(...args),
  updatePrepItemStatus: (...args: unknown[]) => mockUpdatePrepItemStatus(...args),
  getCompletionRate: (...args: unknown[]) => mockGetCompletionRate(...args),
  getPrepItemsByGuest: (...args: unknown[]) => mockGetPrepItemsByGuest(...args),
  getPrepItemById: (...args: unknown[]) => mockGetPrepItemById(...args),
  getOverdueItems: (...args: unknown[]) => mockGetOverdueItems(...args),
  getCompletionByDepartment: (...args: unknown[]) => mockGetCompletionByDepartment(...args),
  markOverdueItems: (...args: unknown[]) => mockMarkOverdueItems(...args),
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

import { prepTrackingRouter } from "./prep-tracking";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: "user-1", email: "admin@test.com", name: "Admin" };
    req.role = { roleKey: "director", roleName: "Director", priority: 0 };
    next();
  });
  app.use("/api/prep", prepTrackingRouter);
  return app;
}

// --- Tests ---

describe("Prep Tracking API Router", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    mockAuditContextFromRequest.mockReturnValue({
      actorId: "user-1",
      actorType: "human",
      changeSet: "cs-1",
    });
    app = createApp();
  });

  describe("GET /api/prep/overdue", () => {
    it("returns overdue items", async () => {
      mockGetOverdueItems.mockResolvedValueOnce([
        { id: "p1", name: "Travel", status: "incomplete" },
      ]);

      const res = await request(app).get("/api/prep/overdue");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("returns empty array when no overdue items", async () => {
      mockGetOverdueItems.mockResolvedValueOnce([]);

      const res = await request(app).get("/api/prep/overdue");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe("GET /api/prep/departments", () => {
    it("returns completion by department", async () => {
      mockGetCompletionByDepartment.mockResolvedValueOnce([
        { department: "guest-relations", total: 20, complete: 15, percent: 75 },
      ]);

      const res = await request(app).get("/api/prep/departments");

      expect(res.status).toBe(200);
      expect(res.body.data[0].department).toBe("guest-relations");
    });
  });

  describe("GET /api/prep/guest/:guestId/rate", () => {
    it("returns completion rate for a guest", async () => {
      mockGetCompletionRate.mockResolvedValueOnce({ total: 10, complete: 7, percent: 70 });

      const res = await request(app).get("/api/prep/guest/g1/rate");

      expect(res.status).toBe(200);
      expect(res.body.data.percent).toBe(70);
    });
  });

  describe("GET /api/prep/guest/:guestId", () => {
    it("returns prep items for a guest", async () => {
      mockGetPrepItemsByGuest.mockResolvedValueOnce([
        { id: "p1", name: "Visa" },
        { id: "p2", name: "Flight" },
      ]);

      const res = await request(app).get("/api/prep/guest/g1");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe("GET /api/prep/:id", () => {
    it("returns a single prep item", async () => {
      mockGetPrepItemById.mockResolvedValueOnce({ id: "p1", name: "Visa" });

      const res = await request(app).get("/api/prep/p1");

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe("p1");
    });

    it("returns 404 when not found", async () => {
      mockGetPrepItemById.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/prep/bad-id");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/prep/guest/:guestId", () => {
    it("batch creates prep items with audit and event", async () => {
      mockCreatePrepItems.mockResolvedValueOnce([
        { id: "p1", name: "Visa check" },
        { id: "p2", name: "Flight booking" },
      ]);

      const res = await request(app)
        .post("/api/prep/guest/g1")
        .send({
          items: [
            { name: "Visa check", category: "travel" },
            { name: "Flight booking", category: "travel" },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(2);
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "prep_item.batch_created" })
      );
    });

    it("returns 400 when items array is empty", async () => {
      const res = await request(app)
        .post("/api/prep/guest/g1")
        .send({ items: [] });

      expect(res.status).toBe(400);
    });

    it("returns 400 when items is missing", async () => {
      const res = await request(app)
        .post("/api/prep/guest/g1")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when item name is empty", async () => {
      const res = await request(app)
        .post("/api/prep/guest/g1")
        .send({ items: [{ name: "" }] });

      expect(res.status).toBe(400);
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app)
        .post("/api/prep/guest/g1")
        .send({ items: [{ name: "Test" }] });

      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/prep/:id/status", () => {
    it("updates prep item status", async () => {
      mockUpdatePrepItemStatus.mockResolvedValueOnce({ id: "p1", name: "Visa", status: "complete" });

      const res = await request(app)
        .put("/api/prep/p1/status")
        .send({ status: "complete" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("complete");
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "prep_item.status_changed" })
      );
    });

    it("returns 404 when not found", async () => {
      mockUpdatePrepItemStatus.mockResolvedValueOnce(null);

      const res = await request(app)
        .put("/api/prep/bad-id/status")
        .send({ status: "complete" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid status", async () => {
      const res = await request(app)
        .put("/api/prep/p1/status")
        .send({ status: "bogus" });

      expect(res.status).toBe(400);
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app)
        .put("/api/prep/p1/status")
        .send({ status: "complete" });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/prep/mark-overdue", () => {
    it("marks overdue items and fires event when count > 0", async () => {
      mockMarkOverdueItems.mockResolvedValueOnce(5);

      const res = await request(app).post("/api/prep/mark-overdue");

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(5);
      expect(mockEmit).toHaveBeenCalled();
    });

    it("does not fire event when count is 0", async () => {
      mockMarkOverdueItems.mockResolvedValueOnce(0);

      const res = await request(app).post("/api/prep/mark-overdue");

      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBe(0);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app).post("/api/prep/mark-overdue");

      expect(res.status).toBe(403);
    });
  });
});
