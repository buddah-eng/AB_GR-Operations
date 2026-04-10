/**
 * Tests for Template API Router
 *
 * Covers:
 * - GET /  — list templates with filters
 * - GET /:id  — get single template
 * - POST /  — create template with audit context
 * - PUT /:id  — update creates new version
 * - DELETE /:id  — deprecates template
 * - POST /:id/apply  — calls applyTemplate
 * - POST /import  — handles import
 * - GET /export  — returns JSON export
 * - Auth enforcement on mutations
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

const mockListTemplates = vi.fn();
const mockGetTemplateById = vi.fn();
const mockCreateTemplate = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockDeleteTemplate = vi.fn();
const mockGetTemplateHistory = vi.fn();
const mockApplyTemplate = vi.fn();
const mockExportTemplates = vi.fn();
const mockImportTemplates = vi.fn();

vi.mock("../templates/service", () => ({
  listTemplates: (...args: unknown[]) => mockListTemplates(...args),
  getTemplateById: (...args: unknown[]) => mockGetTemplateById(...args),
  createTemplate: (...args: unknown[]) => mockCreateTemplate(...args),
  updateTemplate: (...args: unknown[]) => mockUpdateTemplate(...args),
  deleteTemplate: (...args: unknown[]) => mockDeleteTemplate(...args),
  getTemplateHistory: (...args: unknown[]) => mockGetTemplateHistory(...args),
  applyTemplate: (...args: unknown[]) => mockApplyTemplate(...args),
  exportTemplates: (...args: unknown[]) => mockExportTemplates(...args),
  importTemplates: (...args: unknown[]) => mockImportTemplates(...args),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    const input = args[0] as Record<string, unknown>;
    return { eventId: "evt-t-1", eventName: input.eventName, ...input };
  },
}));

let mockRequireRoleReject = false;
vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (req: Request, res: Response, next: () => void) => {
    if (mockRequireRoleReject) {
      res.status(403).json({ success: false, error: "Insufficient permissions for this action." });
      return;
    }
    next();
  },
}));

// --- Import module under test ---

import { templateRouter } from "./templates";

// --- Fixtures ---

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "human" as const,
  changeSet: "cs-t-123",
};

// --- Mock request/response helpers ---

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "admin@example.com" },
    role: { roleKey: "coordinator", roleName: "Coordinator", priority: 10 },
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
  const router = templateRouter as any;
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
// GET / — list templates
// ============================================================

describe("GET /", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("get", "/");
  });

  it("returns filtered list of templates", async () => {
    const templates = [
      { id: "tpl-1", name: "Guest Batch", template_type: "record_set" },
    ];
    mockListTemplates.mockResolvedValue({ success: true, data: templates });

    const req = mockReq({ query: { type: "record_set" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(mockListTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ type: "record_set" })
    );
  });
});

// ============================================================
// POST / — create template
// ============================================================

describe("POST /", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("post", "/");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates template with audit context and fires event", async () => {
    const created = { id: "tpl-new", name: "New Template", template_type: "notification" };
    mockCreateTemplate.mockResolvedValue({ success: true, data: created });

    const req = mockReq({
      body: {
        template_type: "notification",
        name: "New Template",
        content: { subject: "Hi", body: "Hello" },
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("tpl-new");

    expect(mockLogAuditClaim).toHaveBeenCalledWith(AUDIT_CTX, "POST /api/templates");
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "template.created",
        changeSet: "cs-t-123",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when required fields missing", async () => {
    const req = mockReq({ body: { name: "Incomplete" } });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Missing required fields");
  });
});

// ============================================================
// PUT /:id — update template
// ============================================================

describe("PUT /:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("put", "/:id");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates new version via updateTemplate", async () => {
    const updated = { id: "tpl-v2", name: "Updated", version: 2 };
    mockUpdateTemplate.mockResolvedValue({ success: true, data: updated });

    const req = mockReq({
      params: { id: "tpl-v1" },
      body: { name: "Updated", changeReason: "Renamed" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string; version: number } };
    expect(body.success).toBe(true);
    expect(body.data.version).toBe(2);

    expect(mockUpdateTemplate).toHaveBeenCalledWith(
      "tpl-v1",
      expect.objectContaining({ name: "Updated" }),
      "test-uid",
      "Renamed",
      AUDIT_CTX
    );
  });

  it("returns 400 when changeReason missing", async () => {
    const req = mockReq({
      params: { id: "tpl-v1" },
      body: { name: "No Reason" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("changeReason");
  });
});

// ============================================================
// DELETE /:id — deprecate template
// ============================================================

describe("DELETE /:id", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("delete", "/:id");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("deprecates template and fires event", async () => {
    const deprecated = { id: "tpl-1", status: "deprecated" };
    mockDeleteTemplate.mockResolvedValue({ success: true, data: deprecated });

    const req = mockReq({ params: { id: "tpl-1" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "template.deleted",
        action: "deleted",
      })
    );
  });
});

// ============================================================
// POST /:id/apply — apply template
// ============================================================

describe("POST /:id/apply", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("post", "/:id/apply");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("calls applyTemplate and fires event", async () => {
    const applyResult = {
      applied: true,
      template_type: "record_set",
      detail: "Created 5 records",
      records_created: 5,
    };
    mockApplyTemplate.mockResolvedValue({ success: true, data: applyResult });

    const req = mockReq({
      params: { id: "tpl-1" },
      body: { context: { table_name: "domain_records" } },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: typeof applyResult };
    expect(body.success).toBe(true);
    expect(body.data.records_created).toBe(5);

    expect(mockApplyTemplate).toHaveBeenCalledWith("tpl-1", { table_name: "domain_records" }, AUDIT_CTX);
    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "template.applied" })
    );
  });
});

// ============================================================
// POST /import — import templates
// ============================================================

describe("POST /import", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("post", "/import");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("handles import and fires event", async () => {
    const imported = [{ id: "tpl-imp-1", name: "Imported" }];
    mockImportTemplates.mockResolvedValue({ success: true, data: imported });

    const req = mockReq({
      body: {
        format: "gr-ops-template-v1",
        exported_at: "2026-04-01T00:00:00Z",
        templates: [{ template_type: "notification", name: "Test", content: {} }],
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "template.imported" })
    );
  });

  it("returns 400 when format/templates missing", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Missing required fields");
  });
});

// ============================================================
// GET /export — export templates
// ============================================================

describe("GET /export", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = false;
    handler = findHandler("get", "/export");
  });

  it("returns JSON export with format version", async () => {
    const exportData = {
      format: "gr-ops-template-v1",
      exported_at: "2026-04-08T00:00:00Z",
      templates: [{ id: "tpl-1", name: "Test" }],
    };
    mockExportTemplates.mockResolvedValue({ success: true, data: exportData });

    const req = mockReq({ query: { type: "record_set" } });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: typeof exportData };
    expect(body.success).toBe(true);
    expect(body.data.format).toBe("gr-ops-template-v1");
    expect(body.data.templates).toHaveLength(1);
  });
});

// ============================================================
// Auth enforcement
// ============================================================

describe("Auth enforcement on mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRoleReject = true;
  });

  it("POST / rejects without coordinator role", async () => {
    // Simulate full middleware chain: requireRole is already mocked to reject
    const req = mockReq({
      body: {
        template_type: "record_set",
        name: "Test",
        content: { records: [] },
      },
    });
    const res = mockRes();

    // Get the requireRole middleware from the route stack
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = templateRouter as any;
    const stack = router.stack as Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (...args: unknown[]) => unknown }>;
      };
    }>;

    const route = stack.find(
      (l) => l.route?.path === "/" && l.route?.methods.post
    );
    const roleMiddleware = route?.route?.stack[0]?.handle;

    if (roleMiddleware) {
      await roleMiddleware(req, res, () => {});
    }

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("Insufficient permissions");
  });
});
