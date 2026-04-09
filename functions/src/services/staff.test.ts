import { describe, it, expect, vi, beforeEach } from "vitest";
import { listStaff, getStaffById, getStaffByDepartment, assignRole } from "./staff";
import type { Staff } from "./staff";

vi.mock("../db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

function makeStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: "staff-001",
    name: "Alice Volunteer",
    email: "alice@example.com",
    role_key: "liaison",
    department: "GR",
    phone: "555-0101",
    staff_type: "staff",
    skills: null,
    training_status: "pending",
    availability: {},
    emergency_contact: null,
    languages: null,
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    archived: false,
    ...overrides,
  };
}

describe("Staff Service", () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { query } = await import("../db/client");
    mockQuery = vi.mocked(query);
  });

  // --- listStaff ---

  describe("listStaff", () => {
    it("returns all non-archived staff when no filters provided", async () => {
      const staff = [makeStaff(), makeStaff({ id: "staff-002", name: "Bob" })];
      mockQuery.mockResolvedValueOnce({ rows: staff, rowCount: 2 });

      const result = await listStaff();

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledOnce();
      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain("archived = false");
      expect(callArgs[1]).toEqual([]);
    });

    it("applies department filter when provided", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeStaff()], rowCount: 1 });

      await listStaff({ department: "GR" });

      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain("department = $1");
      expect(callArgs[1]).toContain("GR");
    });

    it("applies multiple filters simultaneously", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await listStaff({ department: "GR", role_key: "liaison", staff_type: "volunteer" });

      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain("department = $1");
      expect(callArgs[0]).toContain("role_key = $2");
      expect(callArgs[0]).toContain("staff_type = $3");
      expect(callArgs[1]).toEqual(["GR", "liaison", "volunteer"]);
    });
  });

  // --- getStaffById ---

  describe("getStaffById", () => {
    it("returns a staff member when found", async () => {
      const staff = makeStaff();
      mockQuery.mockResolvedValueOnce({ rows: [staff], rowCount: 1 });

      const result = await getStaffById("staff-001");

      expect(result).toEqual(staff);
      expect(mockQuery).toHaveBeenCalledWith(
        "SELECT * FROM staff WHERE id = $1",
        ["staff-001"]
      );
    });

    it("returns null when staff not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await getStaffById("nonexistent");

      expect(result).toBeNull();
    });
  });

  // --- getStaffByDepartment ---

  describe("getStaffByDepartment", () => {
    it("returns staff filtered by department", async () => {
      const grStaff = [
        makeStaff({ department: "GR" }),
        makeStaff({ id: "staff-002", name: "Carol", department: "GR" }),
      ];
      mockQuery.mockResolvedValueOnce({ rows: grStaff, rowCount: 2 });

      const result = await getStaffByDepartment("GR");

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("department = $1"),
        ["GR"]
      );
    });
  });

  // --- assignRole ---

  describe("assignRole", () => {
    it("updates the role and returns the updated staff", async () => {
      const updated = makeStaff({ role_key: "coordinator" });
      mockQuery.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await assignRole("staff-001", "coordinator");

      expect(result).toEqual(updated);
      expect(result?.role_key).toBe("coordinator");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE staff SET role_key = $1"),
        ["coordinator", "staff-001"]
      );
    });

    it("returns null when staff ID does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await assignRole("nonexistent", "admin");

      expect(result).toBeNull();
    });
  });
});
