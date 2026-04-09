import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  queryByActorAndTimeRange,
  queryByTableRecent,
  queryDirectDbAccess,
  queryChangeSet,
  queryMostActiveActors,
  queryDeletedRecords,
} from "./forensics";

const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

function makeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    change_set: "cs-1",
    actor_id: "user-1",
    actor_type: "human",
    action: "INSERT",
    table_name: "ontology_concepts",
    record_id: "rec-1",
    old_data: null,
    new_data: { name: "test" },
    ip_address: null,
    session_id: null,
    created_at: "2026-04-08T03:00:00Z",
    ...overrides,
  };
}

describe("Audit Forensics", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("queryByActorAndTimeRange", () => {
    it("returns filtered results for an actor within a time range", async () => {
      const rows = [makeAuditRow(), makeAuditRow({ id: "row-2" })];
      mockQuery.mockResolvedValue({ rows });

      const result = await queryByActorAndTimeRange(
        "user-1",
        "2026-04-08T02:00:00Z",
        "2026-04-08T04:00:00Z"
      );

      expect(result).toHaveLength(2);
      expect(result[0].actor_id).toBe("user-1");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE actor_id = $1"),
        ["user-1", "2026-04-08T02:00:00Z", "2026-04-08T04:00:00Z", 100, 0]
      );
    });

    it("queries domain_audit_log when logTable option is set", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await queryByActorAndTimeRange(
        "user-1",
        "2026-04-08T00:00:00Z",
        "2026-04-08T12:00:00Z",
        { logTable: "domain_audit_log" }
      );

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("FROM domain_audit_log"),
        expect.any(Array)
      );
    });
  });

  describe("queryByTableRecent", () => {
    it("returns rows for a specific table in recent days", async () => {
      const rows = [makeAuditRow({ table_name: "ontology_concepts" })];
      mockQuery.mockResolvedValue({ rows });

      const result = await queryByTableRecent("ontology_concepts", 7);

      expect(result).toHaveLength(1);
      expect(result[0].table_name).toBe("ontology_concepts");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE table_name = $1"),
        ["ontology_concepts", 7, 100, 0]
      );
    });
  });

  describe("queryDirectDbAccess", () => {
    it("finds rows with pg_trigger_fallback actor_id", async () => {
      const rows = [
        makeAuditRow({ actor_id: "pg_trigger_fallback", actor_type: "system" }),
      ];
      mockQuery.mockResolvedValue({ rows });

      const result = await queryDirectDbAccess(24);

      expect(result).toHaveLength(1);
      expect(result[0].actor_id).toBe("pg_trigger_fallback");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("actor_id = 'pg_trigger_fallback'"),
        [24, 100, 0]
      );
    });
  });

  describe("queryChangeSet", () => {
    it("returns all rows grouped by change_set", async () => {
      const rows = [
        makeAuditRow({ change_set: "cs-abc", table_name: "ontology_concepts" }),
        makeAuditRow({ change_set: "cs-abc", table_name: "ontology_properties", id: "row-2" }),
      ];
      mockQuery.mockResolvedValue({ rows });

      const result = await queryChangeSet("cs-abc");

      expect(result).toHaveLength(2);
      expect(result[0].change_set).toBe("cs-abc");
      expect(result[1].change_set).toBe("cs-abc");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE change_set = $1"),
        ["cs-abc", 100, 0]
      );
    });
  });

  describe("queryMostActiveActors", () => {
    it("returns actors sorted by mutation count descending", async () => {
      const rows = [
        { actor_id: "user-A", actor_type: "human", mutations: 50 },
        { actor_id: "user-B", actor_type: "api_client", mutations: 30 },
      ];
      mockQuery.mockResolvedValue({ rows });

      const result = await queryMostActiveActors(24, 20);

      expect(result).toHaveLength(2);
      expect(result[0].mutations).toBe(50);
      expect(result[1].mutations).toBe(30);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("ORDER BY mutations DESC"),
        [24, 20]
      );
    });

    it("clamps limit to max 1000", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await queryMostActiveActors(24, 5000);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [24, 1000]
      );
    });
  });

  describe("queryDeletedRecords", () => {
    it("returns only DELETE action rows for a table", async () => {
      const rows = [
        makeAuditRow({ action: "DELETE", old_data: { name: "removed" }, new_data: null }),
      ];
      mockQuery.mockResolvedValue({ rows });

      const result = await queryDeletedRecords("ontology_concepts", 30);

      expect(result).toHaveLength(1);
      expect(result[0].action).toBe("DELETE");
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("action = 'DELETE'"),
        ["ontology_concepts", 30, 100, 0]
      );
    });
  });

  describe("Pagination", () => {
    it("applies custom page and limit", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await queryByActorAndTimeRange(
        "user-1",
        "2026-04-08T00:00:00Z",
        "2026-04-08T12:00:00Z",
        { page: 3, limit: 50 }
      );

      // page 3, limit 50 => offset 100
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ["user-1", "2026-04-08T00:00:00Z", "2026-04-08T12:00:00Z", 50, 100]
      );
    });

    it("clamps limit to max 1000", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await queryByTableRecent("ontology_concepts", 7, { limit: 2000 });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ["ontology_concepts", 7, 1000, 0]
      );
    });

    it("defaults to page 1, limit 100 when no options provided", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await queryDirectDbAccess(24);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [24, 100, 0]
      );
    });
  });

  describe("Empty results", () => {
    it("returns empty array when no rows match", async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await queryByActorAndTimeRange(
        "nonexistent-user",
        "2026-01-01T00:00:00Z",
        "2026-01-01T01:00:00Z"
      );

      expect(result).toEqual([]);
    });
  });

  describe("Table validation", () => {
    it("rejects invalid log table names", async () => {
      await expect(
        queryByActorAndTimeRange("user-1", "2026-01-01", "2026-01-02", {
          logTable: "malicious_table" as "ontology_audit_log",
        })
      ).rejects.toThrow("Invalid audit log table");
    });
  });
});
