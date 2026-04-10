/**
 * Tests for Volunteer Service
 *
 * Covers:
 * - listVolunteers with filters
 * - getVolunteerSkills
 * - updateTrainingStatus (valid and invalid)
 * - matchVolunteersToShift (with and without required skills)
 * - assignToShift (success, capacity exceeded, volunteer not found)
 * - getShiftCoverage
 * - rowToVolunteerRecord, rowToShiftAssignment mapping
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: mockQuery };
    return fn(mockClient);
  },
}));

// --- Import module under test ---

import {
  listVolunteers,
  getVolunteerSkills,
  updateTrainingStatus,
  matchVolunteersToShift,
  assignToShift,
  getShiftCoverage,
  rowToVolunteerRecord,
  rowToShiftAssignment,
  VALID_TRAINING_STATUSES,
} from "./volunteers";

// --- Test data ---

const makeVolunteerRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "vol-1",
  name: "Alice Volunteer",
  email: "alice@example.com",
  department: "hospitality",
  phone: "+1555000111",
  staff_type: "volunteer",
  skills: ["first_aid", "driving"],
  training_status: "completed",
  availability: { weekends: true },
  emergency_contact: "Bob: +1555000222",
  languages: ["en", "fr"],
  active: true,
  properties: {},
  created_at: new Date("2024-01-01T00:00:00Z"),
  updated_at: new Date("2024-06-01T00:00:00Z"),
  archived: false,
  ...overrides,
});

const makeAssignmentRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "assign-1",
  shift_id: "shift-1",
  volunteer_id: "vol-1",
  status: "assigned",
  assigned_at: new Date("2024-03-01T08:00:00Z"),
  confirmed_at: null,
  checked_in_at: null,
  notes: null,
  ...overrides,
});

// --- Tests ---

describe("Volunteer Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rowToVolunteerRecord", () => {
    it("maps a database row to a VolunteerRecord", () => {
      const row = makeVolunteerRow();
      const record = rowToVolunteerRecord(row);

      expect(record.id).toBe("vol-1");
      expect(record.name).toBe("Alice Volunteer");
      expect(record.skills).toEqual(["first_aid", "driving"]);
      expect(record.training_status).toBe("completed");
      expect(record.languages).toEqual(["en", "fr"]);
    });

    it("handles missing fields with defaults", () => {
      const row = { id: "vol-2", name: "Bob" };
      const record = rowToVolunteerRecord(row);

      expect(record.skills).toEqual([]);
      expect(record.training_status).toBe("pending");
      expect(record.active).toBe(true);
    });
  });

  describe("rowToShiftAssignment", () => {
    it("maps a database row to a ShiftAssignment", () => {
      const row = makeAssignmentRow();
      const record = rowToShiftAssignment(row);

      expect(record.id).toBe("assign-1");
      expect(record.shift_id).toBe("shift-1");
      expect(record.volunteer_id).toBe("vol-1");
      expect(record.status).toBe("assigned");
    });

    it("handles null date fields", () => {
      const row = makeAssignmentRow({ confirmed_at: null, checked_in_at: null });
      const record = rowToShiftAssignment(row);

      expect(record.confirmed_at).toBeNull();
      expect(record.checked_in_at).toBeNull();
    });
  });

  describe("VALID_TRAINING_STATUSES", () => {
    it("contains expected statuses", () => {
      expect(VALID_TRAINING_STATUSES.has("pending")).toBe(true);
      expect(VALID_TRAINING_STATUSES.has("in_progress")).toBe(true);
      expect(VALID_TRAINING_STATUSES.has("completed")).toBe(true);
      expect(VALID_TRAINING_STATUSES.has("expired")).toBe(true);
      expect(VALID_TRAINING_STATUSES.has("invalid")).toBe(false);
    });
  });

  describe("listVolunteers", () => {
    it("filters by staff_type = volunteer automatically", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeVolunteerRow()] });

      const result = await listVolunteers();

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain("staff_type = 'volunteer'");
      expect(result.data).toHaveLength(1);
    });

    it("applies training_status filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "0" }] })
        .mockResolvedValueOnce({ rows: [] });

      await listVolunteers({ training_status: "pending" });

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain("training_status = $1");
      expect(countCall[1]).toContain("pending");
    });

    it("applies skills filter with array overlap", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeVolunteerRow()] });

      await listVolunteers({ skills: ["first_aid"] });

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain("skills && $");
    });

    it("applies department filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeVolunteerRow()] });

      await listVolunteers({ department: "hospitality" });

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain("department = $");
    });

    it("returns correct pagination metadata", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "25" }] })
        .mockResolvedValueOnce({ rows: Array(10).fill(makeVolunteerRow()) });

      const result = await listVolunteers({ page: 2, limit: 10 });

      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(25);
    });
  });

  describe("getVolunteerSkills", () => {
    it("returns skills for a volunteer", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ skills: ["first_aid", "driving"] }],
      });

      const skills = await getVolunteerSkills("vol-1");

      expect(skills).toEqual(["first_aid", "driving"]);
    });

    it("returns null when volunteer not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const skills = await getVolunteerSkills("nonexistent");

      expect(skills).toBeNull();
    });

    it("returns empty array when volunteer has no skills", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ skills: [] }] });

      const skills = await getVolunteerSkills("vol-1");

      expect(skills).toEqual([]);
    });
  });

  describe("updateTrainingStatus", () => {
    it("updates and returns the volunteer record", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeVolunteerRow({ training_status: "completed" })],
      });

      const vol = await updateTrainingStatus("vol-1", "completed");

      expect(vol).not.toBeNull();
      expect(vol!.training_status).toBe("completed");
    });

    it("throws on invalid status", async () => {
      await expect(
        updateTrainingStatus("vol-1", "bogus")
      ).rejects.toThrow("Invalid training status");
    });

    it("returns null when volunteer not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const vol = await updateTrainingStatus("nonexistent", "completed");

      expect(vol).toBeNull();
    });
  });

  describe("matchVolunteersToShift", () => {
    it("throws when shift not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(matchVolunteersToShift("bad-shift")).rejects.toThrow("Shift not found");
    });

    it("returns all active volunteers when no skills required", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ required_skills: [] }] })
        .mockResolvedValueOnce({
          rows: [makeVolunteerRow(), makeVolunteerRow({ id: "vol-2", name: "Bob" })],
        });

      const matches = await matchVolunteersToShift("shift-1");

      expect(matches).toHaveLength(2);
      expect(matches[0].matching_skills).toEqual([]);
    });

    it("matches volunteers by skill overlap", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ required_skills: ["first_aid", "cpr"] }] })
        .mockResolvedValueOnce({
          rows: [
            { ...makeVolunteerRow(), matched_skills: ["first_aid"] },
          ],
        });

      const matches = await matchVolunteersToShift("shift-1");

      expect(matches).toHaveLength(1);
      expect(matches[0].matching_skills).toEqual(["first_aid"]);
    });
  });

  describe("assignToShift", () => {
    it("creates an assignment when all checks pass", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "vol-1" }] }) // volunteer exists
        .mockResolvedValueOnce({ rows: [{ id: "shift-1", max_volunteers: 5 }] }) // shift exists
        .mockResolvedValueOnce({ rows: [{ count: "2" }] }) // current count
        .mockResolvedValueOnce({ rows: [makeAssignmentRow()] }); // insert

      const assignment = await assignToShift("vol-1", "shift-1");

      expect(assignment.id).toBe("assign-1");
      expect(assignment.status).toBe("assigned");
    });

    it("throws when volunteer not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(assignToShift("bad-vol", "shift-1")).rejects.toThrow("Active volunteer not found");
    });

    it("throws when shift not found", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "vol-1" }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(assignToShift("vol-1", "bad-shift")).rejects.toThrow("Shift not found");
    });

    it("throws when shift is at max capacity", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "vol-1" }] })
        .mockResolvedValueOnce({ rows: [{ id: "shift-1", max_volunteers: 2 }] })
        .mockResolvedValueOnce({ rows: [{ count: "2" }] });

      await expect(assignToShift("vol-1", "shift-1")).rejects.toThrow("maximum capacity");
    });
  });

  describe("getShiftCoverage", () => {
    it("returns coverage data for a shift", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "shift-1", name: "Morning", min_volunteers: 3, max_volunteers: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: "2" }] })
        .mockResolvedValueOnce({ rows: [{ count: "1" }] });

      const coverage = await getShiftCoverage("shift-1");

      expect(coverage).not.toBeNull();
      expect(coverage!.shift_id).toBe("shift-1");
      expect(coverage!.min_volunteers).toBe(3);
      expect(coverage!.assigned_count).toBe(2);
      expect(coverage!.confirmed_count).toBe(1);
      expect(coverage!.is_covered).toBe(false);
      expect(coverage!.coverage_percentage).toBe(67);
    });

    it("returns null when shift not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const coverage = await getShiftCoverage("bad-shift");

      expect(coverage).toBeNull();
    });

    it("returns 100% coverage when min_volunteers is 0", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "shift-1", name: "Flex", min_volunteers: 0, max_volunteers: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] });

      const coverage = await getShiftCoverage("shift-1");

      expect(coverage!.coverage_percentage).toBe(100);
      expect(coverage!.is_covered).toBe(true);
    });

    it("caps coverage at 100%", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "shift-1", name: "Small", min_volunteers: 1, max_volunteers: 5 }] })
        .mockResolvedValueOnce({ rows: [{ count: "3" }] })
        .mockResolvedValueOnce({ rows: [{ count: "2" }] });

      const coverage = await getShiftCoverage("shift-1");

      expect(coverage!.coverage_percentage).toBe(100);
    });
  });
});
