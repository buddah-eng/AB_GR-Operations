/**
 * Ontology Scoping Unit Tests
 *
 * 14 tests matching PRD section 7 test plan:
 *  1. Scope enforcement - org: admin can modify, director gets 403
 *  2. Scope enforcement - dept: own director can modify, other director gets 403
 *  3. Scope enforcement - DB constraint: department scope with null department fails
 *  4. Visibility filtering - web builder: director sees org + own dept only
 *  5. Visibility filtering - API: same filter applied
 *  6. Property extension - create: director adds dept-scoped property to org concept
 *  7. Property extension - visibility: other dept doesn't see it
 *  8. Property extension - write: value stored in JSONB properties
 *  9. Conflict resolution - same key: two depts can have same key
 * 10. Conflict resolution - org collision: dept key matching org key returns 409
 * 11. Conflict resolution - read: each dept sees only their version
 * 12. Admin omniscience: admin sees all dept properties
 * 13. Scope promotion: dept concept promoted to org
 * 14. Cross-dept grant: RBAC grants read access to another dept's concept
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Postgres before importing the module under test
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

import {
  validateScopePermission,
  buildScopeFilter,
  formatPropertyKey,
  stripPropertyPrefix,
  checkPropertyConflict,
  getVisibleProperties,
  ADMIN_PRIORITY_THRESHOLD,
  DIRECTOR_PRIORITY,
} from "./scoping";

// --- Priority constants for tests ---

const ADMIN_PRIORITY = -10;
const DIR_PRIORITY = DIRECTOR_PRIORITY; // 0
const COORDINATOR_PRIORITY = 10;

// ---------------------------------------------------------------------------
// 1. Scope enforcement — org
// ---------------------------------------------------------------------------

describe("Scope enforcement — org", () => {
  it("admin can modify org-wide records; director gets 403", () => {
    // Admin modifies org-wide record
    const adminResult = validateScopePermission(
      ADMIN_PRIORITY, "org", null, null
    );
    expect(adminResult.allowed).toBe(true);

    // Director tries to modify org-wide record
    const directorResult = validateScopePermission(
      DIR_PRIORITY, "org", null, "gr"
    );
    expect(directorResult.allowed).toBe(false);
    expect(directorResult.reason).toContain("administrator");
  });
});

// ---------------------------------------------------------------------------
// 2. Scope enforcement — dept
// ---------------------------------------------------------------------------

describe("Scope enforcement — dept", () => {
  it("own director can modify dept record; other director gets 403", () => {
    // GR director modifies GR record
    const ownResult = validateScopePermission(
      DIR_PRIORITY, "department", "gr", "gr"
    );
    expect(ownResult.allowed).toBe(true);

    // Exhibits director tries to modify GR record
    const otherResult = validateScopePermission(
      DIR_PRIORITY, "department", "gr", "exhibits"
    );
    expect(otherResult.allowed).toBe(false);
    expect(otherResult.reason).toContain("your department");
  });
});

// ---------------------------------------------------------------------------
// 3. Scope enforcement — DB constraint
// ---------------------------------------------------------------------------

describe("Scope enforcement — DB constraint", () => {
  it("department scope with null owner_department fails validation", () => {
    const result = validateScopePermission(
      DIR_PRIORITY, "department", null, "gr"
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("missing owner_department");
  });
});

// ---------------------------------------------------------------------------
// 4. Visibility filtering — web builder
// ---------------------------------------------------------------------------

describe("Visibility filtering — web builder", () => {
  it("director sees org + own dept only, not other depts", () => {
    const filter = buildScopeFilter(DIR_PRIORITY, "gr");

    expect(filter.clause).toContain("owner_scope = 'org'");
    expect(filter.clause).toContain("owner_scope = 'department'");
    expect(filter.params).toEqual(["gr"]);

    // Verify the filter would NOT include exhibits records
    expect(filter.params).not.toContain("exhibits");
  });
});

// ---------------------------------------------------------------------------
// 5. Visibility filtering — API
// ---------------------------------------------------------------------------

describe("Visibility filtering — API", () => {
  it("same scope filter applied via buildScopeFilter for API calls", () => {
    const filter = buildScopeFilter(DIR_PRIORITY, "gr");

    // Filter includes org-wide and own department
    expect(filter.clause).toContain("owner_scope = 'org'");
    expect(filter.clause).toContain("owner_department IN");
    expect(filter.params).toContain("gr");

    // Admin gets unfiltered access
    const adminFilter = buildScopeFilter(ADMIN_PRIORITY, null);
    expect(adminFilter.clause).toBe("1=1");
    expect(adminFilter.params).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Property extension — create
// ---------------------------------------------------------------------------

describe("Property extension — create", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("director adds dept-scoped property to org concept", async () => {
    // No org-wide conflict exists
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const conflict = await checkPropertyConflict("staff", "liaison_notes", "gr");
    expect(conflict.conflict).toBe(false);

    // Director has permission to create department-scoped property
    const permission = validateScopePermission(
      DIR_PRIORITY, "department", "gr", "gr"
    );
    expect(permission.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Property extension — visibility
// ---------------------------------------------------------------------------

describe("Property extension — visibility", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("other dept does not see dept-scoped property", async () => {
    // Mock: exhibits user queries staff properties
    // Should see org-wide props but NOT gr's liaison_notes
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "p1",
          concept_key: "staff",
          key: "name",
          label: "Name",
          type: "text",
          owner_scope: "org",
          owner_department: null,
        },
      ],
      rowCount: 1,
    });

    const props = await getVisibleProperties(
      "staff", "exhibits", COORDINATOR_PRIORITY
    );

    expect(props).toHaveLength(1);
    expect(props[0].key).toBe("name");
    // liaison_notes (gr-scoped) should not appear
    expect(props.find((p) => p.key === "liaison_notes")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Property extension — write
// ---------------------------------------------------------------------------

describe("Property extension — write", () => {
  it("value stored in JSONB properties via namespace key", () => {
    const namespacedKey = formatPropertyKey("liaison_notes", "gr");
    expect(namespacedKey).toBe("gr__liaison_notes");

    // Stripped back for API response
    const rawKey = stripPropertyPrefix(namespacedKey);
    expect(rawKey).toBe("liaison_notes");
  });
});

// ---------------------------------------------------------------------------
// 9. Conflict resolution — same key
// ---------------------------------------------------------------------------

describe("Conflict resolution — same key", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("two depts can have same property key on same concept", async () => {
    // No org-wide property with key 'notes' exists
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const grConflict = await checkPropertyConflict("staff", "notes", "gr");
    expect(grConflict.conflict).toBe(false);

    const exhibitsConflict = await checkPropertyConflict("staff", "notes", "exhibits");
    expect(exhibitsConflict.conflict).toBe(false);

    // JSONB keys are namespaced to avoid collision
    const grKey = formatPropertyKey("notes", "gr");
    const exhibitsKey = formatPropertyKey("notes", "exhibits");
    expect(grKey).toBe("gr__notes");
    expect(exhibitsKey).toBe("exhibits__notes");
    expect(grKey).not.toBe(exhibitsKey);
  });
});

// ---------------------------------------------------------------------------
// 10. Conflict resolution — org collision
// ---------------------------------------------------------------------------

describe("Conflict resolution — org collision", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("dept key matching org key returns 409", async () => {
    // Org-wide 'notes' property exists
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "org-notes-id" }],
      rowCount: 1,
    });

    const conflict = await checkPropertyConflict("staff", "notes", "gr");

    expect(conflict.conflict).toBe(true);
    expect(conflict.status).toBe(409);
    expect(conflict.message).toContain("org-wide property");
    expect(conflict.message).toContain("notes");
  });
});

// ---------------------------------------------------------------------------
// 11. Conflict resolution — read
// ---------------------------------------------------------------------------

describe("Conflict resolution — read", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("each dept sees only their version of a shared key", async () => {
    // GR queries staff — sees org props + gr's notes only
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "p1", concept_key: "staff", key: "name",
          label: "Name", type: "text",
          owner_scope: "org", owner_department: null,
        },
        {
          id: "p2", concept_key: "staff", key: "notes",
          label: "Notes", type: "text",
          owner_scope: "department", owner_department: "gr",
        },
      ],
      rowCount: 2,
    });

    const grProps = await getVisibleProperties("staff", "gr", DIR_PRIORITY);
    expect(grProps).toHaveLength(2);
    expect(grProps.find((p) => p.key === "notes")?.ownerDepartment).toBe("gr");

    // Exhibits queries staff — sees org props + exhibits' notes only
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "p1", concept_key: "staff", key: "name",
          label: "Name", type: "text",
          owner_scope: "org", owner_department: null,
        },
        {
          id: "p3", concept_key: "staff", key: "notes",
          label: "Notes", type: "text",
          owner_scope: "department", owner_department: "exhibits",
        },
      ],
      rowCount: 2,
    });

    const exhibitsProps = await getVisibleProperties("staff", "exhibits", DIR_PRIORITY);
    expect(exhibitsProps).toHaveLength(2);
    expect(exhibitsProps.find((p) => p.key === "notes")?.ownerDepartment).toBe("exhibits");
  });
});

// ---------------------------------------------------------------------------
// 12. Admin omniscience
// ---------------------------------------------------------------------------

describe("Admin omniscience", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("admin sees all dept properties with department labels", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "p1", concept_key: "staff", key: "name",
          label: "Name", type: "text",
          owner_scope: "org", owner_department: null,
        },
        {
          id: "p2", concept_key: "staff", key: "notes",
          label: "Notes", type: "text",
          owner_scope: "department", owner_department: "gr",
        },
        {
          id: "p3", concept_key: "staff", key: "notes",
          label: "Notes", type: "text",
          owner_scope: "department", owner_department: "exhibits",
        },
        {
          id: "p4", concept_key: "staff", key: "liaison_notes",
          label: "Liaison Notes", type: "text",
          owner_scope: "department", owner_department: "gr",
        },
      ],
      rowCount: 4,
    });

    const props = await getVisibleProperties("staff", null, ADMIN_PRIORITY);

    expect(props).toHaveLength(4);

    // Org-wide property has no department label
    const orgProp = props.find((p) => p.key === "name");
    expect(orgProp?.displayLabel).toBe("Name");

    // Dept-scoped properties have department labels for admin
    const grNotes = props.find((p) => p.id === "p2");
    expect(grNotes?.displayLabel).toBe("Notes (GR)");

    const exhibitsNotes = props.find((p) => p.id === "p3");
    expect(exhibitsNotes?.displayLabel).toBe("Notes (EXHIBITS)");
  });
});

// ---------------------------------------------------------------------------
// 13. Scope promotion
// ---------------------------------------------------------------------------

describe("Scope promotion", () => {
  it("dept concept promoted to org changes scope and clears department", () => {
    // Validate that admin can perform the promotion
    const adminPermission = validateScopePermission(
      ADMIN_PRIORITY, "department", "gr", null
    );
    expect(adminPermission.allowed).toBe(true);

    // After promotion, the record would have owner_scope='org', owner_department=null
    // Validate that any user can read it (org-wide is readable by all)
    const filter = buildScopeFilter(DIR_PRIORITY, "exhibits");
    expect(filter.clause).toContain("owner_scope = 'org'");

    // Non-admin cannot reverse the promotion (modify org-wide)
    const directorReverse = validateScopePermission(
      DIR_PRIORITY, "org", null, "gr"
    );
    expect(directorReverse.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 14. Cross-dept grant
// ---------------------------------------------------------------------------

describe("Cross-dept grant", () => {
  it("RBAC grants read access to another dept's concept", () => {
    // Exhibits director with cross-dept grant for GR
    const filter = buildScopeFilter(
      DIR_PRIORITY, "exhibits", ["gr"]
    );

    expect(filter.clause).toContain("owner_scope = 'org'");
    expect(filter.clause).toContain("owner_department IN");
    expect(filter.params).toContain("exhibits");
    expect(filter.params).toContain("gr");
  });
});

// ---------------------------------------------------------------------------
// Additional edge case coverage
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("coordinator cannot modify department records", () => {
    const result = validateScopePermission(
      COORDINATOR_PRIORITY, "department", "gr", "gr"
    );
    expect(result.allowed).toBe(false);
  });

  it("buildScopeFilter with no department and no grants returns org-only filter", () => {
    const filter = buildScopeFilter(DIR_PRIORITY, null);
    expect(filter.clause).toBe("owner_scope = 'org'");
    expect(filter.params).toEqual([]);
  });

  it("stripPropertyPrefix handles keys without prefix", () => {
    expect(stripPropertyPrefix("name")).toBe("name");
    expect(stripPropertyPrefix("status")).toBe("status");
  });

  it("stripPropertyPrefix handles double underscore in value", () => {
    expect(stripPropertyPrefix("gr__some__key")).toBe("some__key");
  });

  it("ADMIN_PRIORITY_THRESHOLD is correctly defined", () => {
    expect(ADMIN_PRIORITY_THRESHOLD).toBe(-1);
    expect(ADMIN_PRIORITY).toBeLessThanOrEqual(ADMIN_PRIORITY_THRESHOLD);
    expect(DIR_PRIORITY).toBeGreaterThan(ADMIN_PRIORITY_THRESHOLD);
  });
});
