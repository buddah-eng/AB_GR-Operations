import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listVolunteers,
  getVolunteerSkills,
  updateTrainingStatus,
  matchVolunteersToShift,
  assignToShift,
  getShiftCoverage,
} from "./volunteers";
import type { Staff } from "./staff";

const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockWithTransaction = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (fn: unknown) => mockWithTransaction(fn),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

function makeVolunteer(overrides: Partial<Staff> = {}): Staff {
  return {
    id: "vol-001",
    name: "Dana Volunteer",
    email: "dana@example.com",
    role_key: "volunteer",
    department: "Events",
    phone: "555-0202",
    staff_type: "volunteer",
    skills: ["audio", "lighting"],
    training_status: "completed",
    availability: { monday: true },
    emergency_contact: "555-9999",
    languages: ["en", "es"],
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    archived: false,
    ...overrides,
  };
}

describe("Volunteer Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- listVolunteers ---

  describe("listVolunteers", () => {
    it("returns only volunteers (staff_type='volunteer')", async () => {
      const volunteers = [makeVolunteer()];
      mockQuery.mockResolvedValueOnce({ rows: volunteers, rowCount: 1 });

      const result = await listVolunteers();

      expect(result).toHaveLength(1);
      expect(result[0].staff_type).toBe("volunteer");
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("staff_type = 'volunteer'");
    });

    it("applies training_status filter", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await listVolunteers({ training_status: "completed" });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("training_status = $1");
      expect(mockQuery.mock.calls[0][1]).toContain("completed");
    });
  });

  // --- getVolunteerSkills ---

  describe("getVolunteerSkills", () => {
    it("returns the skills array for a valid volunteer", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ skills: ["audio", "lighting"], staff_type: "volunteer" }],
        rowCount: 1,
      });

      const skills = await getVolunteerSkills("vol-001");

      expect(skills).toEqual(["audio", "lighting"]);
    });

    it("returns null when volunteer not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const skills = await getVolunteerSkills("nonexistent");

      expect(skills).toBeNull();
    });

    it("returns empty array when volunteer has null skills", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ skills: null, staff_type: "volunteer" }],
        rowCount: 1,
      });

      const skills = await getVolunteerSkills("vol-002");

      expect(skills).toEqual([]);
    });
  });

  // --- updateTrainingStatus ---

  describe("updateTrainingStatus", () => {
    it("updates status and returns updated volunteer", async () => {
      const updated = makeVolunteer({ training_status: "completed" });
      mockQuery.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await updateTrainingStatus("vol-001", "completed");

      expect(result).toEqual(updated);
      expect(result?.training_status).toBe("completed");
    });

    it("returns null when volunteer not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await updateTrainingStatus("nonexistent", "in_progress");

      expect(result).toBeNull();
    });
  });

  // --- matchVolunteersToShift ---

  describe("matchVolunteersToShift", () => {
    it("returns empty array when shift not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await matchVolunteersToShift("bad-shift");

      expect(result).toEqual([]);
    });

    it("queries for volunteers with matching skills and no overlap", async () => {
      const shift = {
        id: "shift-001",
        name: "Stage Setup",
        venue_id: null,
        start_time: "2026-04-10T08:00:00Z",
        end_time: "2026-04-10T12:00:00Z",
        required_count: 2,
        required_skills: ["audio"],
        status: "open",
        properties: {},
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        archived: false,
      };
      const volunteers = [makeVolunteer()];

      mockQuery
        .mockResolvedValueOnce({ rows: [shift], rowCount: 1 }) // shift lookup
        .mockResolvedValueOnce({ rows: volunteers, rowCount: 1 }); // volunteer query

      const result = await matchVolunteersToShift("shift-001");

      expect(result).toHaveLength(1);
      // Second query should contain skill-matching logic
      const volunteerSql = mockQuery.mock.calls[1][0] as string;
      expect(volunteerSql).toContain("staff_type = 'volunteer'");
      expect(volunteerSql).toContain("training_status = 'completed'");
    });
  });

  // --- assignToShift ---

  describe("assignToShift", () => {
    it("inserts assignment and updates shift status via transaction", async () => {
      const assignment = {
        id: "assign-001",
        shift_id: "shift-001",
        staff_id: "vol-001",
        status: "assigned",
        created_at: "2026-04-08T00:00:00Z",
      };

      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [assignment], rowCount: 1 }) // INSERT
          .mockResolvedValueOnce({ rows: [{ count: "2" }], rowCount: 1 }) // COUNT
          .mockResolvedValueOnce({ rows: [{ required_count: 2 }], rowCount: 1 }) // required
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // UPDATE shifts status
      };

      mockWithTransaction.mockImplementationOnce(async (fn: (client: typeof mockClient) => Promise<unknown>) => {
        return fn(mockClient);
      });

      const result = await assignToShift("vol-001", "shift-001");

      expect(result).toEqual(assignment);
      // Verify shift status was set to 'filled' (2 assigned === 2 required)
      const updateCall = mockClient.query.mock.calls[3];
      expect(updateCall[0]).toContain("UPDATE shifts SET status = $1");
      expect(updateCall[1]).toContain("filled");
    });
  });

  // --- getShiftCoverage ---

  describe("getShiftCoverage", () => {
    it("returns coverage stats for a shift", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ required_count: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: "3" }], rowCount: 1 });

      const coverage = await getShiftCoverage("shift-001");

      expect(coverage).toEqual({
        assigned: 3,
        required: 4,
        coverage_pct: 75,
      });
    });

    it("throws when shift not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(getShiftCoverage("nonexistent")).rejects.toThrow(
        "Shift not found: nonexistent"
      );
    });
  });
});
