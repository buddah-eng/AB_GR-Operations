import { describe, it, expect, beforeEach, vi } from "vitest";
import { RoleEngine } from "./engine";
import { cache } from "../notion/cache";

// --- Mock the Notion boundary ---

const mockQueryDatabase = vi.fn();
const mockPageToFlatObject = vi.fn();

vi.mock("../notion/client", () => ({
  queryDatabase: (...args: unknown[]) => mockQueryDatabase(...args),
  pageToFlatObject: (...args: unknown[]) => mockPageToFlatObject(...args),
  createPage: vi.fn().mockResolvedValue({}),
}));

vi.mock("../notion/databases", () => ({
  getOntologyDatabaseId: vi.fn((key: string) => `fake-db-id-${key}`),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// --- Test data: permission rows as Notion would return them ---

function makePermissionRow(
  id: string,
  roleKey: string,
  conceptKey: string,
  overrides: Record<string, unknown> = {}
) {
  const flat = {
    "Role Key": roleKey,
    "Concept Key": conceptKey,
    "Can View": true,
    "Can Edit": false,
    "Can Create": false,
    "Can Delete": false,
    "Visible Properties": "name,status,type",
    "Editable Properties": "",
    ...overrides,
  };
  return { id, flat };
}

function makeDataScopeRow(
  id: string,
  roleKey: string,
  conceptKey: string,
  scopeType: string,
  extra: Record<string, unknown> = {}
) {
  const flat = {
    "Role Key": roleKey,
    "Concept Key": conceptKey,
    "Scope Type": scopeType,
    "Relation Path": undefined,
    "Field": undefined,
    "Value": undefined,
    ...extra,
  };
  return { id, flat };
}

// --- Setup: wire mock responses for queryDatabase + pageToFlatObject ---

function setupPermissionMocks(
  permissions: Array<ReturnType<typeof makePermissionRow>>,
  dataScopes: Array<ReturnType<typeof makeDataScopeRow>>
) {
  mockQueryDatabase.mockImplementation((dbId: string) => {
    if (dbId === "fake-db-id-permissions") {
      return Promise.resolve(permissions.map((p) => ({ ...p })));
    }
    if (dbId === "fake-db-id-data_scopes") {
      return Promise.resolve(dataScopes.map((d) => ({ ...d })));
    }
    return Promise.resolve([]);
  });

  mockPageToFlatObject.mockImplementation((row: Record<string, unknown>) => {
    return (row as { flat: Record<string, unknown> }).flat;
  });
}

describe("RoleEngine", () => {
  let engine: RoleEngine;

  beforeEach(() => {
    cache.clear();
    mockQueryDatabase.mockReset();
    mockPageToFlatObject.mockReset();
    engine = new RoleEngine();
  });

  // --- canPerformAction ---

  describe("canPerformAction", () => {
    it("returns true when role has the requested permission", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "director", "guest", {
            "Can View": true,
            "Can Edit": true,
            "Can Create": true,
            "Can Delete": true,
          }),
        ],
        []
      );

      expect(await engine.canPerformAction("director", "guest", "view")).toBe(true);
      expect(await engine.canPerformAction("director", "guest", "create")).toBe(true);
      expect(await engine.canPerformAction("director", "guest", "edit")).toBe(true);
      expect(await engine.canPerformAction("director", "guest", "delete")).toBe(true);
    });

    it("returns false when role lacks the requested permission", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "volunteer", "guest", {
            "Can View": true,
            "Can Edit": false,
            "Can Create": false,
            "Can Delete": false,
          }),
        ],
        []
      );

      expect(await engine.canPerformAction("volunteer", "guest", "view")).toBe(true);
      expect(await engine.canPerformAction("volunteer", "guest", "edit")).toBe(false);
      expect(await engine.canPerformAction("volunteer", "guest", "create")).toBe(false);
      expect(await engine.canPerformAction("volunteer", "guest", "delete")).toBe(false);
    });

    it("returns false when no permission record exists for the role+concept", async () => {
      setupPermissionMocks(
        [makePermissionRow("p1", "director", "guest")],
        []
      );

      expect(await engine.canPerformAction("volunteer", "guest", "view")).toBe(false);
      expect(await engine.canPerformAction("director", "schedule", "view")).toBe(false);
    });

    it("maps event action synonyms correctly", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "liaison", "guest", {
            "Can View": true,
            "Can Edit": true,
            "Can Create": true,
            "Can Delete": false,
          }),
        ],
        []
      );

      // EventAction → CrudAction mapping
      expect(await engine.canPerformAction("liaison", "guest", "created")).toBe(true);
      expect(await engine.canPerformAction("liaison", "guest", "updated")).toBe(true);
      expect(await engine.canPerformAction("liaison", "guest", "update")).toBe(true);
      expect(await engine.canPerformAction("liaison", "guest", "deleted")).toBe(false);
      // Unknown actions fall back to "view"
      expect(await engine.canPerformAction("liaison", "guest", "synced")).toBe(true);
    });
  });

  // --- getVisibleProperties ---

  describe("getVisibleProperties", () => {
    it("returns the property list for a valid role+concept", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "liaison", "guest", {
            "Visible Properties": "name,status,type,company",
          }),
        ],
        []
      );

      const props = await engine.getVisibleProperties("liaison", "guest");
      expect(props).toEqual(["name", "status", "type", "company"]);
    });

    it("returns empty array when no permission record exists", async () => {
      setupPermissionMocks([], []);

      const props = await engine.getVisibleProperties("unknown", "guest");
      expect(props).toEqual([]);
    });

    it("handles comma-separated string values", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "volunteer", "guest", {
            "Visible Properties": "name, department, photo",
          }),
        ],
        []
      );

      const props = await engine.getVisibleProperties("volunteer", "guest");
      expect(props).toEqual(["name", "department", "photo"]);
    });
  });

  // --- getEditableProperties ---

  describe("getEditableProperties", () => {
    it("returns editable properties when defined", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "liaison", "guest", {
            "Visible Properties": "name,status,type,company",
            "Editable Properties": "status,company",
          }),
        ],
        []
      );

      const editable = await engine.getEditableProperties("liaison", "guest");
      expect(editable).toEqual(["status", "company"]);
    });

    it("falls back to visible properties when editable is not defined", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "director", "guest", {
            "Visible Properties": "name,status,type",
            "Editable Properties": "",
          }),
        ],
        []
      );

      const editable = await engine.getEditableProperties("director", "guest");
      // Empty string parses to empty array → fallback to visibleProperties
      expect(editable).toEqual(["name", "status", "type"]);
    });
  });

  // --- filterRecord ---

  describe("filterRecord", () => {
    it("strips properties the role cannot see", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "volunteer", "guest", {
            "Visible Properties": "name,department",
          }),
        ],
        []
      );

      const record = {
        name: "Tanaka Yuki",
        department: "Anime",
        dietary: "Vegan",
        travelConfirmation: "ABC123",
        salary: 50000,
      };

      const filtered = await engine.filterRecord("volunteer", "guest", record);
      expect(filtered).toEqual({
        name: "Tanaka Yuki",
        department: "Anime",
      });
    });

    it("returns empty object when no permission exists (deny by default)", async () => {
      setupPermissionMocks([], []);

      const filtered = await engine.filterRecord("unknown", "guest", {
        name: "Secret Guest",
        status: "VIP",
      });

      expect(filtered).toEqual({});
    });
  });

  // --- filterWritePayload ---

  describe("filterWritePayload", () => {
    it("strips non-editable properties from write payload", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "liaison", "guest", {
            "Visible Properties": "name,status,type,company",
            "Editable Properties": "status",
          }),
        ],
        []
      );

      const payload = {
        name: "Hijacked Name",
        status: "Confirmed",
        type: "JP",
      };

      const filtered = await engine.filterWritePayload("liaison", "guest", payload);
      expect(filtered).toEqual({ status: "Confirmed" });
    });
  });

  // --- buildDataScopeFilter ---

  describe("buildDataScopeFilter", () => {
    it("returns undefined for scope type 'all' (no restriction)", async () => {
      setupPermissionMocks(
        [],
        [makeDataScopeRow("ds1", "director", "guest", "all")]
      );

      const filter = await engine.buildDataScopeFilter("director", "guest", "user-123");
      expect(filter).toBeUndefined();
    });

    it("builds relation filter for scope type 'relation'", async () => {
      setupPermissionMocks(
        [],
        [
          makeDataScopeRow("ds1", "liaison", "guest", "relation", {
            "Relation Path": "Assigned Liaison",
          }),
        ]
      );

      const filter = await engine.buildDataScopeFilter("liaison", "guest", "user-abc");
      expect(filter).toEqual({
        property: "Assigned Liaison",
        relation: { contains: "user-abc" },
      });
    });

    it("builds field filter for scope type 'field'", async () => {
      setupPermissionMocks(
        [],
        [
          makeDataScopeRow("ds1", "dept_head", "guest", "field", {
            "Field": "Department",
            "Value": "Anime",
          }),
        ]
      );

      const filter = await engine.buildDataScopeFilter("dept_head", "guest", "user-xyz");
      expect(filter).toEqual({
        property: "Department",
        rich_text: { equals: "Anime" },
      });
    });

    it("builds department filter for scope type 'department'", async () => {
      setupPermissionMocks(
        [],
        [
          makeDataScopeRow("ds1", "dept_head", "staff", "department", {
            "Field": "Department",
            "Value": "Gaming",
          }),
        ]
      );

      const filter = await engine.buildDataScopeFilter("dept_head", "staff", "user-xyz");
      expect(filter).toEqual({
        property: "Department",
        select: { equals: "Gaming" },
      });
    });

    it("returns undefined when no data scope exists for role+concept", async () => {
      setupPermissionMocks([], []);

      const filter = await engine.buildDataScopeFilter("volunteer", "guest", "user-123");
      expect(filter).toBeUndefined();
    });
  });

  // --- reload ---

  describe("reload", () => {
    it("forces fresh load on next access after reload", async () => {
      setupPermissionMocks(
        [
          makePermissionRow("p1", "director", "guest", {
            "Can View": true,
          }),
        ],
        []
      );

      // First access loads from "Notion"
      expect(await engine.canPerformAction("director", "guest", "view")).toBe(true);
      const firstCallCount = mockQueryDatabase.mock.calls.length;

      // Reload clears cache
      engine.reload();

      // Second access should hit "Notion" again
      expect(await engine.canPerformAction("director", "guest", "view")).toBe(true);
      expect(mockQueryDatabase.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });

  // --- Chained RBAC scenario ---

  describe("chained RBAC scenario: multi-role access control", () => {
    beforeEach(() => {
      setupPermissionMocks(
        [
          // Director: full access
          makePermissionRow("p1", "director", "guest", {
            "Can View": true,
            "Can Edit": true,
            "Can Create": true,
            "Can Delete": true,
            "Visible Properties": "name,status,type,company,dietary,travel_confirmation,salary",
            "Editable Properties": "name,status,type,company,dietary,travel_confirmation,salary",
          }),
          // Liaison: view + edit assigned guests, limited fields
          makePermissionRow("p2", "liaison", "guest", {
            "Can View": true,
            "Can Edit": true,
            "Can Create": false,
            "Can Delete": false,
            "Visible Properties": "name,status,type,company,dietary",
            "Editable Properties": "status",
          }),
          // Volunteer: view-only, minimal fields
          makePermissionRow("p3", "volunteer", "guest", {
            "Can View": true,
            "Can Edit": false,
            "Can Create": false,
            "Can Delete": false,
            "Visible Properties": "name,department",
          }),
        ],
        [
          // Director: sees all records
          makeDataScopeRow("ds1", "director", "guest", "all"),
          // Liaison: sees only assigned guests
          makeDataScopeRow("ds2", "liaison", "guest", "relation", {
            "Relation Path": "Assigned Liaison",
          }),
          // Volunteer: sees only guests in their department
          makeDataScopeRow("ds3", "volunteer", "guest", "department", {
            "Field": "Department",
            "Value": "Anime",
          }),
        ]
      );
    });

    const guestRecord = {
      name: "Miyazaki Hayao",
      status: "Confirmed",
      type: "JP",
      company: "Studio Ghibli",
      dietary: "Vegetarian",
      travel_confirmation: "JAL-12345",
      salary: 0,
      department: "Anime",
    };

    it("director sees all fields", async () => {
      const filtered = await engine.filterRecord("director", "guest", guestRecord);
      expect(Object.keys(filtered)).toHaveLength(7);
      expect(filtered).toHaveProperty("salary");
      expect(filtered).toHaveProperty("travel_confirmation");
    });

    it("liaison sees limited fields but can edit status", async () => {
      const filtered = await engine.filterRecord("liaison", "guest", guestRecord);
      expect(Object.keys(filtered)).toHaveLength(5);
      expect(filtered).not.toHaveProperty("salary");
      expect(filtered).not.toHaveProperty("travel_confirmation");

      const writeFiltered = await engine.filterWritePayload("liaison", "guest", {
        name: "Hijack",
        status: "Cancelled",
      });
      expect(writeFiltered).toEqual({ status: "Cancelled" });
    });

    it("volunteer sees only name and department", async () => {
      const filtered = await engine.filterRecord("volunteer", "guest", guestRecord);
      expect(filtered).toEqual({
        name: "Miyazaki Hayao",
        department: "Anime",
      });
    });

    it("director has no data scope filter", async () => {
      const filter = await engine.buildDataScopeFilter("director", "guest", "admin-001");
      expect(filter).toBeUndefined();
    });

    it("liaison data scope is relation-based", async () => {
      const filter = await engine.buildDataScopeFilter("liaison", "guest", "liaison-001");
      expect(filter).toEqual({
        property: "Assigned Liaison",
        relation: { contains: "liaison-001" },
      });
    });

    it("volunteer data scope is department-based", async () => {
      const filter = await engine.buildDataScopeFilter("volunteer", "guest", "vol-001");
      expect(filter).toEqual({
        property: "Department",
        select: { equals: "Anime" },
      });
    });
  });
});
