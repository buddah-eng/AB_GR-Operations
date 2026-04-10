/**
 * Tests for Volunteer API Router
 *
 * Covers:
 * - GET /  — list volunteers
 * - GET /:id/skills  — get volunteer skills
 * - PUT /:id/training  — update training status
 * - GET /match/:shiftId  — match volunteers to shift
 * - POST /assign  — assign volunteer to shift
 * - GET /coverage/:shiftId  — shift coverage
 * - Auth enforcement
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

const mockListVolunteers = vi.fn();
const mockGetVolunteerSkills = vi.fn();
const mockUpdateTrainingStatus = vi.fn();
const mockMatchVolunteersToShift = vi.fn();
const mockAssignToShift = vi.fn();
const mockGetShiftCoverage = vi.fn();

vi.mock("../services/volunteers", () => ({
  listVolunteers: (...args: unknown[]) => mockListVolunteers(...args),
  getVolunteerSkills: (...args: unknown[]) => mockGetVolunteerSkills(...args),
  updateTrainingStatus: (...args: unknown[]) => mockUpdateTrainingStatus(...args),
  matchVolunteersToShift: (...args: unknown[]) => mockMatchVolunteersToShift(...args),
  assignToShift: (...args: unknown[]) => mockAssignToShift(...args),
  getShiftCoverage: (...args: unknown[]) => mockGetShiftCoverage(...args),
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

import { volunteerRouter } from "./volunteers";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: "user-1", email: "admin@test.com", name: "Admin" };
    req.role = { roleKey: "coordinator", roleName: "Coordinator", priority: 10 };
    next();
  });
  app.use("/api/volunteers", volunteerRouter);
  return app;
}

// --- Tests ---

describe("Volunteer API Router", () => {
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

  describe("GET /api/volunteers", () => {
    it("returns list of volunteers", async () => {
      mockListVolunteers.mockResolvedValueOnce({
        data: [{ id: "v1", name: "Alice" }],
        total: 1,
        page: 1,
        limit: 50,
      });

      const res = await request(app).get("/api/volunteers");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it("passes skills filter as array", async () => {
      mockListVolunteers.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 50 });

      await request(app).get("/api/volunteers?skills=first_aid,driving");

      expect(mockListVolunteers).toHaveBeenCalledWith(
        expect.objectContaining({
          skills: ["first_aid", "driving"],
        })
      );
    });
  });

  describe("GET /api/volunteers/:id/skills", () => {
    it("returns volunteer skills", async () => {
      mockGetVolunteerSkills.mockResolvedValueOnce(["first_aid", "driving"]);

      const res = await request(app).get("/api/volunteers/v1/skills");

      expect(res.status).toBe(200);
      expect(res.body.data.skills).toEqual(["first_aid", "driving"]);
    });

    it("returns 404 when volunteer not found", async () => {
      mockGetVolunteerSkills.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/volunteers/bad-id/skills");

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/volunteers/:id/training", () => {
    it("updates training status with audit and event", async () => {
      mockUpdateTrainingStatus.mockResolvedValueOnce({ id: "v1", training_status: "completed" });

      const res = await request(app)
        .put("/api/volunteers/v1/training")
        .send({ status: "completed" });

      expect(res.status).toBe(200);
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalled();
    });

    it("returns 400 when status is missing", async () => {
      const res = await request(app)
        .put("/api/volunteers/v1/training")
        .send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid training status", async () => {
      const res = await request(app)
        .put("/api/volunteers/v1/training")
        .send({ status: "bogus" });

      expect(res.status).toBe(400);
    });

    it("returns 404 when volunteer not found", async () => {
      mockUpdateTrainingStatus.mockResolvedValueOnce(null);

      const res = await request(app)
        .put("/api/volunteers/v1/training")
        .send({ status: "completed" });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/volunteers/match/:shiftId", () => {
    it("returns matched volunteers", async () => {
      mockMatchVolunteersToShift.mockResolvedValueOnce([
        { id: "v1", name: "Alice", matching_skills: ["first_aid"] },
      ]);

      const res = await request(app).get("/api/volunteers/match/shift-1");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it("returns 404 when shift not found", async () => {
      mockMatchVolunteersToShift.mockRejectedValueOnce(new Error("Shift not found: bad-shift"));

      const res = await request(app).get("/api/volunteers/match/bad-shift");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/volunteers/assign", () => {
    it("assigns volunteer to shift", async () => {
      mockAssignToShift.mockResolvedValueOnce({
        id: "assign-1",
        shift_id: "shift-1",
        volunteer_id: "v1",
        status: "assigned",
      });

      const res = await request(app)
        .post("/api/volunteers/assign")
        .send({ volunteer_id: "v1", shift_id: "shift-1" });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe("assign-1");
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalled();
    });

    it("returns 400 when fields are missing", async () => {
      const res = await request(app)
        .post("/api/volunteers/assign")
        .send({ volunteer_id: "v1" });

      expect(res.status).toBe(400);
    });

    it("returns 409 when shift is at capacity", async () => {
      mockAssignToShift.mockRejectedValueOnce(new Error("Shift shift-1 is at maximum capacity (5)"));

      const res = await request(app)
        .post("/api/volunteers/assign")
        .send({ volunteer_id: "v1", shift_id: "shift-1" });

      expect(res.status).toBe(409);
    });

    it("returns 404 when volunteer not found", async () => {
      mockAssignToShift.mockRejectedValueOnce(new Error("Active volunteer not found: bad-v"));

      const res = await request(app)
        .post("/api/volunteers/assign")
        .send({ volunteer_id: "bad-v", shift_id: "shift-1" });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/volunteers/coverage/:shiftId", () => {
    it("returns shift coverage data", async () => {
      mockGetShiftCoverage.mockResolvedValueOnce({
        shift_id: "shift-1",
        min_volunteers: 3,
        assigned_count: 2,
        is_covered: false,
        coverage_percentage: 67,
      });

      const res = await request(app).get("/api/volunteers/coverage/shift-1");

      expect(res.status).toBe(200);
      expect(res.body.data.coverage_percentage).toBe(67);
    });

    it("returns 404 when shift not found", async () => {
      mockGetShiftCoverage.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/volunteers/coverage/bad-shift");

      expect(res.status).toBe(404);
    });
  });
});
