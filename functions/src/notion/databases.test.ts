import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getDatabaseId,
  getOntologyDatabaseId,
  hasDatabaseId,
  reloadDatabaseRegistry,
  ONTOLOGY_DB_KEYS,
} from "./databases";

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe("Notion Database Registry", () => {
  beforeEach(() => {
    // Clean up env vars between tests
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("NOTION_DB_")) {
        delete process.env[key];
      }
    }
    reloadDatabaseRegistry();
  });

  // --- ONTOLOGY_DB_KEYS ---

  it("exports well-known ontology database keys", () => {
    expect(ONTOLOGY_DB_KEYS.concepts).toBe("ONTOLOGY_CONCEPTS");
    expect(ONTOLOGY_DB_KEYS.permissions).toBe("ONTOLOGY_PERMISSIONS");
    expect(ONTOLOGY_DB_KEYS.events_log).toBe("EVENTS_LOG");
    expect(ONTOLOGY_DB_KEYS.users).toBe("USERS");
  });

  // --- getDatabaseId ---

  describe("getDatabaseId", () => {
    it("returns the database ID from environment variable", () => {
      process.env.NOTION_DB_GUEST = "abc-123";
      reloadDatabaseRegistry();

      expect(getDatabaseId("guest")).toBe("abc-123");
    });

    it("is case-insensitive", () => {
      process.env.NOTION_DB_SCHEDULE = "sched-id";
      reloadDatabaseRegistry();

      expect(getDatabaseId("schedule")).toBe("sched-id");
      expect(getDatabaseId("SCHEDULE")).toBe("sched-id");
      expect(getDatabaseId("Schedule")).toBe("sched-id");
    });

    it("throws when database ID is not configured", () => {
      reloadDatabaseRegistry();

      expect(() => getDatabaseId("nonexistent")).toThrow(
        'No Notion database ID configured for "nonexistent"'
      );
    });

    it("strips NOTION_DB_ prefix to derive the logical key", () => {
      process.env.NOTION_DB_ONTOLOGY_CONCEPTS = "onto-concepts-id";
      reloadDatabaseRegistry();

      expect(getDatabaseId("ontology_concepts")).toBe("onto-concepts-id");
    });

    it("lazy-loads registry on first call", () => {
      process.env.NOTION_DB_STAFF = "staff-id";
      // No reloadDatabaseRegistry() — should auto-load
      reloadDatabaseRegistry();

      expect(getDatabaseId("staff")).toBe("staff-id");
    });
  });

  // --- getOntologyDatabaseId ---

  describe("getOntologyDatabaseId", () => {
    it("resolves ontology keys via ONTOLOGY_DB_KEYS mapping", () => {
      process.env.NOTION_DB_ONTOLOGY_CONCEPTS = "concepts-id";
      process.env.NOTION_DB_ONTOLOGY_PROPERTIES = "props-id";
      process.env.NOTION_DB_ONTOLOGY_PERMISSIONS = "perms-id";
      reloadDatabaseRegistry();

      expect(getOntologyDatabaseId("concepts")).toBe("concepts-id");
      expect(getOntologyDatabaseId("properties")).toBe("props-id");
      expect(getOntologyDatabaseId("permissions")).toBe("perms-id");
    });

    it("throws when ontology database is not configured", () => {
      reloadDatabaseRegistry();

      expect(() => getOntologyDatabaseId("concepts")).toThrow(
        "No Notion database ID configured"
      );
    });
  });

  // --- hasDatabaseId ---

  describe("hasDatabaseId", () => {
    it("returns true when ID is configured", () => {
      process.env.NOTION_DB_TRAVEL = "travel-id";
      reloadDatabaseRegistry();

      expect(hasDatabaseId("travel")).toBe(true);
    });

    it("returns false when ID is not configured", () => {
      reloadDatabaseRegistry();

      expect(hasDatabaseId("missing")).toBe(false);
    });

    it("is case-insensitive", () => {
      process.env.NOTION_DB_VENUES = "venues-id";
      reloadDatabaseRegistry();

      expect(hasDatabaseId("VENUES")).toBe(true);
      expect(hasDatabaseId("venues")).toBe(true);
    });
  });

  // --- reloadDatabaseRegistry ---

  describe("reloadDatabaseRegistry", () => {
    it("picks up new env vars after reload", () => {
      process.env.NOTION_DB_GUEST = "old-id";
      reloadDatabaseRegistry();
      expect(getDatabaseId("guest")).toBe("old-id");

      // Simulate config change
      process.env.NOTION_DB_GUEST = "new-id";
      reloadDatabaseRegistry();
      expect(getDatabaseId("guest")).toBe("new-id");
    });

    it("picks up newly added databases after reload", () => {
      reloadDatabaseRegistry();
      expect(hasDatabaseId("dietary")).toBe(false);

      process.env.NOTION_DB_DIETARY = "dietary-id";
      reloadDatabaseRegistry();
      expect(hasDatabaseId("dietary")).toBe(true);
      expect(getDatabaseId("dietary")).toBe("dietary-id");
    });
  });

  // --- Chained: full registry scenario ---

  describe("chained: multi-database resolution", () => {
    it("resolves all domain + ontology databases from env", () => {
      // Set up a realistic env
      process.env.NOTION_DB_GUEST = "guest-db";
      process.env.NOTION_DB_STAFF = "staff-db";
      process.env.NOTION_DB_SCHEDULE = "sched-db";
      process.env.NOTION_DB_TRAVEL = "travel-db";
      process.env.NOTION_DB_ACCOMMODATIONS = "accom-db";
      process.env.NOTION_DB_DIETARY = "dietary-db";
      process.env.NOTION_DB_ONTOLOGY_CONCEPTS = "concepts-db";
      process.env.NOTION_DB_ONTOLOGY_PROPERTIES = "props-db";
      process.env.NOTION_DB_ONTOLOGY_PERMISSIONS = "perms-db";
      process.env.NOTION_DB_EVENTS_LOG = "log-db";
      reloadDatabaseRegistry();

      // Domain databases
      expect(getDatabaseId("guest")).toBe("guest-db");
      expect(getDatabaseId("staff")).toBe("staff-db");
      expect(getDatabaseId("schedule")).toBe("sched-db");
      expect(getDatabaseId("travel")).toBe("travel-db");
      expect(getDatabaseId("accommodations")).toBe("accom-db");
      expect(getDatabaseId("dietary")).toBe("dietary-db");

      // Ontology databases
      expect(getOntologyDatabaseId("concepts")).toBe("concepts-db");
      expect(getOntologyDatabaseId("properties")).toBe("props-db");
      expect(getOntologyDatabaseId("permissions")).toBe("perms-db");
      expect(getOntologyDatabaseId("events_log")).toBe("log-db");
    });
  });
});
