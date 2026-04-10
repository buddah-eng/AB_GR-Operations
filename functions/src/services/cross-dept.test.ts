/**
 * Tests for Cross-Department Collaboration Service
 *
 * Covers:
 * - getSharedConcepts: with results, empty
 * - getCrossDeptDashboardData: aggregated widget data
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
}));

// --- Import module under test ---

import { getSharedConcepts, getCrossDeptDashboardData } from "./cross-dept";

// --- Tests ---

describe("getSharedConcepts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns org-scoped concepts with property counts", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          concept_key: "guest",
          concept_name: "Guest",
          plural_name: "Guests",
          owner_scope: "org",
          owner_department: null,
          property_count: "12",
        },
        {
          concept_key: "schedule",
          concept_name: "Schedule Event",
          plural_name: "Schedule Events",
          owner_scope: "org",
          owner_department: null,
          property_count: "8",
        },
      ],
    });

    const result = await getSharedConcepts();

    expect(result).toHaveLength(2);
    expect(result[0].conceptKey).toBe("guest");
    expect(result[0].conceptName).toBe("Guest");
    expect(result[0].ownerScope).toBe("org");
    expect(result[0].propertyCount).toBe(12);
    expect(result[1].conceptKey).toBe("schedule");
  });

  it("returns empty array when no shared concepts exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getSharedConcepts();

    expect(result).toHaveLength(0);
  });

  it("queries only org-scoped active concepts", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getSharedConcepts();

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("owner_scope = 'org'");
    expect(sql).toContain("oc.status = 'active'");
  });
});

describe("getCrossDeptDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates dashboard data from multiple queries", async () => {
    // guests by department
    mockQuery.mockResolvedValueOnce({
      rows: [
        { department: "gr", count: "15" },
        { department: "comms", count: "8" },
      ],
    });

    // schedule by department
    mockQuery.mockResolvedValueOnce({
      rows: [
        { department: "gr", count: "20" },
      ],
    });

    // staff by department
    mockQuery.mockResolvedValueOnce({
      rows: [
        { department: "gr", count: "30" },
        { department: "logistics", count: "12" },
      ],
    });

    // upcoming events
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "evt-1",
          name: "Keynote",
          start_time: new Date("2026-04-10T09:00:00Z"),
          end_time: new Date("2026-04-10T11:00:00Z"),
          department: "gr",
          venue_name: "Grand Ballroom",
        },
      ],
    });

    // overdue items
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "3" }] });

    // total guests
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "23" }] });

    // total staff
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "42" }] });

    // total events
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "20" }] });

    const result = await getCrossDeptDashboardData();

    expect(result.guestsByDepartment).toHaveLength(2);
    expect(result.guestsByDepartment[0].department).toBe("gr");
    expect(result.guestsByDepartment[0].count).toBe(15);

    expect(result.scheduleByDepartment).toHaveLength(1);

    expect(result.staffByDepartment).toHaveLength(2);

    expect(result.upcomingEvents).toHaveLength(1);
    expect(result.upcomingEvents[0].name).toBe("Keynote");
    expect(result.upcomingEvents[0].venueName).toBe("Grand Ballroom");

    expect(result.overdueItems).toBe(3);
    expect(result.totalGuests).toBe(23);
    expect(result.totalStaff).toBe(42);
    expect(result.totalScheduleEvents).toBe(20);
  });

  it("handles empty data gracefully", async () => {
    // All queries return empty results
    mockQuery.mockResolvedValueOnce({ rows: [] }); // guests by dept
    mockQuery.mockResolvedValueOnce({ rows: [] }); // schedule by dept
    mockQuery.mockResolvedValueOnce({ rows: [] }); // staff by dept
    mockQuery.mockResolvedValueOnce({ rows: [] }); // upcoming events
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // overdue
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // total guests
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // total staff
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // total events

    const result = await getCrossDeptDashboardData();

    expect(result.guestsByDepartment).toHaveLength(0);
    expect(result.scheduleByDepartment).toHaveLength(0);
    expect(result.staffByDepartment).toHaveLength(0);
    expect(result.upcomingEvents).toHaveLength(0);
    expect(result.overdueItems).toBe(0);
    expect(result.totalGuests).toBe(0);
    expect(result.totalStaff).toBe(0);
    expect(result.totalScheduleEvents).toBe(0);
  });

  it("handles null departments as unassigned", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ department: null, count: "5" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "5" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });

    const result = await getCrossDeptDashboardData();

    expect(result.guestsByDepartment[0].department).toBe("unassigned");
  });
});
