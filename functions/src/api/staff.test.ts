/**
 * Tests for Staff API Router
 *
 * Covers:
 * - GET /  — list staff
 * - GET /:id  — get single staff record
 * - GET /department/:department  — staff by department
 * - POST /  — create staff with audit + events
 * - PUT /:id  — update staff
 * - DELETE /:id  — archive staff
 * - PUT /:id/role  — assign role
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

const mockListStaff = vi.fn();
const mockGetStaffById = vi.fn();
const mockGetStaffByDepartment = vi.fn();
const mockAssignRole = vi.fn();
const mockCreateStaff = vi.fn();
const mockUpdateStaff = vi.fn();
const mockArchiveStaff = vi.fn();

vi.mock("../services/staff", () => ({
  listStaff: (...args: unknown[]) => mockListStaff(...args),
  getStaffById: (...args: unknown[]) => mockGetStaffById(...args),
  getStaffByDepartment: (...args: unknown[]) => mockGetStaffByDepartment(...args),
  assignRole: (...args: unknown[]) => mockAssignRole(...args),
  createStaff: (...args: unknown[]) => mockCreateStaff(...args),
  updateStaff: (...args: unknown[]) => mockUpdateStaff(...args),
  archiveStaff: (...args: unknown[]) => mockArchiveStaff(...args),
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

import { staffRouter } from "./staff";

function createApp() {
  const app = express();
  app.use(express.json());
  // Simulate authenticated user
  app.use((req, _res, next) => {
    req.user = { uid: "user-1", email: "admin@test.com", name: "Admin" };
    req.role = { roleKey: "director", roleName: "Director", priority: 0 };
    next();
  });
  app.use("/api/staff", staffRouter);
  return app;
}

// --- Tests ---

describe("Staff API Router", () => {
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

  describe("GET /api/staff", () => {
    it("returns list of staff", async () => {
      mockListStaff.mockResolvedValueOnce({
        data: [{ id: "s1", name: "Jane" }],
        total: 1,
        page: 1,
        limit: 50,
      });

      const res = await request(app).get("/api/staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
    });

    it("passes query filters to service", async () => {
      mockListStaff.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 50 });

      await request(app).get("/api/staff?department=ops&staff_type=volunteer&active=true");

      expect(mockListStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          department: "ops",
          staff_type: "volunteer",
          active: true,
        })
      );
    });
  });

  describe("GET /api/staff/department/:department", () => {
    it("returns staff for a department", async () => {
      mockGetStaffByDepartment.mockResolvedValueOnce([{ id: "s1", name: "Jane" }]);

      const res = await request(app).get("/api/staff/department/operations");

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe("GET /api/staff/:id", () => {
    it("returns a staff record", async () => {
      mockGetStaffById.mockResolvedValueOnce({ id: "s1", name: "Jane" });

      const res = await request(app).get("/api/staff/s1");

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe("s1");
    });

    it("returns 404 when not found", async () => {
      mockGetStaffById.mockResolvedValueOnce(null);

      const res = await request(app).get("/api/staff/bad-id");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/staff", () => {
    it("creates a staff record with audit and event", async () => {
      mockCreateStaff.mockResolvedValueOnce({ id: "s-new", name: "Bob" });

      const res = await request(app)
        .post("/api/staff")
        .send({ name: "Bob", email: "bob@test.com" });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Bob");
      expect(mockLogAuditClaim).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalled();
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "staff.created" })
      );
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/staff")
        .send({ email: "noname@test.com" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("name");
    });

    it("rejects when role is insufficient", async () => {
      mockRequireRoleReject = true;

      const res = await request(app)
        .post("/api/staff")
        .send({ name: "Bob" });

      expect(res.status).toBe(403);
    });
  });

  describe("PUT /api/staff/:id", () => {
    it("updates a staff record", async () => {
      mockUpdateStaff.mockResolvedValueOnce({ id: "s1", name: "Jane Updated" });

      const res = await request(app)
        .put("/api/staff/s1")
        .send({ name: "Jane Updated" });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Jane Updated");
    });

    it("returns 404 when not found", async () => {
      mockUpdateStaff.mockResolvedValueOnce(null);

      const res = await request(app)
        .put("/api/staff/bad-id")
        .send({ name: "Nope" });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/staff/:id", () => {
    it("archives a staff record", async () => {
      mockArchiveStaff.mockResolvedValueOnce(true);

      const res = await request(app).delete("/api/staff/s1");

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
      expect(mockEmit).toHaveBeenCalled();
    });

    it("returns 404 when not found", async () => {
      mockArchiveStaff.mockResolvedValueOnce(false);

      const res = await request(app).delete("/api/staff/bad-id");

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/staff/:id/role", () => {
    it("assigns a role to staff", async () => {
      mockAssignRole.mockResolvedValueOnce({ id: "s1", role_key: "director" });

      const res = await request(app)
        .put("/api/staff/s1/role")
        .send({ role_key: "director" });

      expect(res.status).toBe(200);
      expect(res.body.data.role_key).toBe("director");
    });

    it("returns 400 when role_key is missing", async () => {
      const res = await request(app)
        .put("/api/staff/s1/role")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("role_key");
    });

    it("returns 404 when staff not found", async () => {
      mockAssignRole.mockResolvedValueOnce(null);

      const res = await request(app)
        .put("/api/staff/bad-id/role")
        .send({ role_key: "director" });

      expect(res.status).toBe(404);
    });
  });
});
