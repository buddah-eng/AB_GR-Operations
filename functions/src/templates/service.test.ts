/**
 * Tests for Template Service
 *
 * Covers:
 * - listTemplates with type filter
 * - createTemplate inserts correctly
 * - createTemplate validates content
 * - updateTemplate creates new version
 * - deleteTemplate deprecates
 * - validateTemplateContent rejects invalid content
 * - validateTemplateContent rejects invalid type
 * - applyTemplate record_set creates records
 * - applyTemplate form_preset sets FormConfig
 * - applyTemplate notification returns content
 * - exportTemplates produces valid JSON format
 * - importTemplates creates entries without overwriting
 * - importTemplates rejects bad format
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (must be before import of module under test) ---

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

const mockWithAuditContext = vi.fn();
vi.mock("../audit/context", () => ({
  withAuditContext: (...args: unknown[]) => mockWithAuditContext(...args),
}));

// --- Import module under test ---

import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateHistory,
  applyTemplate,
  validateTemplateContent,
  exportTemplates,
  importTemplates,
  EXPORT_FORMAT_VERSION,
} from "./service";
import type { Template } from "./service";
import type { AuditContext } from "../audit/context";

// --- Fixtures ---

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "tpl-1",
    template_type: "record_set",
    name: "Guest Batch",
    description: "Batch create guests",
    category: "onboarding",
    content: { records: [{ name: "John" }] },
    concept_key: "guest",
    version: 1,
    status: "active",
    owner_scope: "org",
    owner_department: null,
    changed_by: "user-1",
    changed_at: "2026-04-01T00:00:00Z",
    change_reason: "Initial creation",
    previous_version_id: null,
    ...overrides,
  };
}

function makeMockClient() {
  return { query: vi.fn() };
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();

  // Default withTransaction: call the callback with a mock client
  mockWithTransaction.mockImplementation(
    async (fn: (client: ReturnType<typeof makeMockClient>) => Promise<unknown>) => {
      const client = makeMockClient();
      return fn(client);
    }
  );

  // Default withAuditContext: call the callback with a mock client
  mockWithAuditContext.mockImplementation(
    async (_ctx: unknown, fn: (client: ReturnType<typeof makeMockClient>) => Promise<unknown>) => {
      const client = makeMockClient();
      return fn(client);
    }
  );
});

// ============================================================
// listTemplates
// ============================================================

describe("listTemplates", () => {
  it("returns all active templates when no filters", async () => {
    const templates = [makeTemplate(), makeTemplate({ id: "tpl-2", name: "Staff Batch" })];
    mockQuery.mockResolvedValue({ rows: templates });

    const result = await listTemplates();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      []
    );
  });

  it("filters by type when provided", async () => {
    mockQuery.mockResolvedValue({ rows: [makeTemplate()] });

    const result = await listTemplates({ type: "record_set" });

    expect(result.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("template_type = $1"),
      ["record_set"]
    );
  });

  it("applies multiple filters together", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await listTemplates({ type: "form_preset", concept: "guest", category: "onboarding" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("template_type = $1"),
      ["form_preset", "guest", "onboarding"]
    );
  });
});

// ============================================================
// createTemplate
// ============================================================

describe("createTemplate", () => {
  it("inserts template with correct data", async () => {
    const inserted = makeTemplate();

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [inserted] });
      return fn(client);
    });

    const result = await createTemplate({
      template_type: "record_set",
      name: "Guest Batch",
      description: "Batch create guests",
      category: "onboarding",
      content: { records: [{ name: "John" }] },
      concept_key: "guest",
      changed_by: "user-1",
    });

    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("Guest Batch");
    expect(result.data?.template_type).toBe("record_set");
  });

  it("rejects invalid content for template type", async () => {
    const result = await createTemplate({
      template_type: "record_set",
      name: "Bad Template",
      content: { invalid: true }, // missing "records" field
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("records");
  });

  it("uses audit context when provided", async () => {
    const auditCtx = {
      actorId: "user-1",
      actorType: "human" as const,
      changeSet: "cs-1",
    };

    mockWithAuditContext.mockImplementation(async (_ctx: unknown, fn: Function) => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [makeTemplate()] });
      return fn(client);
    });

    const result = await createTemplate(
      {
        template_type: "notification",
        name: "Welcome Email",
        content: { subject: "Welcome", body: "Hello!" },
      },
      auditCtx as AuditContext
    );

    expect(result.success).toBe(true);
    expect(mockWithAuditContext).toHaveBeenCalledTimes(1);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});

// ============================================================
// updateTemplate
// ============================================================

describe("updateTemplate", () => {
  it("creates new version and deprecates old", async () => {
    const oldRow = makeTemplate({ id: "tpl-v1", version: 1 });
    const newRow = makeTemplate({
      id: "tpl-v2",
      version: 2,
      previous_version_id: "tpl-v1",
      change_reason: "Updated name",
    });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query
        .mockResolvedValueOnce({ rows: [oldRow] })       // SELECT active FOR UPDATE
        .mockResolvedValueOnce({ rows: [newRow] })        // INSERT new version
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE old to deprecated
      return fn(client);
    });

    const result = await updateTemplate(
      "tpl-v1",
      { name: "Guest Batch v2" },
      "user-2",
      "Updated name"
    );

    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(2);
    expect(result.data?.previous_version_id).toBe("tpl-v1");
  });

  it("returns error when template not found", async () => {
    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [] });
      return fn(client);
    });

    const result = await updateTemplate(
      "nonexistent",
      { name: "X" },
      "user-1",
      "reason"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("No active template found");
  });
});

// ============================================================
// deleteTemplate
// ============================================================

describe("deleteTemplate", () => {
  it("deprecates template (soft delete)", async () => {
    const deprecated = makeTemplate({ status: "deprecated" });
    mockQuery.mockResolvedValue({ rows: [deprecated] });

    const result = await deleteTemplate("tpl-1");

    expect(result.success).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'deprecated'"),
      ["tpl-1"]
    );
  });

  it("returns error when template not found", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await deleteTemplate("nonexistent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("No active template found");
  });
});

// ============================================================
// validateTemplateContent
// ============================================================

describe("validateTemplateContent", () => {
  it("accepts valid record_set content", () => {
    const result = validateTemplateContent("record_set", { records: [{ name: "A" }] });
    expect(result.valid).toBe(true);
  });

  it("rejects content missing required fields", () => {
    const result = validateTemplateContent("notification", { subject: "Hi" });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("body");
  });

  it("rejects invalid template type", () => {
    const result = validateTemplateContent("unknown_type", {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid template type");
  });

  it("accepts valid notification content", () => {
    const result = validateTemplateContent("notification", {
      subject: "Welcome",
      body: "Hello!",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts valid workflow content", () => {
    const result = validateTemplateContent("workflow", {
      steps: [{ name: "step-1", action: "email" }],
    });
    expect(result.valid).toBe(true);
  });
});

// ============================================================
// getTemplateHistory
// ============================================================

describe("getTemplateHistory", () => {
  it("returns version chain ordered DESC", async () => {
    const rows = [
      makeTemplate({ id: "tpl-v3", version: 3 }),
      makeTemplate({ id: "tpl-v2", version: 2 }),
      makeTemplate({ id: "tpl-v1", version: 1 }),
    ];
    mockQuery.mockResolvedValue({ rows });

    const result = await getTemplateHistory("tpl-v3");

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WITH RECURSIVE"),
      ["tpl-v3"]
    );
  });
});

// ============================================================
// applyTemplate
// ============================================================

describe("applyTemplate", () => {
  it("record_set creates records in target concept", async () => {
    const template = makeTemplate({
      template_type: "record_set",
      content: { records: [{ name: "John" }, { name: "Jane" }] },
      concept_key: "guest",
    });

    // getTemplateById mock
    mockQuery.mockResolvedValueOnce({ rows: [template] });

    // withTransaction for record creation
    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [], rowCount: 1 });
      return fn(client);
    });

    const result = await applyTemplate("tpl-1", { table_name: "domain_records" });

    expect(result.success).toBe(true);
    expect(result.data?.template_type).toBe("record_set");
    expect(result.data?.records_created).toBe(2);
  });

  it("form_preset sets FormConfig for concept", async () => {
    const template = makeTemplate({
      template_type: "form_preset",
      content: { fields: [{ key: "name", type: "text" }] },
      concept_key: "guest",
    });

    // getTemplateById mock
    mockQuery
      .mockResolvedValueOnce({ rows: [template] })
      // INSERT into form_configs
      .mockResolvedValueOnce({ rows: [{ id: "fc-1" }] });

    const result = await applyTemplate("tpl-1", {});

    expect(result.success).toBe(true);
    expect(result.data?.template_type).toBe("form_preset");
    expect(result.data?.config_id).toBe("fc-1");
  });

  it("notification returns content for caller", async () => {
    const template = makeTemplate({
      template_type: "notification",
      content: { subject: "Welcome", body: "Hello {{name}}!" },
    });

    mockQuery.mockResolvedValueOnce({ rows: [template] });

    const result = await applyTemplate("tpl-1", {});

    expect(result.success).toBe(true);
    expect(result.data?.template_type).toBe("notification");
    expect(result.data?.content).toEqual({ subject: "Welcome", body: "Hello {{name}}!" });
  });

  it("returns error when template not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await applyTemplate("nonexistent", {});

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ============================================================
// exportTemplates
// ============================================================

describe("exportTemplates", () => {
  it("produces valid JSON export format", async () => {
    const templates = [makeTemplate(), makeTemplate({ id: "tpl-2" })];
    mockQuery.mockResolvedValue({ rows: templates });

    const result = await exportTemplates({ type: "record_set" });

    expect(result.success).toBe(true);
    expect(result.data?.format).toBe(EXPORT_FORMAT_VERSION);
    expect(result.data?.exported_at).toBeDefined();
    expect(result.data?.templates).toHaveLength(2);
  });
});

// ============================================================
// importTemplates
// ============================================================

describe("importTemplates", () => {
  it("creates entries without overwriting", async () => {
    const templateData = makeTemplate({ template_type: "notification", content: { subject: "Hi", body: "Hello" } });
    const created = makeTemplate({ id: "tpl-new", template_type: "notification", content: { subject: "Hi", body: "Hello" } });

    mockWithTransaction.mockImplementation(async (fn: Function) => {
      const client = makeMockClient();
      client.query.mockResolvedValue({ rows: [created] });
      return fn(client);
    });

    const result = await importTemplates({
      format: EXPORT_FORMAT_VERSION,
      exported_at: "2026-04-01T00:00:00Z",
      templates: [templateData],
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].id).toBe("tpl-new");
  });

  it("rejects unsupported import format", async () => {
    const result = await importTemplates({
      format: "unknown-v99",
      exported_at: "2026-04-01T00:00:00Z",
      templates: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported import format");
  });

  it("rejects empty template list", async () => {
    const result = await importTemplates({
      format: EXPORT_FORMAT_VERSION,
      exported_at: "2026-04-01T00:00:00Z",
      templates: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no templates");
  });
});
