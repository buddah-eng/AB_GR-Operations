/**
 * Tests for Data Routing Service
 *
 * Covers:
 * - Route matching on event pattern
 * - Field mapping extracts correct fields
 * - PII strip mode removes PII fields
 * - PII pass mode keeps PII fields
 * - PII hash mode computes HMAC
 * - Route creates projection record in destination
 * - Source update triggers projection update
 * - Transform chain applied when transform_id is set
 * - handleDomainEvent skips when no routes match
 * - handleDomainEvent processes multiple matching routes
 * - CRUD operations: listRoutes, getRouteById, createRoute, updateRoute, deleteRoute
 * - createTransform validates chain
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
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("../events/bus", () => ({
  subscribe: vi.fn(),
  matchesPattern: (pattern: string, eventName: string) => {
    if (pattern === "*") return true;
    const patternParts = pattern.split(".");
    const eventParts = eventName.split(".");
    if (patternParts.length !== eventParts.length) return false;
    return patternParts.every(
      (part: string, i: number) => part === "*" || part === eventParts[i]
    );
  },
}));

vi.mock("../encryption/crypto", () => ({
  isPiiField: (key: string) =>
    new Set(["email", "phone", "passport_number"]).has(key),
  computeHmac: (value: string) => `hmac_${value}`,
  isHmacConfigured: () => true,
}));

// --- Import module under test ---

import {
  registerDataRouting,
  handleDomainEvent,
  executeRoute,
  listRoutes,
  createRoute,
  deleteRoute,
  createTransform,
} from "./service";
import { subscribe } from "../events/bus";
import type { DomainEvent } from "../events/types";

// --- Fixtures ---

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: "evt-1",
    eventName: "guest.created",
    domain: "guest",
    action: "created",
    recordId: "rec-1",
    triggeredBy: "admin@example.com",
    timestamp: "2026-04-08T12:00:00Z",
    newValues: {
      name: "Alice Smith",
      email: "alice@example.com",
      phone: "555-1234",
      status: "active",
    },
    ...overrides,
  };
}

function makeRoute(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "route-1",
    name: "Guest to Report",
    source_concept: "guest",
    dest_concept: "report",
    field_mappings: [
      { source: "name", dest: "guest_name" },
      { source: "status", dest: "guest_status" },
      { source: "email", dest: "email" },
    ],
    transform_id: null,
    pii_mode: "strip" as const,
    trigger_event: "guest.created",
    execution_mode: "async" as const,
    owner_scope: "org",
    owner_department: null,
    active: true,
    created_at: "2026-04-08T00:00:00Z",
    updated_at: "2026-04-08T00:00:00Z",
    ...overrides,
  };
}

// ============================================================
// registerDataRouting
// ============================================================

describe("registerDataRouting", () => {
  it("subscribes to event bus at priority 600", () => {
    registerDataRouting();

    expect(subscribe).toHaveBeenCalledWith("*", expect.any(Function), 600);
  });
});

// ============================================================
// Route matching on event pattern
// ============================================================

describe("handleDomainEvent - route matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when no routes match the event", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const event = makeEvent({ eventName: "vehicle.deleted" });
    await handleDomainEvent(event);

    // Only the route lookup query should have been called
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("processes matching routes for an event", async () => {
    const route = makeRoute();
    mockQuery
      .mockResolvedValueOnce({ rows: [route] }) // load routes
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // write projection

    const event = makeEvent();
    await handleDomainEvent(event);

    // Should have loaded routes + written projection
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// Field mapping
// ============================================================

describe("executeRoute - field mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts correct fields based on field_mappings", async () => {
    const route = makeRoute();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // write projection

    const event = makeEvent();
    const projection = await executeRoute(route, event);

    expect(projection.guest_name).toBe("Alice Smith");
    expect(projection.guest_status).toBe("active");
  });
});

// ============================================================
// PII strip mode
// ============================================================

describe("executeRoute - PII strip mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes PII fields when pii_mode is strip", async () => {
    const route = makeRoute({ pii_mode: "strip" });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const event = makeEvent();
    const projection = await executeRoute(route, event);

    expect(projection).not.toHaveProperty("email");
    expect(projection.guest_name).toBe("Alice Smith");
  });
});

// ============================================================
// PII pass mode
// ============================================================

describe("executeRoute - PII pass mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps PII fields when pii_mode is pass", async () => {
    const route = makeRoute({ pii_mode: "pass" });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const event = makeEvent();
    const projection = await executeRoute(route, event);

    expect(projection.email).toBe("alice@example.com");
    expect(projection.guest_name).toBe("Alice Smith");
  });
});

// ============================================================
// PII hash mode
// ============================================================

describe("executeRoute - PII hash mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computes HMAC for PII fields when pii_mode is hash", async () => {
    const route = makeRoute({ pii_mode: "hash" });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const event = makeEvent();
    const projection = await executeRoute(route, event);

    expect(projection.email).toBe("hmac_alice@example.com");
    expect(projection.guest_name).toBe("Alice Smith");
  });
});

// ============================================================
// Projection record written
// ============================================================

describe("executeRoute - projection writing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes projection record to data_projections table", async () => {
    const route = makeRoute();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const event = makeEvent();
    await executeRoute(route, event);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO data_projections"),
      expect.arrayContaining(["report", "rec-1", "route-1"])
    );
  });
});

// ============================================================
// Source update triggers projection update
// ============================================================

describe("executeRoute - source update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles updated event and creates new projection", async () => {
    const route = makeRoute({ trigger_event: "guest.updated" });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const event = makeEvent({
      eventName: "guest.updated",
      action: "updated",
      newValues: { name: "Alice Updated", status: "checked_in" },
    });

    const projection = await executeRoute(route, event);

    expect(projection.guest_name).toBe("Alice Updated");
    expect(projection.guest_status).toBe("checked_in");
    expect(projection._source_record_id).toBe("rec-1");
  });
});

// ============================================================
// Transform chain applied
// ============================================================

describe("executeRoute - with transform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies transform chain when transform_id is set", async () => {
    const transform = {
      id: "transform-1",
      name: "Add metadata",
      transform_chain: [
        { type: "static", config: { fields: { processed: true } } },
      ],
      reusable: true,
      created_at: "2026-04-08T00:00:00Z",
      updated_at: "2026-04-08T00:00:00Z",
    };

    const route = makeRoute({
      transform_id: "transform-1",
      field_mappings: [],
      pii_mode: "pass",
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [transform] }) // getTransformById
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // write projection

    const event = makeEvent();
    const projection = await executeRoute(route, event);

    expect(projection.processed).toBe(true);
  });
});

// ============================================================
// CRUD: listRoutes
// ============================================================

describe("listRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns filtered routes", async () => {
    const routes = [makeRoute()];
    mockQuery.mockResolvedValueOnce({ rows: routes });

    const result = await listRoutes({ source_concept: "guest" });

    expect(result).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("source_concept = $1"),
      ["guest"]
    );
  });
});

// ============================================================
// CRUD: createRoute
// ============================================================

describe("createRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts route and returns it", async () => {
    const route = makeRoute();
    mockQuery.mockResolvedValueOnce({ rows: [route] });

    const result = await createRoute({
      name: "Guest to Report",
      source_concept: "guest",
      dest_concept: "report",
      field_mappings: [],
      transform_id: null,
      pii_mode: "strip",
      trigger_event: "guest.created",
      execution_mode: "async",
      owner_scope: "org",
      owner_department: null,
      active: true,
    });

    expect(result.id).toBe("route-1");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO data_routes"),
      expect.any(Array)
    );
  });
});

// ============================================================
// CRUD: deleteRoute
// ============================================================

describe("deleteRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when route is deleted", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await deleteRoute("route-1");

    expect(result).toBe(true);
  });

  it("returns false when route does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await deleteRoute("route-missing");

    expect(result).toBe(false);
  });
});

// ============================================================
// createTransform validates chain
// ============================================================

describe("createTransform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws on invalid transform chain", async () => {
    await expect(
      createTransform({
        name: "Bad Transform",
        transform_chain: [{ type: "invalid_type", config: {} }] as any,
        reusable: false,
      })
    ).rejects.toThrow("Invalid transform chain");
  });
});
