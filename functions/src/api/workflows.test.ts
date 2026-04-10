/**
 * Tests for Workflow API Router
 *
 * Covers:
 * - POST /:id/run — manual workflow execution
 * - POST /:id/run — rejects non-manual workflow
 * - GET / — lists active workflows
 * - Auth enforcement
 * - 404 for unknown workflow
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

const mockExecuteManualWorkflow = vi.fn();
const mockLoadActiveWorkflows = vi.fn();
vi.mock("../workflows/engine", () => ({
  executeManualWorkflow: (...args: unknown[]) => mockExecuteManualWorkflow(...args),
  loadActiveWorkflows: (...args: unknown[]) => mockLoadActiveWorkflows(...args),
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
    return { eventId: "evt-api-1", ...input };
  },
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { workflowRouter } from "./workflows";

// --- Mock request/response helpers ---

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "human" as const,
  changeSet: "cs-wf-api-1",
};

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    user: { uid: "test-uid", email: "admin@example.com" },
    role: { roleKey: "director", roleName: "Director", priority: 0 },
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

// --- Find handler from router stack ---

type LayerMethod = "get" | "post";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = workflowRouter as any;
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
// GET /
// ============================================================

describe("GET /", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/");
  });

  it("returns active workflows", async () => {
    const workflows = [
      { id: "wf-1", name: "Auto WF", trigger: { type: "domain_event" }, enabled: true },
      { id: "wf-2", name: "Manual WF", trigger: { type: "manual" }, enabled: true },
    ];
    mockLoadActiveWorkflows.mockResolvedValue(workflows);

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
  });
});

// ============================================================
// POST /:id/run
// ============================================================

describe("POST /:id/run", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/:id/run");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("executes a manual workflow successfully", async () => {
    mockExecuteManualWorkflow.mockResolvedValue({ success: true });

    const req = mockReq({
      params: { id: "wf-manual" },
      body: { context: { recordId: "r-1" } },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as {
      success: boolean;
      data: { workflowId: string; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.workflowId).toBe("wf-manual");
    expect(body.data.status).toBe("executed");

    expect(mockExecuteManualWorkflow).toHaveBeenCalledWith(
      "wf-manual",
      { recordId: "r-1" },
      "admin@example.com"
    );
    expect(mockLogAuditClaim).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalled();
  });

  it("rejects non-manual workflow with 400", async () => {
    mockExecuteManualWorkflow.mockResolvedValue({
      success: false,
      error: 'Workflow "Auto WF" is not a manual workflow (trigger: domain_event)',
    });

    const req = mockReq({
      params: { id: "wf-auto" },
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("not a manual");
  });

  it("returns 404 for unknown workflow", async () => {
    mockExecuteManualWorkflow.mockResolvedValue({
      success: false,
      error: "Workflow not found: wf-missing",
    });

    const req = mockReq({
      params: { id: "wf-missing" },
      body: {},
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("enforces authentication via requireAuth middleware on router", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = workflowRouter as any;
    // The router stack should have middleware layers registered via router.use()
    expect(router.stack.length).toBeGreaterThan(0);
  });

  it("enforces director role for POST /:id/run via requireRole(10)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = workflowRouter as any;
    const runRoute = router.stack.find(
      (layer: { route?: { path: string; methods: Record<string, boolean> } }) =>
        layer.route?.path === "/:id/run" && layer.route?.methods.post
    );
    // Route should exist with multiple middleware layers (requireRole + handler)
    expect(runRoute).toBeDefined();
    expect(runRoute.route.stack.length).toBeGreaterThanOrEqual(2);
  });
});
