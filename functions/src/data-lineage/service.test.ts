/**
 * Tests for Data Lineage Service
 *
 * Covers:
 * - Backward trace returns source chain
 * - Forward trace returns downstream dependents
 * - Impact analysis returns affected routes/concepts
 * - Empty trace for unlinked record
 * - Error handling returns empty graph
 * - Change set traversal
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

// --- Import module under test ---

import { traceBackward, traceForward, getImpactAnalysis } from "./service";

// --- Tests ---

describe("traceBackward", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns audit entries as lineage nodes", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "audit-1",
            change_set: null,
            actor_id: "user@test.com",
            actor_type: "human",
            action: "INSERT",
            table_name: "guest",
            record_id: "rec-1",
            created_at: "2026-04-01T00:00:00Z",
          },
        ],
      }) // domain_audit_log query
      .mockResolvedValueOnce({ rows: [] }); // event_log query

    const graph = await traceBackward("guest", "rec-1");

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].concept_key).toBe("guest");
    expect(graph.nodes[0].action).toBe("INSERT");
    expect(graph.edges).toHaveLength(0);
  });

  it("follows change_set to find related source records", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "audit-1",
            change_set: "cs-100",
            actor_id: "user@test.com",
            actor_type: "human",
            action: "INSERT",
            table_name: "guest",
            record_id: "rec-1",
            created_at: "2026-04-01T00:00:00Z",
          },
        ],
      }) // domain_audit_log for record
      .mockResolvedValueOnce({
        rows: [
          {
            id: "audit-2",
            change_set: "cs-100",
            actor_id: "user@test.com",
            actor_type: "human",
            action: "INSERT",
            table_name: "reservation",
            record_id: "rec-2",
            created_at: "2026-04-01T00:00:01Z",
          },
        ],
      }) // domain_audit_log for change_set
      .mockResolvedValueOnce({ rows: [] }); // event_log query

    const graph = await traceBackward("guest", "rec-1");

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].relationship).toBe("same_change_set");
  });

  it("returns empty graph for unlinked record", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const graph = await traceBackward("guest", "rec-nonexistent");

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("returns empty graph on query error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB unavailable"));

    const graph = await traceBackward("guest", "rec-1");

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

describe("traceForward", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns downstream events and data routes", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            event_id: "evt-1",
            event_name: "guest.created",
            record_id: "rec-1",
            triggered_by: "system",
            timestamp: "2026-04-01T00:00:00Z",
            change_set: "cs-200",
            workflows_triggered: ["schedule.*"],
            actions_executed: [],
          },
        ],
      }) // event_log query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "audit-3",
            change_set: "cs-200",
            actor_id: "system",
            action: "INSERT",
            table_name: "schedule",
            record_id: "rec-3",
            created_at: "2026-04-01T00:00:02Z",
          },
        ],
      }) // downstream audit
      .mockResolvedValueOnce({
        rows: [
          {
            id: "route-1",
            name: "Guest to Pickup",
            dest_concept: "pickup",
            trigger_event: "guest.created",
          },
        ],
      }); // data_routes

    const graph = await traceForward("guest", "rec-1");

    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty graph for record with no events", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // event_log
      .mockResolvedValueOnce({ rows: [] }); // data_routes

    const graph = await traceForward("guest", "rec-none");

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("returns empty graph on error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Connection lost"));

    const graph = await traceForward("guest", "rec-1");

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});

describe("getImpactAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns affected routes and concepts for a field", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "route-1",
          name: "Guest to Hotel",
          dest_concept: "hotel_assignment",
          trigger_event: "guest.created",
          field_mappings: [{ source_field: "email", dest_field: "contact_email" }],
        },
        {
          id: "route-2",
          name: "Guest to Transport",
          dest_concept: "transport",
          trigger_event: "guest.updated",
          field_mappings: [{ source_field: "phone", dest_field: "contact_phone" }],
        },
      ],
    });

    const analysis = await getImpactAnalysis("guest", "email");

    expect(analysis.source_concept).toBe("guest");
    expect(analysis.source_field).toBe("email");
    expect(analysis.affected_routes).toHaveLength(1);
    expect(analysis.affected_routes[0].dest_concept).toBe("hotel_assignment");
    expect(analysis.affected_concepts).toEqual(["hotel_assignment"]);
  });

  it("returns empty results when no routes exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const analysis = await getImpactAnalysis("guest", "name");

    expect(analysis.affected_routes).toHaveLength(0);
    expect(analysis.affected_concepts).toHaveLength(0);
  });

  it("returns empty on error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Timeout"));

    const analysis = await getImpactAnalysis("guest", "email");

    expect(analysis.affected_routes).toHaveLength(0);
    expect(analysis.affected_concepts).toHaveLength(0);
  });
});
