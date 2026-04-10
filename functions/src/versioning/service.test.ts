/**
 * Tests for Ontology Versioning Service
 *
 * Covers (per PRD section 6):
 * - 6.1 Version increment on update
 * - 6.2 Rollback swaps statuses
 * - Version history chain traversal
 * - Active version lookup
 * - Table name validation
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
const mockWithTransaction = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

const mockWithAuditContext = vi.fn();
vi.mock("../audit/context", () => ({
  withAuditContext: (...args: unknown[]) => mockWithAuditContext(...args),
}));

// --- Import module under test ---

import {
  updateOntologyRecord,
  rollbackOntologyRecord,
  getVersionHistory,
  getActiveVersion,
} from "./service";

// --- Fixtures ---

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-v1",
    key: "guest",
    name: "Guest",
    plural_name: "Guests",
    version: 1,
    status: "active",
    previous_version_id: null,
    changed_by: "user-1",
    changed_at: "2026-04-01T00:00:00Z",
    change_reason: "Initial creation",
    owner_scope: "org",
    owner_department: null,
    ...overrides,
  };
}

function makeMockClient() {
  return { query: vi.fn() };
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();

  // Default withTransaction: call the callback with a mock client
  mockWithTransaction.mockImplementation(
    async (fn: (client: ReturnType<typeof makeMockClient>) => Promise<unknown>) => {
      const mockClient = makeMockClient();
      return fn(mockClient);
    }
  );
});

// ============================================================
// 6.1 Version Increment on Update
// ============================================================

describe("updateOntologyRecord", () => {
  it("creates new row with version = old + 1", async () => {
    const oldRow = makeRow();
    const newRow = makeRow({ id: "row-v2", version: 2, previous_version_id: "row-v1" });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [oldRow] })       // SELECT active
        .mockResolvedValueOnce({ rows: [newRow] })        // INSERT new version
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE old to deprecated
      return fn(client);
    });

    const result = await updateOntologyRecord(
      "ontology_concepts", "guest", { name: "Guest Updated" }, "user-2", "Renamed concept"
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(2);
      expect(result.data.previous_version_id).toBe("row-v1");
    }
  });

  it("deprecates the old row", async () => {
    const oldRow = makeRow();
    const newRow = makeRow({ id: "row-v2", version: 2, status: "active" });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [oldRow] })
        .mockResolvedValueOnce({ rows: [newRow] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      return fn(client);
    });

    await updateOntologyRecord(
      "ontology_concepts", "guest", { name: "Updated" }, "user-2", "Update"
    );

    // The third query should be the UPDATE to deprecated
    // We need to inspect the mock client's calls. Since the mock is created
    // inside the implementation, we capture it via the result.
    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [oldRow] })
        .mockResolvedValueOnce({ rows: [newRow] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      const result = await fn(client);
      // Verify the deprecation query
      const deprecateCall = client.query.mock.calls[2];
      expect(deprecateCall[0]).toContain("SET status = 'deprecated'");
      expect(deprecateCall[1]).toEqual(["row-v1"]);
      return result;
    });

    await updateOntologyRecord(
      "ontology_concepts", "guest", { name: "Updated" }, "user-2", "Update"
    );
  });

  it("sets previous_version_id to old row's id", async () => {
    const oldRow = makeRow({ id: "original-id" });
    const newRow = makeRow({
      id: "new-id", version: 2, previous_version_id: "original-id",
    });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [oldRow] })
        .mockResolvedValueOnce({ rows: [newRow] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      return fn(client);
    });

    const result = await updateOntologyRecord(
      "ontology_concepts", "guest", { name: "V2" }, "user-2", "Upgrade"
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.previous_version_id).toBe("original-id");
    }
  });

  it("wraps both operations in a transaction", async () => {
    const oldRow = makeRow();
    const newRow = makeRow({ id: "row-v2", version: 2 });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [oldRow] })
        .mockResolvedValueOnce({ rows: [newRow] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });
      return fn(client);
    });

    await updateOntologyRecord(
      "ontology_concepts", "guest", { name: "V2" }, "user-2", "Update"
    );

    // withTransaction was called exactly once
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(mockWithTransaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it("returns error when no active record found", async () => {
    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query.mockResolvedValueOnce({ rows: [] });
      return fn(client);
    });

    const result = await updateOntologyRecord(
      "ontology_concepts", "nonexistent", { name: "V2" }, "user-2", "Update"
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});

// ============================================================
// 6.2 Rollback Swaps Statuses
// ============================================================

describe("rollbackOntologyRecord", () => {
  it("sets active row to 'rolled_back'", async () => {
    const activeRow = makeRow({ id: "row-v2", version: 2, previous_version_id: "row-v1" });
    const predecessorRow = makeRow({ id: "row-v1", version: 1, status: "deprecated" });
    const reactivatedRow = makeRow({ id: "row-v1", version: 1, status: "active" });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [activeRow] })        // SELECT active by id
        .mockResolvedValueOnce({ rows: [predecessorRow] })    // SELECT predecessor
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })     // UPDATE active -> rolled_back
        .mockResolvedValueOnce({ rows: [reactivatedRow] });   // UPDATE predecessor -> active
      const result = await fn(client);

      // Verify the rolled_back update
      const rollbackCall = client.query.mock.calls[2];
      expect(rollbackCall[0]).toContain("SET status = 'rolled_back'");
      expect(rollbackCall[1]).toEqual(["row-v2"]);

      return result;
    });

    const result = await rollbackOntologyRecord(
      "ontology_concepts", "row-v2", "admin-1", "Bad change"
    );

    expect(result.success).toBe(true);
  });

  it("reactivates the previous version", async () => {
    const activeRow = makeRow({ id: "row-v2", version: 2, previous_version_id: "row-v1" });
    const predecessorRow = makeRow({ id: "row-v1", version: 1, status: "deprecated" });
    const reactivatedRow = makeRow({
      id: "row-v1", version: 1, status: "active",
      change_reason: "Rollback of version 2 by admin-1: Bad change",
    });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [activeRow] })
        .mockResolvedValueOnce({ rows: [predecessorRow] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [reactivatedRow] });
      return fn(client);
    });

    const result = await rollbackOntologyRecord(
      "ontology_concepts", "row-v2", "admin-1", "Bad change"
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("active");
      expect(result.data.id).toBe("row-v1");
    }
  });

  it("sets change_reason with rollback note", async () => {
    const activeRow = makeRow({ id: "row-v2", version: 2, previous_version_id: "row-v1" });
    const predecessorRow = makeRow({ id: "row-v1", version: 1, status: "deprecated" });
    const reactivatedRow = makeRow({
      id: "row-v1", version: 1, status: "active",
      change_reason: "Rollback of version 2 by admin-1: Reverted bad data",
    });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [activeRow] })
        .mockResolvedValueOnce({ rows: [predecessorRow] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [reactivatedRow] });
      const result = await fn(client);

      // Verify the reactivation query includes the rollback note
      const reactivateCall = client.query.mock.calls[3];
      expect(reactivateCall[0]).toContain("change_reason");
      expect(reactivateCall[1]).toContain(
        "Rollback of version 2 by admin-1: Reverted bad data"
      );

      return result;
    });

    const result = await rollbackOntologyRecord(
      "ontology_concepts", "row-v2", "admin-1", "Reverted bad data"
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.change_reason).toContain("Rollback of version 2");
    }
  });

  it("fails if no previous version exists", async () => {
    const activeRow = makeRow({ id: "row-v1", version: 1, previous_version_id: null });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query.mockResolvedValueOnce({ rows: [activeRow] });
      return fn(client);
    });

    const result = await rollbackOntologyRecord(
      "ontology_concepts", "row-v1", "admin-1", "Cannot rollback"
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NO_PREVIOUS_VERSION");
    }
  });

  it("wraps both status changes in a transaction", async () => {
    const activeRow = makeRow({ id: "row-v2", version: 2, previous_version_id: "row-v1" });
    const predecessorRow = makeRow({ id: "row-v1", version: 1, status: "deprecated" });
    const reactivatedRow = makeRow({ id: "row-v1", version: 1, status: "active" });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [activeRow] })
        .mockResolvedValueOnce({ rows: [predecessorRow] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [reactivatedRow] });
      return fn(client);
    });

    await rollbackOntologyRecord(
      "ontology_concepts", "row-v2", "admin-1", "Rollback"
    );

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Version History (chain traversal)
// ============================================================

describe("getVersionHistory", () => {
  it("returns versions ordered DESC", async () => {
    const rows = [
      makeRow({ id: "row-v3", version: 3, status: "active" }),
      makeRow({ id: "row-v2", version: 2, status: "deprecated" }),
      makeRow({ id: "row-v1", version: 1, status: "deprecated" }),
    ];

    mockQuery.mockResolvedValue({ rows });

    const result = await getVersionHistory("ontology_concepts", "guest");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(3);
      expect(result.data[0].version).toBe(3);
      expect(result.data[1].version).toBe(2);
      expect(result.data[2].version).toBe(1);
    }
  });

  it("returns empty array for nonexistent key", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await getVersionHistory("ontology_concepts", "nonexistent");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it("uses recursive CTE query", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getVersionHistory("ontology_concepts", "guest");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WITH RECURSIVE"),
      ["guest"]
    );
  });
});

// ============================================================
// Active Version
// ============================================================

describe("getActiveVersion", () => {
  it("returns the active row", async () => {
    const row = makeRow();
    mockQuery.mockResolvedValue({ rows: [row] });

    const result = await getActiveVersion("ontology_concepts", "guest");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
      expect(result.data!.key).toBe("guest");
      expect(result.data!.status).toBe("active");
    }
  });

  it("returns null for nonexistent key", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await getActiveVersion("ontology_concepts", "nonexistent");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("queries with status = 'active'", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getActiveVersion("ontology_concepts", "guest");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      ["guest"]
    );
  });
});

// ============================================================
// Validation
// ============================================================

describe("table name validation", () => {
  it("rejects table names with invalid characters", async () => {
    const result = await getActiveVersion("ontology_concepts; DROP TABLE users", "guest");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_TABLE_NAME");
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects table names not in whitelist", async () => {
    const result = await getActiveVersion("users", "admin");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("TABLE_NOT_ALLOWED");
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects uppercase table names", async () => {
    const result = await getActiveVersion("Ontology_Concepts", "guest");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_TABLE_NAME");
    }
  });

  it("validates table name in updateOntologyRecord", async () => {
    const result = await updateOntologyRecord(
      "bad-table", "key", {}, "user", "reason"
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_TABLE_NAME");
    }
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("validates table name in rollbackOntologyRecord", async () => {
    const result = await rollbackOntologyRecord(
      "not_allowed_table", "id", "user", "reason"
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("TABLE_NOT_ALLOWED");
    }
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("validates table name in getVersionHistory", async () => {
    const result = await getVersionHistory("DROP TABLE foo", "key");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_TABLE_NAME");
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
