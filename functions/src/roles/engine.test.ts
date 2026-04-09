import { describe, it, expect, beforeEach, vi } from "vitest";
import { RoleEngine } from "./engine";
import { cache } from "../cache";

// --- Mock the Postgres boundary ---

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

// --- Test data helpers ---

function makePermissionRow(
  id: string,
  roleKey: string,
  conceptKey: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    role_key: roleKey,
    concept_key: conceptKey,
    can_view: true,
    can_edit: false,
    can_create: false,
    can_delete: false,
    visible_properties: ["name", "status", "type"],
    editable_properties: null,
    ...overrides,
  };
}

function makeDataScopeRow(
  id: string,
  roleKey: string,
  conceptKey: string,
  scopeType: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    role_key: roleKey,
    concept_key: conceptKey,
    scope_type: scopeType,
    relation_path: null,
    field: null,
    value: null,
    ...extra,
  };
}

function makeScreenAccessRow(
  id: string,
  roleKey: string,
  pageSlug: string,
  visible: boolean
): Record<string, unknown> {
  return {
    id,
    role_key: roleKey,
    page_slug: pageSlug,
    visible,
  };
}

// --- Setup: wire mock query responses ---

function setupMocks(
  permissions: Record<string, unknown>[],
  dataScopes: Record<string, unknown>[],
  screenAccess: Record<string, unknown>[] = []
) {
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("FROM permissions")) {
      return Promise.resolve({ rows: permissions, rowCount: permissions.length });
    }
    if (sql.includes("FROM data_scopes")) {
      return Promise.resolve({ rows: dataScopes, rowCount: dataScopes.length });
    }
    if (sql.includes("FROM screen_access")) {
      return Promise.resolve({ rows: screenAccess, rowCount: screenAccess.length });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe("RoleEngine", () => {
  let engine: RoleEngine;

  beforeEach(() => {
    cache.clear();
    mockQuery.mockReset();
    engine = new RoleEngine();
  });

  // --- canPerformAction ---

  describe("canPerformAction", () => {
    it("returns true when role has the requested permission", async () => {
      setupMocks(
        [
          makePermissionRow("p1", "director", "guest", {
            can_view: true,
            can_edit: true,
            can_create: true,
            can_delete: true,
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
      setupMocks(
        [
          makePermissionRow("p1", "volunteer", "guest", {
            can_view: true,
            can_edit: false,
            can_create: false,
            can_delete: false,
          }),
        ],
        []
      );

      expect(await engine.canPerformAction("volunteer", "guest", "view")).toBe(true);
      expect(await engine.canPerformAction("volunteer", "guest", "edit")).toBe(false);
      expect(await engine.canPerformAction("volunteer", "guest", "create")).toBe(false);
      expect(await engine.canPerformAction("volunteer", "guest", "delete")).toBe(false);
    });

    it("returns false when no permission record exists (deny by default)", async () => {
      setupMocks(
        [makePermissionRow("p1", "director", "guest")],
        []
      );

      expect(await engine.canPerformAction("volunteer", "guest", "view")).toBe(false);
      expect(await engine.canPerformAction("director", "schedule", "view")).toBe(false);
    });

    it("maps event action synonyms correctly", async () => {
      setupMocks(
        [
          makePermissionRow("p1", "liaison", "guest", {
            can_view: true,
            can_edit: true,
            can_create: true,
            can_delete: false,
          }),
        ],
        []
      );

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
      setupMocks(
        [
          makePermissionRow("p1", "liaison", "guest", {
            visible_properties: ["name", "status", "type", "company"],
          }),
        ],
        []
      );

      const props = await engine.getVisibleProperties("liaison", "guest");
      expect(props).toEqual(["name", "status", "type", "company"]);
    });

    it("returns empty array when no permission record exists", async () => {
      setupMocks([], []);

      const props = await engine.getVisibleProperties("unknown", "guest");
      expect(props).toEqual([]);
    });
  });

  // --- getEditableProperties ---

  describe("getEditableProperties", () => {
    it("returns editable properties when defined", async () => {
      setupMocks(
        [
          makePermissionRow("p1", "liaison", "guest", {
            visible_properties: ["name", "status", "type", "company"],
            editable_properties: ["status", "company"],
          }),
        ],
        []
      );

      const editable = await engine.getEditableProperties("liaison", "guest");
      expect(editable).toEqual(["status", "company"]);
    });

    it("falls back to visible properties when editable is not defined", async () => {
      setupMocks(
        [
          makePermissionRow("p1", "director", "guest", {
            visible_properties: ["name", "status", "type"],
            editable_properties: null,
          }),
        ],
        []
      );

      const editable = await engine.getEditableProperties("director", "guest");
      expect(editable).toEqual(["name", "status", "type"]);
    });
  });

  // --- filterRecord ---

  describe("filterRecord", () => {
    it("strips properties the role cannot see", async () => {
      setupMocks(
        [
          makePermissionRow("p1", "volunteer", "guest", {
            visible_properties: ["name", "department"],
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
      setupMocks([], []);

      const filtered = await engine.filterRecord("unknown", "guest", {
        name: "Secret Guest",
        status: "VIP",
      });

      expect(filtered).toEqual({});
    });

    it("does not mutate the input record", async () => {
      setupMocks(
        [makePermissionRow("p1", "volunteer", "guest", { visible_properties: ["name"] })],
        []
      );

      const record = { name: "Test", status: "Active", secret: "hidden" };
      const original = { ...record };
      await engine.filterRecord("volunteer", "guest", record);
      expect(record).toEqual(original);
    });
  });

  // --- filterWritePayload ---

  describe("filterWritePayload", () => {
    it("strips non-editable properties from write payload", async () => {
      setupMocks(
        [
          makePermissionRow("p1", "liaison", "guest", {
            visible_properties: ["name", "status", "type", "company"],
            editable_properties: ["status"],
          }),
        ],
        []
      );

      const payload = { name: "Hijacked Name", status: "Confirmed", type: "JP" };
      const filtered = await engine.filterWritePayload("liaison", "guest", payload);
      expect(filtered).toEqual({ status: "Confirmed" });
    });

    it("returns empty object when no permission exists", async () => {
      setupMocks([], []);
      const filtered = await engine.filterWritePayload("unknown", "guest", { name: "test" });
      expect(filtered).toEqual({});
    });
  });

  // --- buildDataScopeFilter ---

  describe("buildDataScopeFilter", () => {
    it("returns undefined for scope type 'all' (no restriction)", async () => {
      setupMocks([], [makeDataScopeRow("ds1", "director", "guest", "all")]);

      const filter = await engine.buildDataScopeFilter("director", "guest", "user-123");
      expect(filter).toBeUndefined();
    });

    it("builds relation filter for scope type 'relation'", async () => {
      setupMocks(
        [],
        [makeDataScopeRow("ds1", "liaison", "guest", "relation", { relation_path: "assigned_liaison" })]
      );

      const filter = await engine.buildDataScopeFilter("liaison", "guest", "user-abc");
      expect(filter).toEqual({ column: "assigned_liaison", operator: "=", value: "user-abc" });
    });

    it("builds field filter for scope type 'field'", async () => {
      setupMocks(
        [],
        [makeDataScopeRow("ds1", "dept_head", "guest", "field", { field: "department", value: "Anime" })]
      );

      const filter = await engine.buildDataScopeFilter("dept_head", "guest", "user-xyz");
      expect(filter).toEqual({ column: "department", operator: "=", value: "Anime" });
    });

    it("builds department filter for scope type 'department'", async () => {
      setupMocks(
        [],
        [makeDataScopeRow("ds1", "dept_head", "staff", "department", { field: "department", value: "Gaming" })]
      );

      const filter = await engine.buildDataScopeFilter("dept_head", "staff", "user-xyz");
      expect(filter).toEqual({ column: "department", operator: "=", value: "Gaming" });
    });

    it("returns undefined when no data scope exists for role+concept", async () => {
      setupMocks([], []);

      const filter = await engine.buildDataScopeFilter("volunteer", "guest", "user-123");
      expect(filter).toBeUndefined();
    });
  });

  // --- reload ---

  describe("reload", () => {
    it("forces fresh load on next access after reload", async () => {
      setupMocks(
        [makePermissionRow("p1", "director", "guest", { can_view: true })],
        []
      );

      expect(await engine.canPerformAction("director", "guest", "view")).toBe(true);
      const firstCallCount = mockQuery.mock.calls.length;

      engine.reload();

      expect(await engine.canPerformAction("director", "guest", "view")).toBe(true);
      expect(mockQuery.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });

  // --- Chained RBAC scenario ---

  describe("chained RBAC scenario: multi-role access control", () => {
    beforeEach(() => {
      setupMocks(
        [
          makePermissionRow("p1", "director", "guest", {
            can_view: true, can_edit: true, can_create: true, can_delete: true,
            visible_properties: ["name", "status", "type", "company", "dietary", "travel_confirmation", "salary"],
            editable_properties: ["name", "status", "type", "company", "dietary", "travel_confirmation", "salary"],
          }),
          makePermissionRow("p2", "liaison", "guest", {
            can_view: true, can_edit: true, can_create: false, can_delete: false,
            visible_properties: ["name", "status", "type", "company", "dietary"],
            editable_properties: ["status"],
          }),
          makePermissionRow("p3", "volunteer", "guest", {
            can_view: true, can_edit: false, can_create: false, can_delete: false,
            visible_properties: ["name", "department"],
          }),
        ],
        [
          makeDataScopeRow("ds1", "director", "guest", "all"),
          makeDataScopeRow("ds2", "liaison", "guest", "relation", { relation_path: "assigned_liaison" }),
          makeDataScopeRow("ds3", "volunteer", "guest", "department", { field: "department", value: "Anime" }),
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
        name: "Hijack", status: "Cancelled",
      });
      expect(writeFiltered).toEqual({ status: "Cancelled" });
    });

    it("volunteer sees only name and department", async () => {
      const filtered = await engine.filterRecord("volunteer", "guest", guestRecord);
      expect(filtered).toEqual({ name: "Miyazaki Hayao", department: "Anime" });
    });

    it("director has no data scope filter", async () => {
      const filter = await engine.buildDataScopeFilter("director", "guest", "admin-001");
      expect(filter).toBeUndefined();
    });

    it("liaison data scope is relation-based", async () => {
      const filter = await engine.buildDataScopeFilter("liaison", "guest", "liaison-001");
      expect(filter).toEqual({ column: "assigned_liaison", operator: "=", value: "liaison-001" });
    });

    it("volunteer data scope is department-based", async () => {
      const filter = await engine.buildDataScopeFilter("volunteer", "guest", "vol-001");
      expect(filter).toEqual({ column: "department", operator: "=", value: "Anime" });
    });
  });

  // --- Screen Access (PRD Section 6) ---

  describe("checkScreenAccess", () => {
    it("returns false when no screen_access row exists for the role+page (deny by default)", async () => {
      setupMocks([], [], [
        makeScreenAccessRow("sa1", "director", "dashboard", true),
      ]);

      expect(await engine.checkScreenAccess("volunteer", "dashboard")).toBe(false);
      expect(await engine.checkScreenAccess("director", "settings")).toBe(false);
    });

    it("returns true when visible is true for the role+page", async () => {
      setupMocks([], [], [
        makeScreenAccessRow("sa1", "director", "dashboard", true),
        makeScreenAccessRow("sa2", "director", "guests", true),
      ]);

      expect(await engine.checkScreenAccess("director", "dashboard")).toBe(true);
      expect(await engine.checkScreenAccess("director", "guests")).toBe(true);
    });

    it("returns false when visible is false for the role+page", async () => {
      setupMocks([], [], [
        makeScreenAccessRow("sa1", "volunteer", "admin-panel", false),
      ]);

      expect(await engine.checkScreenAccess("volunteer", "admin-panel")).toBe(false);
    });
  });

  describe("getScreenAccess", () => {
    it("returns only screen_access records for the given role", async () => {
      setupMocks([], [], [
        makeScreenAccessRow("sa1", "director", "dashboard", true),
        makeScreenAccessRow("sa2", "director", "guests", true),
        makeScreenAccessRow("sa3", "volunteer", "dashboard", true),
        makeScreenAccessRow("sa4", "liaison", "guests", false),
      ]);

      const directorAccess = await engine.getScreenAccess("director");
      expect(directorAccess).toHaveLength(2);
      expect(directorAccess.every((s) => s.roleKey === "director")).toBe(true);

      const volunteerAccess = await engine.getScreenAccess("volunteer");
      expect(volunteerAccess).toHaveLength(1);
      expect(volunteerAccess[0].pageSlug).toBe("dashboard");
    });
  });

  describe("reload clears screen access cache", () => {
    it("forces fresh screen_access load after reload", async () => {
      setupMocks([], [], [
        makeScreenAccessRow("sa1", "director", "dashboard", true),
      ]);

      expect(await engine.checkScreenAccess("director", "dashboard")).toBe(true);
      const firstCallCount = mockQuery.mock.calls.length;

      engine.reload();

      expect(await engine.checkScreenAccess("director", "dashboard")).toBe(true);
      expect(mockQuery.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });

  // --- Edge Cases (PRD Section 7.3) ---

  describe("edge cases (PRD 7.3)", () => {
    it("E-02: empty visibleProperties array causes filterRecord to return {}", async () => {
      setupMocks(
        [
          makePermissionRow("p1", "intern", "guest", {
            can_view: true,
            visible_properties: [],
          }),
        ],
        []
      );

      const record = { name: "Test Guest", status: "Confirmed", type: "JP" };
      const filtered = await engine.filterRecord("intern", "guest", record);
      expect(filtered).toEqual({});
    });

    it("E-03: data scope relation type with null relation_path returns undefined", async () => {
      setupMocks(
        [],
        [makeDataScopeRow("ds1", "liaison", "guest", "relation", { relation_path: null })]
      );

      const filter = await engine.buildDataScopeFilter("liaison", "guest", "user-abc");
      expect(filter).toBeUndefined();
    });

    it("E-04: data scope field type with null field returns undefined", async () => {
      setupMocks(
        [],
        [makeDataScopeRow("ds1", "dept_head", "guest", "field", { field: null, value: "Anime" })]
      );

      const filter = await engine.buildDataScopeFilter("dept_head", "guest", "user-xyz");
      expect(filter).toBeUndefined();
    });

    it("E-04b: data scope field type with null value returns undefined", async () => {
      setupMocks(
        [],
        [makeDataScopeRow("ds1", "dept_head", "guest", "field", { field: "department", value: null })]
      );

      const filter = await engine.buildDataScopeFilter("dept_head", "guest", "user-xyz");
      expect(filter).toBeUndefined();
    });

    it("E-07: role with zero permission rows returns false for all actions and [] for properties", async () => {
      setupMocks(
        [
          // Other roles have permissions, but "observer" has none
          makePermissionRow("p1", "director", "guest", { can_view: true }),
        ],
        []
      );

      expect(await engine.canPerformAction("observer", "guest", "view")).toBe(false);
      expect(await engine.canPerformAction("observer", "guest", "create")).toBe(false);
      expect(await engine.canPerformAction("observer", "guest", "edit")).toBe(false);
      expect(await engine.canPerformAction("observer", "guest", "delete")).toBe(false);

      expect(await engine.getVisibleProperties("observer", "guest")).toEqual([]);
      expect(await engine.getEditableProperties("observer", "guest")).toEqual([]);
    });
  });
});
