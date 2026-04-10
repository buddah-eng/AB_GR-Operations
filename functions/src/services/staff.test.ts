/**
 * Tests for Staff Service
 *
 * Covers:
 * - listStaff with filters and pagination
 * - getStaffById
 * - getStaffByDepartment
 * - assignRole
 * - createStaff
 * - updateStaff
 * - archiveStaff
 * - rowToStaffRecord mapping
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
  listStaff,
  getStaffById,
  getStaffByDepartment,
  assignRole,
  createStaff,
  updateStaff,
  archiveStaff,
  rowToStaffRecord,
} from "./staff";

// --- Test data ---

const makeStaffRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "staff-1",
  name: "Jane Doe",
  email: "jane@example.com",
  role_key: "coordinator",
  department: "operations",
  phone: "+1234567890",
  staff_type: "staff",
  skills: ["logistics", "communication"],
  training_status: "completed",
  availability: { monday: true },
  emergency_contact: "John Doe: +1987654321",
  languages: ["en", "es"],
  active: true,
  properties: { badge_id: "B001" },
  created_at: new Date("2024-01-01T00:00:00Z"),
  updated_at: new Date("2024-06-01T00:00:00Z"),
  archived: false,
  ...overrides,
});

// --- Tests ---

describe("Staff Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rowToStaffRecord", () => {
    it("maps a database row to a StaffRecord", () => {
      const row = makeStaffRow();
      const record = rowToStaffRecord(row);

      expect(record.id).toBe("staff-1");
      expect(record.name).toBe("Jane Doe");
      expect(record.email).toBe("jane@example.com");
      expect(record.staff_type).toBe("staff");
      expect(record.skills).toEqual(["logistics", "communication"]);
      expect(record.training_status).toBe("completed");
      expect(record.languages).toEqual(["en", "es"]);
      expect(record.active).toBe(true);
    });

    it("handles null and missing fields with defaults", () => {
      const row = { id: "staff-2", name: "Min" };
      const record = rowToStaffRecord(row);

      expect(record.email).toBeNull();
      expect(record.role_key).toBeNull();
      expect(record.staff_type).toBe("staff");
      expect(record.skills).toEqual([]);
      expect(record.training_status).toBe("pending");
      expect(record.languages).toEqual([]);
      expect(record.active).toBe(true);
    });

    it("converts Date objects to ISO strings", () => {
      const row = makeStaffRow({
        created_at: new Date("2024-03-15T12:00:00Z"),
        updated_at: new Date("2024-03-16T12:00:00Z"),
      });
      const record = rowToStaffRecord(row);

      expect(record.created_at).toBe("2024-03-15T12:00:00.000Z");
      expect(record.updated_at).toBe("2024-03-16T12:00:00.000Z");
    });
  });

  describe("listStaff", () => {
    it("returns paginated results with defaults", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "2" }] })
        .mockResolvedValueOnce({ rows: [makeStaffRow(), makeStaffRow({ id: "staff-2", name: "Bob" })] });

      const result = await listStaff();

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.data).toHaveLength(2);
    });

    it("applies department filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeStaffRow()] });

      await listStaff({ department: "operations" });

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain("department = $1");
      expect(countCall[1]).toContain("operations");
    });

    it("applies staff_type filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeStaffRow({ staff_type: "volunteer" })] });

      await listStaff({ staff_type: "volunteer" });

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain("staff_type = $1");
      expect(countCall[1]).toContain("volunteer");
    });

    it("applies role_key filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "1" }] })
        .mockResolvedValueOnce({ rows: [makeStaffRow()] });

      await listStaff({ role_key: "coordinator" });

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain("role_key = $1");
    });

    it("applies active filter", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "0" }] })
        .mockResolvedValueOnce({ rows: [] });

      await listStaff({ active: false });

      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain("active = $1");
      expect(countCall[1]).toContain(false);
    });

    it("clamps page and limit values", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: "0" }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await listStaff({ page: -5, limit: 999 });

      expect(result.page).toBe(1);
      expect(result.limit).toBe(200);
    });
  });

  describe("getStaffById", () => {
    it("returns a staff record when found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeStaffRow()] });

      const staff = await getStaffById("staff-1");

      expect(staff).not.toBeNull();
      expect(staff!.id).toBe("staff-1");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = $1"),
        ["staff-1"]
      );
    });

    it("returns null when not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const staff = await getStaffById("nonexistent");

      expect(staff).toBeNull();
    });
  });

  describe("getStaffByDepartment", () => {
    it("returns staff for a department", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeStaffRow(), makeStaffRow({ id: "staff-2", name: "Alice" })],
      });

      const staff = await getStaffByDepartment("operations");

      expect(staff).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("department = $1"),
        ["operations"]
      );
    });

    it("returns empty array when no staff in department", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const staff = await getStaffByDepartment("unknown-dept");

      expect(staff).toHaveLength(0);
    });
  });

  describe("assignRole", () => {
    it("updates and returns the staff record", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeStaffRow({ role_key: "director" })],
      });

      const staff = await assignRole("staff-1", "director");

      expect(staff).not.toBeNull();
      expect(staff!.role_key).toBe("director");
    });

    it("returns null when staff not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const staff = await assignRole("nonexistent", "director");

      expect(staff).toBeNull();
    });

    it("works with a PoolClient", async () => {
      const mockClient = { query: vi.fn().mockResolvedValueOnce({ rows: [makeStaffRow()] }) };

      const staff = await assignRole("staff-1", "coordinator", mockClient as never);

      expect(staff).not.toBeNull();
      expect(mockClient.query).toHaveBeenCalled();
    });
  });

  describe("createStaff", () => {
    it("creates and returns a staff record", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeStaffRow()] });

      const staff = await createStaff({ name: "Jane Doe", email: "jane@example.com" });

      expect(staff.name).toBe("Jane Doe");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO staff"),
        expect.arrayContaining(["Jane Doe"])
      );
    });

    it("uses default values for optional fields", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeStaffRow()] });

      await createStaff({ name: "Bob" });

      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain(null); // email
      expect(params).toContain("staff"); // staff_type
      expect(params).toContain("pending"); // training_status
    });
  });

  describe("updateStaff", () => {
    it("updates and returns the staff record", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [makeStaffRow({ name: "Jane Updated" })],
      });

      const staff = await updateStaff("staff-1", { name: "Jane Updated" });

      expect(staff).not.toBeNull();
      expect(staff!.name).toBe("Jane Updated");
    });

    it("returns null when staff not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const staff = await updateStaff("nonexistent", { name: "Who" });

      expect(staff).toBeNull();
    });

    it("returns existing record when no changes provided", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeStaffRow()] });

      const staff = await updateStaff("staff-1", {});

      expect(staff).not.toBeNull();
      // Should call getStaffById internally
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE id = $1"),
        ["staff-1"]
      );
    });

    it("merges JSONB properties", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [makeStaffRow()] });

      await updateStaff("staff-1", { properties: { badge_id: "B002" } });

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain("properties = properties || $");
    });
  });

  describe("archiveStaff", () => {
    it("returns true when staff is archived", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await archiveStaff("staff-1");

      expect(result).toBe(true);
    });

    it("returns false when staff not found", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 });

      const result = await archiveStaff("nonexistent");

      expect(result).toBe(false);
    });
  });
});
