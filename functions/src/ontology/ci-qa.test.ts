/**
 * Tests for Ontology CI/QA Pipeline Service
 *
 * Covers:
 * - State machine transitions (valid + invalid)
 * - Rollback window enforcement (24hr)
 * - Validation: structural, enum, reference checks
 * - Risk level assessment
 * - Impact analysis
 * - Review gate determination
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

const mockUpdateOntologyRecord = vi.fn();
const mockRollbackOntologyRecord = vi.fn();

vi.mock("../versioning/service", () => ({
  updateOntologyRecord: (...args: unknown[]) => mockUpdateOntologyRecord(...args),
  rollbackOntologyRecord: (...args: unknown[]) => mockRollbackOntologyRecord(...args),
}));

const mockWithAuditContext = vi.fn();
const mockCreateAuditContext = vi.fn();
const mockLogAuditClaim = vi.fn();

vi.mock("../audit/context", () => ({
  withAuditContext: (...args: unknown[]) => mockWithAuditContext(...args),
  createAuditContext: (...args: unknown[]) => mockCreateAuditContext(...args),
  logAuditClaim: (...args: unknown[]) => mockLogAuditClaim(...args),
}));

const mockEmit = vi.fn();
const mockCreateDomainEvent = vi.fn();

vi.mock("../events/bus", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
  createDomainEvent: (...args: unknown[]) => mockCreateDomainEvent(...args),
}));

// --- Import module under test ---

import {
  createChangeRequest,
  advanceChangeRequest,
  validateChange,
  analyzeImpact,
  determineReviewRequirement,
} from "./ci-qa";

// --- Fixtures ---

function makeChangeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cr-1",
    status: "draft",
    table_name: "ontology_properties",
    record_key: "specialHandling",
    changes: { key: "specialHandling", label: "Special Handling", type: "text" },
    owner_scope: "department",
    owner_department: "vip",
    risk_level: null,
    validation_errors: [],
    impact_report: null,
    created_by: "user-1",
    reviewed_by: null,
    applied_at: null,
    change_set: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();

  mockCreateAuditContext.mockReturnValue({
    actorId: "user-1",
    actorType: "human",
    changeSet: "cs-123",
  });

  mockCreateDomainEvent.mockImplementation((params: Record<string, unknown>) => ({
    ...params,
    eventId: "evt-1",
    timestamp: "2026-04-01T00:00:00Z",
  }));

  mockEmit.mockResolvedValue({
    eventId: "evt-1",
    eventName: "config.applied",
    recordId: "cr-1",
    triggeredBy: "user-1",
    timestamp: "2026-04-01T00:00:00Z",
    workflowsTriggered: [],
    actionsExecuted: [],
  });

  mockLogAuditClaim.mockResolvedValue(undefined);
});

// ============================================================
// State Machine Transitions
// ============================================================

describe("advanceChangeRequest", () => {
  it("allows valid transition: draft -> validating", async () => {
    const draftRow = makeChangeRow({ status: "draft" });
    const reviewRow = makeChangeRow({ status: "review", risk_level: "low", validation_errors: [] });

    // 1. SELECT current request
    // 2. UPDATE to review (validation passes for additive, no DB queries in validate/analyzeImpact)
    mockQuery
      .mockResolvedValueOnce({ rows: [draftRow] })
      .mockResolvedValueOnce({ rows: [reviewRow] });

    const result = await advanceChangeRequest("cr-1", "validating", "user-1", 10);
    expect(result.status).toBe("review");
  });

  it("rejects invalid transition: draft -> applied", async () => {
    const draftRow = makeChangeRow({ status: "draft" });
    mockQuery.mockResolvedValueOnce({ rows: [draftRow] });

    await expect(
      advanceChangeRequest("cr-1", "applied", "user-1", 10)
    ).rejects.toThrow("Invalid transition: draft -> applied");
  });

  it("allows applied -> rolled_back within 24hr", async () => {
    const recentApply = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    const appliedRow = makeChangeRow({
      status: "applied",
      applied_at: recentApply,
    });
    const rolledBackRow = makeChangeRow({ status: "rolled_back" });

    // 1. SELECT current request
    // 2. UPDATE to rolled_back
    mockQuery
      .mockResolvedValueOnce({ rows: [appliedRow] })
      .mockResolvedValueOnce({ rows: [rolledBackRow] });

    const result = await advanceChangeRequest("cr-1", "rolled_back", "user-1", 10);
    expect(result.status).toBe("rolled_back");
  });

  it("rejects applied -> rolled_back after 24hr", async () => {
    const oldApply = new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(); // 25 hours ago
    const appliedRow = makeChangeRow({
      status: "applied",
      applied_at: oldApply,
    });

    mockQuery.mockResolvedValueOnce({ rows: [appliedRow] });

    await expect(
      advanceChangeRequest("cr-1", "rolled_back", "user-1", 10)
    ).rejects.toThrow("Rollback window expired");
  });
});

// ============================================================
// Validation Checks
// ============================================================

describe("validateChange", () => {
  it("returns valid=true and risk=low for additive change", async () => {
    const result = await validateChange(
      "ontology_properties",
      "newProp",
      { key: "newProp", label: "New Property", type: "text" }
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.riskLevel).toBe("low");
  });

  it("returns risk=medium for modification changes", async () => {
    const result = await validateChange(
      "ontology_properties",
      "existingProp",
      { key: "existingProp", label: "Updated", type: "text", sort_order: 5 }
    );

    expect(result.riskLevel).toBe("medium");
  });

  it("returns risk=high for deletion changes", async () => {
    // Deletion triggers reference checks: 3 config tables queried
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // form_configs
      .mockResolvedValueOnce({ rows: [] })   // view_configs
      .mockResolvedValueOnce({ rows: [] });  // workflow_configs

    const result = await validateChange(
      "ontology_properties",
      "oldProp",
      { status: "deprecated", key: "oldProp", label: "Old", type: "text" }
    );

    expect(result.riskLevel).toBe("high");
  });

  it("reports errors when deletion references configs", async () => {
    // Deletion of a referenced property: 3 config table checks
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: "fc-1", name: "Guest Wizard" }] })  // form_configs
      .mockResolvedValueOnce({ rows: [{ id: "vc-1", name: "Guest Table" }] })   // view_configs
      .mockResolvedValueOnce({ rows: [] });                                       // workflow_configs

    const result = await validateChange(
      "ontology_properties",
      "specialHandling",
      { status: "deprecated", key: "specialHandling", label: "Special", type: "text" }
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("Guest Wizard"))).toBe(true);
    expect(result.errors.some((e) => e.includes("Guest Table"))).toBe(true);
  });

  it("returns error for missing required field", async () => {
    const result = await validateChange(
      "ontology_properties",
      "badProp",
      { key: "", label: "Has Label", type: "text", concept_key: "guest" }
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Required field "key"'))).toBe(true);
  });

  it("returns error for invalid enum value", async () => {
    const result = await validateChange(
      "ontology_properties",
      "badType",
      { key: "badType", label: "Bad Type", type: "not_a_real_type" }
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not_a_real_type"))).toBe(true);
  });
});

// ============================================================
// Impact Analysis
// ============================================================

describe("analyzeImpact", () => {
  it("returns zero impact for additive change type", async () => {
    const result = await analyzeImpact(
      "ontology_properties",
      "newProp",
      "additive"
    );

    expect(result.affectedRecords).toBe(0);
    expect(result.referencingConfigs).toHaveLength(0);
    expect(result.riskLevel).toBe("low");
  });

  it("returns affected count for deletion", async () => {
    // 1. COUNT query for the table
    // 2-4. Referencing config checks (form, view, workflow)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: "47" }] })
      .mockResolvedValueOnce({ rows: [{ name: "Guest Wizard" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await analyzeImpact(
      "ontology_properties",
      "specialHandling",
      "deletion"
    );

    expect(result.affectedRecords).toBe(47);
    expect(result.referencingConfigs.length).toBeGreaterThan(0);
    expect(result.riskLevel).toBe("high");
  });
});

// ============================================================
// Review Gate Determination
// ============================================================

describe("determineReviewRequirement", () => {
  it("auto-approves low risk dept additive changes", () => {
    const result = determineReviewRequirement("low", "department", "additive");

    expect(result.requiresReview).toBe(false);
    expect(result.reason).toContain("auto-approved");
  });

  it("requires admin for high risk changes", () => {
    const result = determineReviewRequirement("high", "department", "deletion");

    expect(result.requiresReview).toBe(true);
    expect(result.minimumPriority).toBe(10);
    expect(result.reason).toContain("admin");
  });

  it("requires admin for org-wide changes", () => {
    const result = determineReviewRequirement("low", "org", "additive");

    expect(result.requiresReview).toBe(true);
    expect(result.minimumPriority).toBe(10);
    expect(result.reason).toContain("Org-wide");
  });

  it("requires director for medium risk changes", () => {
    const result = determineReviewRequirement("medium", "department", "modification");

    expect(result.requiresReview).toBe(true);
    expect(result.minimumPriority).toBe(20);
    expect(result.reason).toContain("director");
  });
});

// ============================================================
// createChangeRequest
// ============================================================

describe("createChangeRequest", () => {
  it("inserts a draft change request", async () => {
    const insertedRow = makeChangeRow();
    mockQuery.mockResolvedValueOnce({ rows: [insertedRow] });

    const result = await createChangeRequest(
      "ontology_properties",
      "specialHandling",
      { key: "specialHandling", label: "Special Handling", type: "text" },
      "department",
      "vip",
      "user-1"
    );

    expect(result.status).toBe("draft");
    expect(result.table_name).toBe("ontology_properties");
    expect(result.record_key).toBe("specialHandling");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO config_change_requests"),
      expect.any(Array)
    );
  });
});
