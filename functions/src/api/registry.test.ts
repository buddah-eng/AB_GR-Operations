/**
 * Tests for Registry API Router
 *
 * Covers:
 * - Guest lookup (email, name)
 * - Returning guests
 * - Create registry entry
 * - Pre-populate convention year
 * - Archive convention year
 * - Analytics endpoints (return-rate, frequent, snapshot)
 * - Duplicate detection
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

const mockFindGuestByEmail = vi.fn();
const mockFindGuestByName = vi.fn();
const mockGetReturningGuests = vi.fn();
const mockCreateRegistryEntry = vi.fn();
const mockLinkGuestToRegistry = vi.fn();
const mockPrePopulateConventionYear = vi.fn();
const mockArchiveConventionYear = vi.fn();
const mockGetReturnRateByDepartment = vi.fn();
const mockGetFrequentGuests = vi.fn();
const mockGetYoyGrowth = vi.fn();
const mockGetNewVsReturningVendors = vi.fn();
const mockGetCohortAnalysis = vi.fn();
const mockDetectDuplicates = vi.fn();
const mockCreateAnalyticsSnapshot = vi.fn();
vi.mock("../registry/service", () => ({
  findGuestByEmail: (...args: unknown[]) => mockFindGuestByEmail(...args),
  findGuestByName: (...args: unknown[]) => mockFindGuestByName(...args),
  getReturningGuests: (...args: unknown[]) => mockGetReturningGuests(...args),
  createRegistryEntry: (...args: unknown[]) => mockCreateRegistryEntry(...args),
  linkGuestToRegistry: (...args: unknown[]) => mockLinkGuestToRegistry(...args),
  prePopulateConventionYear: (...args: unknown[]) => mockPrePopulateConventionYear(...args),
  archiveConventionYear: (...args: unknown[]) => mockArchiveConventionYear(...args),
  getReturnRateByDepartment: (...args: unknown[]) => mockGetReturnRateByDepartment(...args),
  getFrequentGuests: (...args: unknown[]) => mockGetFrequentGuests(...args),
  getYoyGrowth: (...args: unknown[]) => mockGetYoyGrowth(...args),
  getNewVsReturningVendors: (...args: unknown[]) => mockGetNewVsReturningVendors(...args),
  getCohortAnalysis: (...args: unknown[]) => mockGetCohortAnalysis(...args),
  detectDuplicates: (...args: unknown[]) => mockDetectDuplicates(...args),
  createAnalyticsSnapshot: (...args: unknown[]) => mockCreateAnalyticsSnapshot(...args),
}));

const mockAuditContextFromRequest = vi.fn();
const mockLogAuditClaim = vi.fn();
vi.mock("../audit/context", () => ({
  auditContextFromRequest: (...args: unknown[]) => mockAuditContextFromRequest(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
  withAuditContext: async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: vi.fn() };
    return fn(mockClient);
  },
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();
vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => {
    mockCreateDomainEvent(...args);
    const input = args[0] as Record<string, unknown>;
    return { eventId: "evt-r-1", eventName: input.eventName, ...input };
  },
}));

vi.mock("../auth/middleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireRole: (_priority: number) => (_req: Request, _res: Response, next: () => void) => next(),
}));

// --- Import module under test ---

import { registryRouter } from "./registry";

// --- Fixtures ---

const AUDIT_CTX = {
  actorId: "test-uid",
  actorType: "human" as const,
  changeSet: "cs-r-123",
};

// --- Mock request/response helpers ---

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

// --- Find a route handler from the Express Router stack ---

type LayerMethod = "get" | "post" | "put";

function findHandler(method: LayerMethod, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = registryRouter as any;
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
// GET /guests
// ============================================================

describe("GET /guests", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/guests");
  });

  it("calls findGuestByEmail when email param provided", async () => {
    const guest = { id: "g1", email: "alice@example.com", canonical_name: "Alice" };
    mockFindGuestByEmail.mockResolvedValue(guest);

    const req = mockReq({
      query: { email: "alice@example.com" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([guest]);
    expect(mockFindGuestByEmail).toHaveBeenCalledWith("alice@example.com");
  });

  it("calls findGuestByName when name param provided", async () => {
    const guests = [
      { id: "g1", canonical_name: "Alice Smith" },
      { id: "g2", canonical_name: "Alice Jones" },
    ];
    mockFindGuestByName.mockResolvedValue(guests);

    const req = mockReq({
      query: { name: "Alice" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(guests);
    expect(mockFindGuestByName).toHaveBeenCalledWith("Alice");
  });

  it("returns empty array when email lookup finds no guest", async () => {
    mockFindGuestByEmail.mockResolvedValue(null);

    const req = mockReq({
      query: { email: "nobody@example.com" },
    });
    const res = mockRes();

    await handler(req, res);

    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("returns 400 when neither email nor name provided", async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("email");
  });
});

// ============================================================
// GET /guests/returning
// ============================================================

describe("GET /guests/returning", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/guests/returning");
  });

  it("passes lookbackYear to getReturningGuests", async () => {
    const guests = [{ id: "g1", canonical_name: "Alice", attendance_count: 3 }];
    mockGetReturningGuests.mockResolvedValue(guests);

    const req = mockReq({
      query: { lookbackYear: "2025" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(guests);
    expect(mockGetReturningGuests).toHaveBeenCalledWith(2025);
  });

  it("returns 400 when lookbackYear is missing", async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("lookbackYear");
  });
});

// ============================================================
// POST /guests
// ============================================================

describe("POST /guests", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/guests");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates registry entry with audit context and fires event", async () => {
    const entry = { id: "reg-1", canonical_name: "Bob", first_attended: 2024 };
    mockCreateRegistryEntry.mockResolvedValue(entry);

    const req = mockReq({
      body: { canonical_name: "Bob", first_attended: 2024, email: "bob@example.com" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe("reg-1");

    expect(mockCreateRegistryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical_name: "Bob",
        first_attended: 2024,
        email: "bob@example.com",
      }),
      expect.anything()
    );

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "registry.guest_created",
        domain: "registry",
        action: "created",
        recordId: "reg-1",
        changeSet: "cs-r-123",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when canonical_name is missing", async () => {
    const req = mockReq({
      body: { first_attended: 2024 },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("canonical_name");
  });
});

// ============================================================
// POST /pre-populate
// ============================================================

describe("POST /pre-populate", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/pre-populate");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("calls prePopulateConventionYear with audit context", async () => {
    mockPrePopulateConventionYear.mockResolvedValue(15);

    const req = mockReq({
      body: { year: 2026, lookbackYear: 2025 },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { draftRecordsCreated: number } };
    expect(body.success).toBe(true);
    expect(body.data.draftRecordsCreated).toBe(15);

    expect(mockPrePopulateConventionYear).toHaveBeenCalledWith(
      2026,
      2025,
      expect.anything()
    );

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "registry.pre_populated",
        metadata: expect.objectContaining({
          year: 2026,
          lookbackYear: 2025,
          draftRecordsCreated: 15,
        }),
      })
    );
  });

  it("returns 400 when year or lookbackYear missing", async () => {
    const req = mockReq({
      body: { year: 2026 },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("year");
  });
});

// ============================================================
// POST /archive
// ============================================================

describe("POST /archive", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/archive");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("calls archiveConventionYear with audit context", async () => {
    const summary = { archivedCount: 42, year: 2024 };
    mockArchiveConventionYear.mockResolvedValue(summary);

    const req = mockReq({
      body: { year: 2024 },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { archivedCount: number } };
    expect(body.success).toBe(true);
    expect(body.data.archivedCount).toBe(42);

    expect(mockArchiveConventionYear).toHaveBeenCalledWith(2024, expect.anything());
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// GET /analytics/return-rate
// ============================================================

describe("GET /analytics/return-rate", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/analytics/return-rate");
  });

  it("returns return rate data", async () => {
    const data = [{ department: "vendors", returnRate: 0.75 }];
    mockGetReturnRateByDepartment.mockResolvedValue(data);

    const req = mockReq();
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(data);
    expect(mockGetReturnRateByDepartment).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// GET /analytics/frequent
// ============================================================

describe("GET /analytics/frequent", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/analytics/frequent");
  });

  it("passes minVisits param to getFrequentGuests", async () => {
    const data = [{ id: "g1", canonical_name: "Alice", attendance_count: 5 }];
    mockGetFrequentGuests.mockResolvedValue(data);

    const req = mockReq({
      query: { minVisits: "3" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(mockGetFrequentGuests).toHaveBeenCalledWith(3);
  });

  it("defaults minVisits to 2 when not provided", async () => {
    mockGetFrequentGuests.mockResolvedValue([]);

    const req = mockReq({ query: {} });
    const res = mockRes();

    await handler(req, res);

    expect(mockGetFrequentGuests).toHaveBeenCalledWith(2);
  });
});

// ============================================================
// POST /analytics/snapshot
// ============================================================

describe("POST /analytics/snapshot", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("post", "/analytics/snapshot");
    mockAuditContextFromRequest.mockReturnValue(AUDIT_CTX);
    mockLogAuditClaim.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
  });

  it("creates snapshot with audit context", async () => {
    const result = { snapshotTable: "snapshot_2026", rowCount: 100 };
    mockCreateAnalyticsSnapshot.mockResolvedValue(result);

    const req = mockReq({
      body: { conventionYear: 2026 },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: { snapshotTable: string } };
    expect(body.success).toBe(true);
    expect(body.data.snapshotTable).toBe("snapshot_2026");

    expect(mockCreateAnalyticsSnapshot).toHaveBeenCalledWith(2026, expect.anything());
    expect(mockLogAuditClaim).toHaveBeenCalledTimes(1);

    expect(mockCreateDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "registry.snapshot_created",
        domain: "registry",
        action: "created",
      })
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when conventionYear is missing", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("conventionYear");
  });
});

// ============================================================
// GET /duplicates
// ============================================================

describe("GET /duplicates", () => {
  let handler: Function;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = findHandler("get", "/duplicates");
  });

  it("calls detectDuplicates with name and optional email", async () => {
    const duplicates = [
      { id: "g1", canonical_name: "Alice Smith", score: 0.95 },
    ];
    mockDetectDuplicates.mockResolvedValue(duplicates);

    const req = mockReq({
      query: { name: "Alice Smith", email: "alice@example.com" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(duplicates);
    expect(mockDetectDuplicates).toHaveBeenCalledWith("Alice Smith", "alice@example.com");
  });

  it("returns 400 when name is missing", async () => {
    const req = mockReq({
      query: { email: "alice@example.com" },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res._json as { success: boolean; error: string };
    expect(body.error).toContain("name");
  });
});
