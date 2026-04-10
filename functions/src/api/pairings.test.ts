/**
 * Tests for Pairings API Router
 *
 * Covers:
 * - GET /guest/:guestId  — pairings for a guest
 * - GET /staff/:staffId  — assignments for a staff member
 * - GET /coverage/:guestId  — coverage check
 * - GET /:id  — single pairing
 * - POST /  — assign staff with audit + events
 * - DELETE /:id  — remove pairing
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

const mockAssignStaff = vi.fn();
const mockRemoveStaff = vi.fn();
const mockGetGuestPairings = vi.fn();
const mockGetStaffAssignments = vi.fn();
const mockCheckCoverage = vi.fn();
const mockGetPairingById = vi.fn();

vi.mock("../services/pairings", () => ({
  assignStaff: (...args: unknown[]) => mockAssignStaff(...args),
  removeStaff: (...args: unknown[]) => mockRemoveStaff(...args),
  getGuestPairings: (...args: unknown[]) => mockGetGuestPairings(...args),
  getStaffAssignments: (...args: unknown[]) => mockGetStaffAssignments(...args),
  checkCoverage: (...args: unknown[]) => mockCheckCoverage(...args),
  getPairingById: (...args: unknown[]) => mockGetPairingById(...args),
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

import { pairingsRouter } from "./pairings";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: "user-1", email: "admin@test.com", name: "Admin" };
    req.role = { roleKey: "director", roleName: "Director", priority: 0 };
    next();
  });
  app.use("/api/pairings", pairingsRouter);
  return app;
}

// --- Tests ---

describe("Pairings API Router", () => {
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

  describe("GET /api/pairings/guest/:guestId", () => {
    it("returns pairings for a guest", async () => {
      mockGetGuestPairings.mockResolvedValueOnce([
        { id: "p1", guest_id: "g1", staff_id: "s1", role: "liaison", staff_name: "Jane" },
      ]);

      const res = await request(app).get("/api/pairings/guest/g1");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].staff_name).toBe("Jane");
    });

    it("returns empty array when no pairings", async () => {
      mockGetGuestPairings.mockResolvedValueOnce([]);

      const res = await request(app).get("/api/pairings/guest/g1");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe("GET /api/pairings/staff/:staffId", () => {
    it("returns assignments for a staff member", async () => {
      mockGetStaffAssignments.mockResolvedValueOnce([
        { id: "p1", guest_id: "g1", staff_id: "s1", role: "liaison", guest_name: "Guest 1" },
      ]);

      const res = await request(app).get("/api/pairings/staff/s1");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe("GET /api/pairings/coverage/:guestId", () => {
    it("returns coverage result", async () => {
      mockCheckCoverage.mockResolvedValueOnce({
        guestId: "g1",
        requiredRoles: ["liaison", "interpreter"],
        filledRoles: ["liaison"],
        missingRoles: ["interpreter"],
        isFullyCovered: false,
      });

      const res = await request(app)
        .get("/api/pairings/coverage/g1?required_roles=liaison,interpreter");

      expect(res.status).toBe(200);
      expect(res.body.data.isFullyCovered).toBe(false);
      expect(res.body.data.missingRoles).toEqual(["interpreter"]);
    });

    it("returns 400 when required_roles is missing", async () => {
      const res = await request(app).get("/api/pairings/coverage/g1");

      expect(res.status).toBe(400);
    });

    it("returns 400 when required_roles is empty", async () => {
      const res = await request(app).get("/api/pairings/coverage/g1?required_roles=");

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/pairings/:id", () => {
    it("returns a single pairing", async () => {
      mockGetPairingById.mockResolvedValueOnce({
        id: "p1", guest_id: "g1", staff_id: "s1", role: "liaison",
      });

      const res = await request(app).get("/api/pairings/p1");

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe("p1");
    });

    it("returns 404 when not found", async () => {
      mockGetPairingById.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/pairings/bad-id");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/pairings", () => {
    it("assigns staff with audit and event", async () => {
      mockAssignStaff.mockResolvedValueOnce({
        id: "p-new", guest_id: "g1", staff_id: "s1", role: "liaison",
      });

      const res = await request(app)
        .post("/api/pairings")
        .send({ guest_id: "g1", staff_id: "s1", role: "liaison" });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe("liaison");
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "pairing.created" })
      );
    });

    it("returns 400 when guest_id is missing", async () => {
      const res = await request(app)
        .post("/api/pairings")
        .send({ staff_id: "s1", role: "liaison" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when staff_id is missing", async () => {
      const res = await request(app)
        .post("/api/pairings")
        .send({ guest_id: "g1", role: "liaison" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when role is missing", async () => {
      const res = await request(app)
        .post("/api/pairings")
        .send({ guest_id: "g1", staff_id: "s1" });

      expect(res.status).toBe(400);
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app)
        .post("/api/pairings")
        .send({ guest_id: "g1", staff_id: "s1", role: "liaison" });

      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/pairings/:id", () => {
    it("removes (archives) a pairing with audit and event", async () => {
      mockRemoveStaff.mockResolvedValueOnce(true);

      const res = await request(app).delete("/api/pairings/p1");

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "pairing.removed" })
      );
    });

    it("returns 404 when not found", async () => {
      mockRemoveStaff.mockResolvedValueOnce(false);

      const res = await request(app).delete("/api/pairings/bad-id");

      expect(res.status).toBe(404);
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app).delete("/api/pairings/p1");

      expect(res.status).toBe(403);
    });
  });
});
