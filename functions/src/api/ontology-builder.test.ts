/**
 * Tests for the Ontology Builder API Router
 *
 * Covers:
 * - Concept CRUD (list, create, update, deprecate)
 * - Property CRUD (create with scope/conflict validation, deprecation guard)
 * - Default generation (FormConfig + ViewConfig)
 * - Safety guardrails (hidden+required, data-exists block)
 * - Audit trail (logAuditClaim, domain events, reloadOntology)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// --- Mocks (must be before import of module under test) ---

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
    const mockClient = { query: (...args: unknown[]) => mockQuery(...args) };
    return fn(mockClient);
  },
}));

const mockValidateScopePermission = vi.fn();
const mockBuildScopeFilter = vi.fn();
const mockCheckPropertyConflict = vi.fn();
const mockFormatPropertyKey = vi.fn();
const mockStripPropertyPrefix = vi.fn();
const mockGetVisibleProperties = vi.fn();
vi.mock("../ontology/scoping", () => ({
  DIRECTOR_PRIORITY: 0,
  ADMIN_PRIORITY_THRESHOLD: -1,
  validateScopePermission: (...args: unknown[]) => mockValidateScopePermission(...args),
  buildScopeFilter: (...args: unknown[]) => mockBuildScopeFilter(...args),
  checkPropertyConflict: (...args: unknown[]) => mockCheckPropertyConflict(...args),
  formatPropertyKey: (...args: unknown[]) => mockFormatPropertyKey(...args),
  stripPropertyPrefix: (...args: unknown[]) => mockStripPropertyPrefix(...args),
  getVisibleProperties: (...args: unknown[]) => mockGetVisibleProperties(...args),
}));

const mockUpdateOntologyRecord = vi.fn();
vi.mock("../versioning/service", () => ({
  updateOntologyRecord: (...args: unknown[]) => mockUpdateOntologyRecord(...args),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
  withAuditContext: async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: (...args: unknown[]) => mockQuery(...args) };
    return fn(mockClient);
  },
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(...args),
}));

const mockReloadOntology = vi.fn();
vi.mock("../ontology/loader", () => ({
  reloadOntology: (...args: unknown[]) => mockReloadOntology(...args),
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { ontologyBuilderRouter } from "./ontology-builder";

// --- Fixtures ---

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "human" as const,
  changeSet: "cs-builder-1",
};

function sampleConcept(overrides: Record<string, unknown> = {}) {
  return {
    id: "concept-1",
    key: "session",
    name: "Session",
    plural_name: "Sessions",
    icon: "calendar",
    description: "A convention session",
    owner_scope: "org",
    owner_department: null,
    version: 1,
    status: "active",
    ...overrides,
  };
}

function sampleProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    concept_key: "session",
    key: "title",
    label: "Title",
    type: "text",
    required: true,
    sort_order: 1,
    hidden: false,
    read_only: false,
    owner_scope: "org",
    owner_department: null,
    version: 1,
    status: "active",
    ...overrides,
  };
}

// --- Mock request/response helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "admin@example.com" },
    role: { roleKey: "admin", roleName: "Admin", priority: -2 },
    actorType: "human",
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null as unknown,
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this._json = data;
      return this;
    }),
  };
  return res as unknown as Response & { _json: unknown; statusCode: number };
}

// --- Find a route handler from the Express Router stack ---

type LayerMethod = "get" | "post" | "put" | "delete";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = ontologyBuilderRouter as any;
  const stack = router.stack as Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (...args: unknown[]) => unknown }>;
    };
  }>;

  for (const layer of stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method]
    ) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

// ============================================================
// Tests
// ============================================================

describe("GET /concepts (list)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/concepts");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
  });

  it("returns scope-filtered list of concepts", async () => {
    mockBuildScopeFilter.mockReturnValue({ clause: "1=1", params: [] });
    mockQuery.mockResolvedValue({
      rows: [sampleConcept(), sampleConcept({ id: "concept-2", key: "speaker", name: "Speaker" })],
    });

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(mockBuildScopeFilter).toHaveBeenCalledWith(-2, null);
  });
});

describe("POST /concepts (create)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/concepts");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-1", eventName: "concept.created" });
    mockEmit.mockResolvedValue(undefined);
    mockReloadOntology.mockResolvedValue(undefined);
  });

  it("creates concept with correct scope", async () => {
    mockValidateScopePermission.mockReturnValue({ allowed: true });
    mockQuery.mockResolvedValue({ rows: [sampleConcept()] });

    const req = mockReq({
      body: {
        key: "session",
        name: "Session",
        owner_scope: "org",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.key).toBe("session");
    expect(mockValidateScopePermission).toHaveBeenCalled();
    expect(mockReloadOntology).toHaveBeenCalledTimes(1);
  });

  it("rejects director creating org-wide concept (403)", async () => {
    mockValidateScopePermission.mockReturnValue({
      allowed: false,
      reason: "Only administrators can modify org-wide ontology records.",
    });

    const req = mockReq({
      body: { key: "session", name: "Session", owner_scope: "org" },
      role: { roleKey: "director", roleName: "Director", priority: 0 },
    } as Partial<Request>);
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("administrators");
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("PUT /concepts/:key (update)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("put", "/concepts/:key");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-2", eventName: "concept.updated" });
    mockEmit.mockResolvedValue(undefined);
    mockReloadOntology.mockResolvedValue(undefined);
  });

  it("creates new version via updateOntologyRecord", async () => {
    mockQuery.mockResolvedValue({ rows: [sampleConcept()] });
    mockValidateScopePermission.mockReturnValue({ allowed: true });

    const updatedData = {
      ...sampleConcept(),
      id: "concept-1-v2",
      version: 2,
      name: "Session v2",
    };
    mockUpdateOntologyRecord.mockResolvedValue({
      success: true,
      data: updatedData,
    });

    const req = mockReq({
      params: { key: "session" },
      body: { name: "Session v2", change_reason: "Renamed" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.version).toBe(2);
    expect(mockUpdateOntologyRecord).toHaveBeenCalledWith(
      "ontology_concepts",
      "session",
      expect.objectContaining({ name: "Session v2" }),
      "test-uid",
      "Renamed",
      AUDIT_CTX
    );
    expect(mockReloadOntology).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /concepts/:key (deprecate)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("delete", "/concepts/:key");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-3", eventName: "concept.deprecated" });
    mockEmit.mockResolvedValue(undefined);
    mockReloadOntology.mockResolvedValue(undefined);
  });

  it("deprecates concept (sets status='deprecated')", async () => {
    mockQuery.mockResolvedValue({ rows: [sampleConcept()] });
    mockValidateScopePermission.mockReturnValue({ allowed: true });

    const req = mockReq({ params: { key: "session" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("deprecated");

    // Verify the deprecation SQL was called
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'deprecated'"),
      ["session"]
    );
    expect(mockReloadOntology).toHaveBeenCalledTimes(1);
  });
});

describe("POST /concepts/:key/properties (create)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/concepts/:key/properties");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-4", eventName: "property.created" });
    mockEmit.mockResolvedValue(undefined);
    mockReloadOntology.mockResolvedValue(undefined);
  });

  it("validates scope and conflict for department property", async () => {
    mockValidateScopePermission.mockReturnValue({ allowed: true });
    mockCheckPropertyConflict.mockResolvedValue({ conflict: false });
    mockFormatPropertyKey.mockReturnValue("programming__title");
    mockStripPropertyPrefix.mockReturnValue("title");
    mockQuery.mockResolvedValue({ rows: [sampleProperty({ key: "programming__title" })] });

    const req = mockReq({
      params: { key: "session" },
      body: {
        key: "title",
        label: "Title",
        type: "text",
        owner_scope: "department",
        owner_department: "programming",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCheckPropertyConflict).toHaveBeenCalledWith("session", "title", "programming");
    expect(mockValidateScopePermission).toHaveBeenCalled();
    expect(mockFormatPropertyKey).toHaveBeenCalledWith("title", "programming");
  });

  it("rejects hidden+required combination", async () => {
    mockValidateScopePermission.mockReturnValue({ allowed: true });

    const req = mockReq({
      params: { key: "session" },
      body: {
        key: "secret_field",
        type: "text",
        hidden: true,
        required: true,
        owner_scope: "org",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("hidden");
    expect(body.error).toContain("required");
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("DELETE /properties/:id (deprecate)", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("delete", "/properties/:id");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-5", eventName: "property.deprecated" });
    mockEmit.mockResolvedValue(undefined);
    mockReloadOntology.mockResolvedValue(undefined);
  });

  it("blocks deletion when data exists (409 Conflict)", async () => {
    // First query: find the property
    mockQuery
      .mockResolvedValueOnce({ rows: [sampleProperty()] })
      // Second query: data check returns has_data = true
      .mockResolvedValueOnce({ rows: [{ has_data: true }] });

    const req = mockReq({ params: { id: "prop-1" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("has data");
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("POST /concepts/:key/generate-defaults", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/concepts/:key/generate-defaults");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-6", eventName: "concept.defaults_generated" });
    mockEmit.mockResolvedValue(undefined);
    mockReloadOntology.mockResolvedValue(undefined);
  });

  it("creates FormConfig + ViewConfig from concept properties", async () => {
    const props = [
      sampleProperty({ key: "title", type: "text", sort_order: 1, hidden: false }),
      sampleProperty({ key: "description", type: "rich_text", sort_order: 2, hidden: false }),
      sampleProperty({ key: "start_date", type: "date", sort_order: 3, hidden: false }),
      sampleProperty({ key: "status", type: "select", sort_order: 4, hidden: false }),
    ];

    // 1. concept lookup
    mockQuery.mockResolvedValueOnce({ rows: [sampleConcept()] });
    // 2. existing form check
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 3. existing view check
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 4. properties lookup
    mockQuery.mockResolvedValueOnce({ rows: props });
    // 5. INSERT form_configs
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "form-1", concept_key: "session", name: "default", fields: [] }],
    });
    // 6. INSERT view_configs
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "view-1", concept_key: "session", name: "default", columns: [] }],
    });

    const req = mockReq({ params: { key: "session" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { formConfig: unknown; viewConfig: unknown } };
    expect(body.success).toBe(true);
    expect(body.data.formConfig).toBeTruthy();
    expect(body.data.viewConfig).toBeTruthy();
    expect(mockReloadOntology).toHaveBeenCalledTimes(1);
  });
});

describe("Mutation side effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
    mockReloadOntology.mockResolvedValue(undefined);
  });

  it("fires domain event with changeSet on concept creation", async () => {
    const handler = findHandler("post", "/concepts");
    mockValidateScopePermission.mockReturnValue({ allowed: true });
    mockQuery.mockResolvedValue({ rows: [sampleConcept()] });
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-ce", eventName: "concept.created" });

    const req = mockReq({
      body: { key: "panel", name: "Panel", owner_scope: "org" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "concept.created",
        changeSet: "cs-builder-1",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("calls logAuditClaim on concept creation", async () => {
    const handler = findHandler("post", "/concepts");
    mockValidateScopePermission.mockReturnValue({ allowed: true });
    mockQuery.mockResolvedValue({ rows: [sampleConcept()] });
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-a", eventName: "concept.created" });

    const req = mockReq({
      body: { key: "panel", name: "Panel", owner_scope: "org" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockLogAuditClaim).toHaveBeenCalledWith(
      AUDIT_CTX,
      "POST /api/builder/concepts"
    );
  });

  it("calls reloadOntology for cache invalidation on property creation", async () => {
    const handler = findHandler("post", "/concepts/:key/properties");
    mockValidateScopePermission.mockReturnValue({ allowed: true });
    mockStripPropertyPrefix.mockReturnValue("location");
    mockQuery.mockResolvedValue({ rows: [sampleProperty({ key: "location" })] });
    mockCreateDomainEvent.mockReturnValue({ eventId: "evt-p", eventName: "property.created" });

    const req = mockReq({
      params: { key: "session" },
      body: {
        key: "location",
        type: "text",
        owner_scope: "org",
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(mockReloadOntology).toHaveBeenCalledTimes(1);
  });
});
