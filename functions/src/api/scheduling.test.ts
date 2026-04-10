/**
 * Tests for Scheduling API Router
 *
 * Covers:
 * - GET /conflicts  — detect room conflicts
 * - GET /range  — events in date range
 * - GET /guest/:guestId  — guest schedule
 * - POST /  — create schedule event
 * - PUT /:id  — update schedule event
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

const mockDetectRoomConflicts = vi.fn();
const mockGetScheduleForDateRange = vi.fn();
const mockGetScheduleForGuest = vi.fn();
const mockCreateScheduleEvent = vi.fn();
const mockUpdateScheduleEvent = vi.fn();

vi.mock("../services/scheduling", () => ({
  detectRoomConflicts: (...args: unknown[]) => mockDetectRoomConflicts(...args),
  getScheduleForDateRange: (...args: unknown[]) => mockGetScheduleForDateRange(...args),
  getScheduleForGuest: (...args: unknown[]) => mockGetScheduleForGuest(...args),
  createScheduleEvent: (...args: unknown[]) => mockCreateScheduleEvent(...args),
  updateScheduleEvent: (...args: unknown[]) => mockUpdateScheduleEvent(...args),
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

import { schedulingRouter } from "./scheduling";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { uid: "user-1", email: "admin@test.com", name: "Admin" };
    req.role = { roleKey: "coordinator", roleName: "Coordinator", priority: 10 };
    next();
  });
  app.use("/api/scheduling", schedulingRouter);
  return app;
}

// --- Tests ---

describe("Scheduling API Router", () => {
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

  describe("GET /api/scheduling/conflicts", () => {
    it("returns conflicts for a venue and time range", async () => {
      mockDetectRoomConflicts.mockResolvedValueOnce([
        { conflicting_event_id: "evt-2", conflicting_event_name: "Overlap" },
      ]);

      const res = await request(app).get(
        "/api/scheduling/conflicts?venue_id=v1&start_time=2024-06-15T09:00:00Z&end_time=2024-06-15T11:00:00Z"
      );

      expect(res.status).toBe(200);
      expect(res.body.data.has_conflicts).toBe(true);
      expect(res.body.data.conflicts).toHaveLength(1);
    });

    it("returns 400 when required params are missing", async () => {
      const res = await request(app).get("/api/scheduling/conflicts?venue_id=v1");

      expect(res.status).toBe(400);
    });

    it("passes exclude_event_id to service", async () => {
      mockDetectRoomConflicts.mockResolvedValueOnce([]);

      await request(app).get(
        "/api/scheduling/conflicts?venue_id=v1&start_time=2024-06-15T09:00:00Z&end_time=2024-06-15T11:00:00Z&exclude_event_id=evt-1"
      );

      expect(mockDetectRoomConflicts).toHaveBeenCalledWith("v1", "2024-06-15T09:00:00Z", "2024-06-15T11:00:00Z", "evt-1");
    });

    it("returns 400 for invalid dates", async () => {
      mockDetectRoomConflicts.mockRejectedValueOnce(new Error("Invalid date format for startTime or endTime"));

      const res = await request(app).get(
        "/api/scheduling/conflicts?venue_id=v1&start_time=bad&end_time=bad"
      );

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/scheduling/range", () => {
    it("returns events in date range", async () => {
      mockGetScheduleForDateRange.mockResolvedValueOnce({
        data: [{ id: "evt-1", name: "Morning" }],
        total: 1,
        page: 1,
        limit: 50,
      });

      const res = await request(app).get(
        "/api/scheduling/range?start_date=2024-06-15&end_date=2024-06-16"
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    it("returns 400 when dates are missing", async () => {
      const res = await request(app).get("/api/scheduling/range");

      expect(res.status).toBe(400);
    });

    it("passes additional filters to service", async () => {
      mockGetScheduleForDateRange.mockResolvedValueOnce({
        data: [],
        total: 0,
        page: 1,
        limit: 50,
      });

      await request(app).get(
        "/api/scheduling/range?start_date=2024-06-15&end_date=2024-06-16&venue_id=v1&event_type=panel&status=confirmed"
      );

      expect(mockGetScheduleForDateRange).toHaveBeenCalledWith(
        "2024-06-15",
        "2024-06-16",
        expect.objectContaining({
          venue_id: "v1",
          event_type: "panel",
          status: "confirmed",
        })
      );
    });
  });

  describe("GET /api/scheduling/guest/:guestId", () => {
    it("returns schedule entries for a guest", async () => {
      mockGetScheduleForGuest.mockResolvedValueOnce([
        { schedule_event_id: "evt-1", event_name: "Morning", role: "attendee" },
      ]);

      const res = await request(app).get("/api/scheduling/guest/guest-1");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].role).toBe("attendee");
    });

    it("returns empty array for guest with no events", async () => {
      mockGetScheduleForGuest.mockResolvedValueOnce([]);

      const res = await request(app).get("/api/scheduling/guest/guest-no-events");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("POST /api/scheduling", () => {
    it("creates a schedule event with audit and domain event", async () => {
      mockCreateScheduleEvent.mockResolvedValueOnce({
        event: { id: "evt-new", name: "New Session" },
        conflicts: [],
      });

      const res = await request(app)
        .post("/api/scheduling")
        .send({ name: "New Session", venue_id: "v1", start_time: "2024-06-15T09:00:00Z", end_time: "2024-06-15T11:00:00Z" });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("New Session");
      expect(res.body.conflicts).toBeUndefined();
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalled();
    });

    it("includes conflicts in response when detected", async () => {
      mockCreateScheduleEvent.mockResolvedValueOnce({
        event: { id: "evt-new", name: "Overlap Session" },
        conflicts: [{ conflicting_event_id: "evt-2" }],
      });

      const res = await request(app)
        .post("/api/scheduling")
        .send({ name: "Overlap Session", venue_id: "v1", start_time: "2024-06-15T09:00:00Z", end_time: "2024-06-15T11:00:00Z" });

      expect(res.status).toBe(201);
      expect(res.body.conflicts).toHaveLength(1);
      expect(res.body.warning).toContain("conflict");
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/scheduling")
        .send({ venue_id: "v1" });

      expect(res.status).toBe(400);
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app)
        .post("/api/scheduling")
        .send({ name: "Session" });

      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/scheduling/:id", () => {
    it("updates a schedule event", async () => {
      mockUpdateScheduleEvent.mockResolvedValueOnce({
        event: { id: "evt-1", name: "Updated" },
        conflicts: [],
      });

      const res = await request(app)
        .put("/api/scheduling/evt-1")
        .send({ name: "Updated" });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Updated");
    });

    it("returns 404 when event not found", async () => {
      mockUpdateScheduleEvent.mockResolvedValueOnce(null);

      const res = await request(app)
        .put("/api/scheduling/bad-id")
        .send({ name: "Nope" });

      expect(res.status).toBe(404);
    });

    it("includes conflicts in update response", async () => {
      mockUpdateScheduleEvent.mockResolvedValueOnce({
        event: { id: "evt-1", name: "Moved" },
        conflicts: [{ conflicting_event_id: "evt-3" }],
      });

      const res = await request(app)
        .put("/api/scheduling/evt-1")
        .send({ start_time: "2024-06-15T10:00:00Z" });

      expect(res.body.conflicts).toHaveLength(1);
      expect(res.body.warning).toContain("conflict");
    });
  });
});
