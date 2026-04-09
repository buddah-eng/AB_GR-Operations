import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectRogueAccess, KNOWN_SYSTEM_ACTORS } from "./rogue-detection";

const mockQuery = vi.fn();
const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe("Rogue Actor Detection", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEmit.mockReset();
    mockCreateDomainEvent.mockReset();
    mockEmit.mockResolvedValue({});
    mockCreateDomainEvent.mockImplementation((params) => ({
      eventId: "evt-1",
      timestamp: new Date().toISOString(),
      ...params,
    }));
  });

  describe("detectRogueAccess", () => {
    it("creates admin alert and fires event when unclaimed trigger rows are found", async () => {
      // First call: unclaimed trigger rows query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "audit-1",
            table_name: "ontology_concepts",
            record_id: "rec-1",
            action: "INSERT",
            created_at: "2026-04-08T03:00:00Z",
          },
        ],
      });
      // Second call: unmatched API claims query
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Third call: INSERT into admin_alerts
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await detectRogueAccess(10);

      expect(result.unclaimedTriggerRows).toHaveLength(1);
      expect(result.unmatchedClaims).toHaveLength(0);
      expect(result.alertsCreated).toBe(1);

      // Verify alert was inserted
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO admin_alerts"),
        expect.arrayContaining(["critical", "rogue_actor"])
      );

      // Verify event was fired
      expect(mockCreateDomainEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "admin.alert.rogue_actor",
        })
      );
      expect(mockEmit).toHaveBeenCalled();
    });

    it("creates admin alert when unmatched API claims are found", async () => {
      // First call: unclaimed trigger rows — none
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Second call: unmatched API claims
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            change_set: "cs-orphan",
            endpoint: "POST /api/ontology/concepts",
            claimed_at: "2026-04-08T03:00:00Z",
          },
        ],
      });
      // Third call: INSERT into admin_alerts
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await detectRogueAccess(10);

      expect(result.unclaimedTriggerRows).toHaveLength(0);
      expect(result.unmatchedClaims).toHaveLength(1);
      expect(result.alertsCreated).toBe(1);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO admin_alerts"),
        expect.arrayContaining(["critical", "rogue_actor"])
      );
    });

    it("creates no alerts when no violations are found", async () => {
      // Both queries return empty
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await detectRogueAccess(10);

      expect(result.unclaimedTriggerRows).toHaveLength(0);
      expect(result.unmatchedClaims).toHaveLength(0);
      expect(result.alertsCreated).toBe(0);

      // Only the two detection queries, no alert insert
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("excludes known system actors from unclaimed trigger rows", async () => {
      // Unclaimed trigger rows — one from a migration table
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "audit-migration",
            table_name: "migration",
            record_id: "rec-m1",
            action: "INSERT",
            created_at: "2026-04-08T03:00:00Z",
          },
        ],
      });
      // Unmatched API claims — none
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await detectRogueAccess(10, KNOWN_SYSTEM_ACTORS);

      // The migration row should be filtered out
      expect(result.unclaimedTriggerRows).toHaveLength(0);
      expect(result.alertsCreated).toBe(0);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("creates alerts for both unclaimed and unmatched when both exist", async () => {
      // Unclaimed trigger rows
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "audit-rogue",
            table_name: "ontology_concepts",
            record_id: "rec-r1",
            action: "UPDATE",
            created_at: "2026-04-08T03:00:00Z",
          },
        ],
      });
      // Unmatched API claims
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            change_set: "cs-orphan",
            endpoint: "POST /api/domains/guest",
            claimed_at: "2026-04-08T03:00:00Z",
          },
        ],
      });
      // Two INSERT into admin_alerts calls
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const result = await detectRogueAccess(10);

      expect(result.unclaimedTriggerRows).toHaveLength(1);
      expect(result.unmatchedClaims).toHaveLength(1);
      expect(result.alertsCreated).toBe(2);
      expect(mockEmit).toHaveBeenCalledTimes(2);
    });

    it("uses custom known actors set when provided", async () => {
      const customKnown = new Set(["custom_cron_jobs"]);

      // Unclaimed row from custom_cron_jobs table
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "audit-cron",
            table_name: "custom_cron_jobs",
            record_id: "rec-c1",
            action: "INSERT",
            created_at: "2026-04-08T03:00:00Z",
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await detectRogueAccess(10, customKnown);

      // Should be filtered out because table_name exactly matches "custom_cron_jobs"
      expect(result.unclaimedTriggerRows).toHaveLength(0);
      expect(result.alertsCreated).toBe(0);
    });
  });

  describe("KNOWN_SYSTEM_ACTORS", () => {
    it("contains expected system actor IDs", () => {
      expect(KNOWN_SYSTEM_ACTORS.has("migration")).toBe(true);
      expect(KNOWN_SYSTEM_ACTORS.has("pg_cron")).toBe(true);
      expect(KNOWN_SYSTEM_ACTORS.has("seed_script")).toBe(true);
      expect(KNOWN_SYSTEM_ACTORS.has("system_maintenance")).toBe(true);
    });
  });
});
