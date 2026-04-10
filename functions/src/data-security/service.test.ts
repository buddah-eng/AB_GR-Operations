/**
 * Tests for Data Security Service
 *
 * Covers:
 * - Data access logging
 * - Anomalous access detection
 * - Field classification from ontology
 * - Retention policy lookup
 * - Record anonymization replaces PII
 * - Access log querying
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

vi.mock("../encryption/crypto", () => ({
  isPiiField: (field: string) => {
    const piiFields = new Set([
      "email", "phone", "emergency_contact", "passport_number",
      "visa_details", "hotel_room", "home_address", "dietary_restrictions",
      "flight_details", "driver_phone", "compensation",
    ]);
    return piiFields.has(field);
  },
}));

// --- Import module under test ---

import {
  logDataAccess,
  detectAnomalousAccess,
  getFieldClassification,
  getRetentionPolicy,
  anonymizeRecord,
  getAccessLog,
} from "./service";

// --- Tests ---

describe("logDataAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts access log entry with all fields", async () => {
    const entry = {
      id: "log-1",
      actor_id: "user@test.com",
      actor_type: "human",
      concept_key: "guest",
      record_id: "rec-1",
      fields_accessed: ["name", "email"],
      classification: "pii",
      created_at: "2026-04-08T00:00:00Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [entry] });

    const result = await logDataAccess(
      "user@test.com",
      "human",
      "guest",
      "rec-1",
      ["name", "email"],
      "pii"
    );

    expect(result.id).toBe("log-1");
    expect(result.classification).toBe("pii");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO data_access_log"),
      ["user@test.com", "human", "guest", "rec-1", ["name", "email"], "pii"]
    );
  });
});

describe("detectAnomalousAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns actors exceeding 2 stddev above mean", async () => {
    const anomalies = [
      {
        actor_id: "bot-scraper",
        actor_type: "api_client",
        access_count: 500,
        avg_count: 20,
        stddev: 15,
      },
    ];
    mockQuery.mockResolvedValueOnce({ rows: anomalies });

    const result = await detectAnomalousAccess(24);

    expect(result).toHaveLength(1);
    expect(result[0].actor_id).toBe("bot-scraper");
    expect(result[0].access_count).toBe(500);
  });

  it("returns empty array when no anomalies found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await detectAnomalousAccess(48);
    expect(result).toHaveLength(0);
  });

  it("returns empty array on query error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB error"));

    const result = await detectAnomalousAccess(24);
    expect(result).toHaveLength(0);
  });
});

describe("getFieldClassification", () => {
  it("classifies PII fields correctly", () => {
    expect(getFieldClassification("guest", "email")).toBe("pii");
    expect(getFieldClassification("guest", "phone")).toBe("pii");
    expect(getFieldClassification("driver", "driver_phone")).toBe("pii");
    expect(getFieldClassification("guest", "passport_number")).toBe("pii");
  });

  it("classifies sensitive fields correctly", () => {
    expect(getFieldClassification("staff", "salary")).toBe("sensitive");
    expect(getFieldClassification("staff", "compensation")).toBe("pii"); // compensation is in PII set
    expect(getFieldClassification("staff", "performance_rating")).toBe("sensitive");
  });

  it("classifies internal fields correctly", () => {
    expect(getFieldClassification("guest", "created_at")).toBe("internal");
    expect(getFieldClassification("guest", "record_id")).toBe("internal");
  });

  it("classifies public fields correctly", () => {
    expect(getFieldClassification("guest", "name")).toBe("public");
    expect(getFieldClassification("guest", "nationality")).toBe("public");
  });
});

describe("getRetentionPolicy", () => {
  it("returns guest retention policy", () => {
    const policy = getRetentionPolicy("guest");
    expect(policy.concept_key).toBe("guest");
    expect(policy.retention_days).toBe(365);
  });

  it("returns staff retention policy", () => {
    const policy = getRetentionPolicy("staff");
    expect(policy.retention_days).toBe(730);
  });

  it("returns default policy for unknown concept", () => {
    const policy = getRetentionPolicy("unknown_concept");
    expect(policy.retention_days).toBe(730);
    expect(policy.policy).toContain("Default");
  });
});

describe("anonymizeRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces PII fields with [REDACTED]", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { key: "name" },
          { key: "email" },
          { key: "phone" },
          { key: "nationality" },
        ],
      }) // ontology_properties query
      .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE query

    const result = await anonymizeRecord("guest", "rec-1");

    expect(result.fields_anonymized).toContain("email");
    expect(result.fields_anonymized).toContain("phone");
    expect(result.fields_anonymized).not.toContain("name");
    expect(result.fields_anonymized).not.toContain("nationality");
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("returns empty list when no PII fields exist", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ key: "name" }, { key: "status" }],
    });

    const result = await anonymizeRecord("config", "rec-1");

    expect(result.fields_anonymized).toHaveLength(0);
    expect(mockQuery).toHaveBeenCalledTimes(1); // Only ontology query
  });

  it("throws on database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(anonymizeRecord("guest", "rec-1")).rejects.toThrow(
      "Anonymization failed"
    );
  });
});

describe("getAccessLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries by actor when provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "log-1" }] });

    const result = await getAccessLog("user@test.com", 24);

    expect(result).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toContain("actor_id = $1");
    expect(mockQuery.mock.calls[0][1]).toEqual(["user@test.com", 24]);
  });

  it("queries all actors when no actor specified", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getAccessLog(undefined, 48);

    expect(mockQuery.mock.calls[0][0]).not.toContain("actor_id");
    expect(mockQuery.mock.calls[0][1]).toEqual([48]);
  });
});
