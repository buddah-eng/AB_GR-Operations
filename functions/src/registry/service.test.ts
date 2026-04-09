import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findGuestByEmail,
  findGuestByName,
  getReturningGuests,
  createRegistryEntry,
  linkGuestToRegistry,
  prePopulateConventionYear,
  archiveConventionYear,
  getFrequentGuests,
  getReturnRateByDepartment,
  getYoyGrowth,
} from "./service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQuery = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function registryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "reg-1",
    canonical_name: "Tanaka Ichiro",
    email: "tanaka@example.com",
    external_ids: {},
    first_year: 2023,
    last_year: 2025,
    total_visits: 3,
    properties: { department: "Engineering", type: "JP", company: "TechCorp" },
    created_at: "2023-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Registry Service", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  // =========================================================================
  // 6.1 — Registry Lookup
  // =========================================================================

  describe("findGuestByEmail", () => {
    it("returns matching registry record", async () => {
      const row = registryRow();
      mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });

      const result = await findGuestByEmail("tanaka@example.com");

      expect(result).toEqual(row);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE email = $1"),
        ["tanaka@example.com"]
      );
    });

    it("returns null for unknown email", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await findGuestByEmail("unknown@example.com");

      expect(result).toBeNull();
    });
  });

  describe("findGuestByName", () => {
    it("returns fuzzy matches via ILIKE", async () => {
      const row = registryRow();
      mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });

      const results = await findGuestByName("Tanaka");

      expect(results).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ILIKE"),
        ["%Tanaka%"]
      );
    });
  });

  describe("getReturningGuests", () => {
    it("returns guests within lookback window", async () => {
      const row = registryRow({ last_year: 2025 });
      mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });

      const results = await getReturningGuests(2025);

      expect(results).toHaveLength(1);
      expect(results[0].last_year).toBe(2025);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("last_year >= $1"),
        [2025]
      );
    });

    it("excludes guests outside lookback window", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const results = await getReturningGuests(2026);

      expect(results).toHaveLength(0);
    });
  });

  // =========================================================================
  // 6.2 — Pre-Population
  // =========================================================================

  describe("prePopulateConventionYear", () => {
    it("creates draft records for returning guests", async () => {
      const row = registryRow();
      mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });

      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
      mockWithTransaction.mockImplementation(async (fn: Function) => fn(mockClient));

      const count = await prePopulateConventionYear(2027, 2025);

      expect(count).toBe(1);
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });

    it("sets correct registry_id FK", async () => {
      const row = registryRow({ id: "reg-abc" });
      mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });

      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
      mockWithTransaction.mockImplementation(async (fn: Function) => fn(mockClient));

      await prePopulateConventionYear(2027, 2025);

      const insertCall = mockClient.query.mock.calls[0];
      const params = insertCall[1] as unknown[];
      // registry_id is param $6
      expect(params[5]).toBe("reg-abc");
    });

    it("sets status='draft' and convention_year", async () => {
      const row = registryRow();
      mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });

      const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
      mockWithTransaction.mockImplementation(async (fn: Function) => fn(mockClient));

      await prePopulateConventionYear(2027, 2025);

      const insertCall = mockClient.query.mock.calls[0];
      const sql = insertCall[0] as string;
      const params = insertCall[1] as unknown[];
      expect(sql).toContain("'draft'");
      // convention_year is param $5
      expect(params[4]).toBe(2027);
    });

    it("returns 0 when no returning guests found", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const count = await prePopulateConventionYear(2027, 2026);

      expect(count).toBe(0);
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 6.3 — Archive
  // =========================================================================

  describe("archiveConventionYear", () => {
    it("updates registry last_year and total_visits", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 5 })  // registry update
        .mockResolvedValueOnce({ rows: [], rowCount: 5 }); // archive update

      await archiveConventionYear(2026);

      const registryCall = mockQuery.mock.calls[0];
      expect(registryCall[0]).toContain("UPDATE guest_registry");
      expect(registryCall[0]).toContain("last_year = $1");
      expect(registryCall[0]).toContain("total_visits = gr.total_visits + 1");
      expect(registryCall[1]).toEqual([2026]);
    });

    it("archives all convention-year records", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 3 })
        .mockResolvedValueOnce({ rows: [], rowCount: 10 });

      await archiveConventionYear(2026);

      const archiveCall = mockQuery.mock.calls[1];
      expect(archiveCall[0]).toContain("UPDATE guests SET archived = true");
      expect(archiveCall[0]).toContain("convention_year = $1");
      expect(archiveCall[1]).toEqual([2026]);
    });

    it("returns correct summary counts", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 7 })
        .mockResolvedValueOnce({ rows: [], rowCount: 10 });

      const summary = await archiveConventionYear(2026);

      expect(summary).toEqual({
        registryUpdated: 7,
        guestsArchived: 10,
      });
    });
  });

  // =========================================================================
  // 6.4 — Analytics
  // =========================================================================

  describe("getFrequentGuests", () => {
    it("returns guests with N+ visits", async () => {
      const rows = [
        registryRow({ id: "r1", total_visits: 5 }),
        registryRow({ id: "r2", total_visits: 3 }),
      ];
      mockQuery.mockResolvedValue({ rows, rowCount: 2 });

      const result = await getFrequentGuests(3);

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("total_visits >= $1"),
        [3]
      );
    });
  });

  describe("getReturnRateByDepartment", () => {
    it("handles zero-guest departments", async () => {
      const rows = [
        { department: "Engineering", total_guests: 5, returning_guests: 3, return_rate_pct: 60.0 },
        { department: null, total_guests: 0, returning_guests: 0, return_rate_pct: null },
      ];
      mockQuery.mockResolvedValue({ rows, rowCount: 2 });

      const result = await getReturnRateByDepartment();

      expect(result).toHaveLength(2);
      const nullDept = result.find((r) => r.department === null);
      expect(nullDept?.return_rate_pct).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("NULLIF(COUNT(DISTINCT id), 0)")
      );
    });
  });

  describe("getYoyGrowth", () => {
    it("handles single-year data gracefully", async () => {
      const rows = [
        { convention_year: 2026, total_guests: 50, growth: null, growth_pct: null },
      ];
      mockQuery.mockResolvedValue({ rows, rowCount: 1 });

      const result = await getYoyGrowth();

      expect(result).toHaveLength(1);
      expect(result[0].growth).toBeNull();
      expect(result[0].growth_pct).toBeNull();
    });
  });

  // =========================================================================
  // Additional — createRegistryEntry & linkGuestToRegistry
  // =========================================================================

  describe("createRegistryEntry", () => {
    it("inserts and returns the new record", async () => {
      const row = registryRow({ id: "new-id" });
      mockQuery.mockResolvedValue({ rows: [row], rowCount: 1 });

      const result = await createRegistryEntry({
        canonical_name: "Tanaka Ichiro",
        email: "tanaka@example.com",
        first_year: 2023,
      });

      expect(result.id).toBe("new-id");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO guest_registry"),
        expect.arrayContaining(["Tanaka Ichiro", "tanaka@example.com", 2023])
      );
    });
  });

  describe("linkGuestToRegistry", () => {
    it("updates guest record with registry_id", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      await linkGuestToRegistry("guest-1", "reg-1");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE guests SET registry_id = $1"),
        ["reg-1", "guest-1"]
      );
    });
  });
});
