/**
 * Tests for Ontology CI/QA Pipeline
 *
 * Covers:
 * - State machine transitions (valid, invalid, rollback window)
 * - Validation engine (structural, reference, risk assessment)
 * - Impact analysis (property deletion, concept deletion, additive)
 * - Review gates (auto-approve, director, admin)
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
  withTransaction: vi.fn(),
}));

const mockUpdateOntologyRecord = vi.fn();
const mockRollbackOntologyRecord = vi.fn();

vi.mock("../versioning/service", () => ({
  updateOntologyRecord: (...args: unknown[]) => mockUpdateOntologyRecord(...args),
  rollbackOntologyRecord: (...args: unknown[]) => mockRollbackOntologyRecord(...args),
}));

// --- Import module under test ---

import {
  advanceChangeRequest,
  validateChange,
  analyzeImpact,
  determineReviewRequirement,
} from "./ci-qa";

import type { ChangeRequest } from "./ci-qa";

// --- Fixtures ---

function makeChangeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: "cr-001",
    status: "draft",
    tableName: "ontology_properties",
    recordKey: "skills",
    changes: { _add: true, key: "skills", label: "Skills", type: "multi_select", conceptKey: "talent" },
    ownerScope: "department",
    ownerDepartment: "anime",
    createdBy: "user-1",
    riskLevel: "low",
    validationErrors: [],
    ...overrides,
  };
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no config references found
  mockQuery.mockResolvedValue({ rows: [] });
});

// ============================================================
// State Machine
// ============================================================

describe("advanceChangeRequest — state machine", () => {
  it("valid transition: draft -> validating succeeds", async () => {
    const request = makeChangeRequest({ status: "draft" });

    const result = await advanceChangeRequest(request, "validating", "user-1", 30);

    expect(result.status).toBe("validating");
    expect(result.validationErrors).toHaveLength(0);
  });

  it("invalid transition: draft -> applied fails", async () => {
    const request = makeChangeRequest({ status: "draft" });

    await expect(
      advanceChangeRequest(request, "applied", "user-1", 5)
    ).rejects.toThrow('Invalid transition from "draft" to "applied"');
  });

  it("applied -> rolled_back within 24hr succeeds", async () => {
    const recentAppliedAt = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    const request = makeChangeRequest({
      status: "applied",
      appliedAt: recentAppliedAt,
    });

    const result = await advanceChangeRequest(request, "rolled_back", "admin-1", 5);

    expect(result.status).toBe("rolled_back");
  });

  it("applied -> rolled_back after 24hr fails", async () => {
    const oldAppliedAt = new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(); // 25 hours ago
    const request = makeChangeRequest({
      status: "applied",
      appliedAt: oldAppliedAt,
    });

    await expect(
      advanceChangeRequest(request, "rolled_back", "admin-1", 5)
    ).rejects.toThrow("Rollback window (24 hours) has expired");
  });

  it("applies change via versioning service on APPLY transition", async () => {
    mockUpdateOntologyRecord.mockResolvedValue({
      success: true,
      data: { id: "rec-1", version: 2 },
    });

    const request = makeChangeRequest({
      status: "staged",
      changes: { name: "Updated Skills" },
    });

    const result = await advanceChangeRequest(request, "applied", "admin-1", 5);

    expect(result.status).toBe("applied");
    expect(result.appliedAt).toBeDefined();
    expect(mockUpdateOntologyRecord).toHaveBeenCalledWith(
      "ontology_properties",
      "skills",
      { name: "Updated Skills" },
      "admin-1",
      "CI/QA change request cr-001"
    );
  });
});

// ============================================================
// Validation Engine
// ============================================================

describe("validateChange — validation engine", () => {
  it("additive change (new property) -> valid, risk = low", async () => {
    const changes = {
      _add: true,
      key: "budget",
      label: "Budget",
      type: "number",
      conceptKey: "project",
    };

    const result = await validateChange("ontology_properties", "budget", changes);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.riskLevel).toBe("low");
  });

  it("modification (rename property) -> valid, risk = medium", async () => {
    const changes = { label: "Renamed Field" };

    const result = await validateChange("ontology_properties", "skills", changes);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.riskLevel).toBe("medium");
  });

  it("deletion of referenced property -> errors list affected configs", async () => {
    // Simulate config references
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: "fc-1", name: "Talent Form" }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "vc-1", name: "Talent Table View" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const changes = { _delete: true };

    const result = await validateChange("ontology_properties", "skills", changes);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some((e) => e.includes("form_configs"))).toBe(true);
    expect(result.errors.some((e) => e.includes("view_configs"))).toBe(true);
    expect(result.riskLevel).toBe("high");
  });

  it("missing required field -> validation error", async () => {
    const changes = {
      _add: true,
      // Missing "key" field
      label: "Budget",
      type: "number",
      conceptKey: "project",
    };

    const result = await validateChange("ontology_properties", "budget", changes);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("key"))).toBe(true);
  });

  it("invalid property type -> validation error", async () => {
    const changes = {
      _add: true,
      key: "budget",
      label: "Budget",
      type: "currency", // not a valid type
      conceptKey: "project",
    };

    const result = await validateChange("ontology_properties", "budget", changes);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Invalid property type"))).toBe(true);
  });
});

// ============================================================
// Impact Analysis
// ============================================================

describe("analyzeImpact — impact analysis", () => {
  it("property deletion: returns count of affected records and configs", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 42 }] })      // domain_records count
      .mockResolvedValueOnce({                                // form_configs
        rows: [{ id: "fc-1", name: "Edit Form" }],
      })
      .mockResolvedValueOnce({                                // view_configs
        rows: [{ id: "vc-1", name: "Table View" }],
      })
      .mockResolvedValueOnce({ rows: [] });                   // workflow_configs

    const report = await analyzeImpact("ontology_properties", "skills", "deletion");

    expect(report.affectedRecordCount).toBe(42);
    expect(report.affectedConfigs).toHaveLength(2);
    expect(report.affectedConfigs[0]).toEqual({
      type: "form_configs",
      name: "Edit Form",
      id: "fc-1",
    });
    expect(report.riskLevel).toBe("high");
  });

  it("concept deletion: returns count and lists all referencing configs", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 150 }] })      // domain_records count
      .mockResolvedValueOnce({                                // form_configs
        rows: [{ id: "fc-2", name: "Guest Create" }],
      })
      .mockResolvedValueOnce({                                // view_configs
        rows: [
          { id: "vc-2", name: "Guest Table" },
          { id: "vc-3", name: "Guest Kanban" },
        ],
      })
      .mockResolvedValueOnce({                                // workflow_configs
        rows: [{ id: "wf-1", name: "On Guest Create" }],
      });

    const report = await analyzeImpact("ontology_concepts", "guest", "deletion");

    expect(report.affectedRecordCount).toBe(150);
    expect(report.affectedConfigs).toHaveLength(4);
    expect(report.affectedConfigs.some((c) => c.type === "workflow_configs")).toBe(true);
    expect(report.riskLevel).toBe("high");
  });

  it("new property: returns zero impact", async () => {
    const report = await analyzeImpact("ontology_properties", "new_field", "additive");

    expect(report.affectedRecordCount).toBe(0);
    expect(report.affectedConfigs).toHaveLength(0);
    expect(report.riskLevel).toBe("low");
    // Should not have queried the database at all
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ============================================================
// Review Gates
// ============================================================

describe("determineReviewRequirement — review gates", () => {
  it("low risk dept additive -> auto-approve", () => {
    const result = determineReviewRequirement("low", "department", "additive");

    expect(result.requiresReview).toBe(false);
  });

  it("high risk org-wide -> requires admin review (priority <= 10)", () => {
    const result = determineReviewRequirement("high", "org", "deletion");

    expect(result.requiresReview).toBe(true);
    expect(result.requiredPriority).toBe(10);
  });

  it("medium risk -> requires director review", () => {
    const result = determineReviewRequirement("medium", "department", "modification");

    expect(result.requiresReview).toBe(true);
    expect(result.requiredPriority).toBe(20);
  });

  it("low risk org-wide -> requires admin review (org scope overrides low risk)", () => {
    const result = determineReviewRequirement("low", "org", "additive");

    expect(result.requiresReview).toBe(true);
    expect(result.requiredPriority).toBe(10);
  });
});
