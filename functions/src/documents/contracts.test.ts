/**
 * Tests for Contract Assembly & Rendering Service
 *
 * Covers:
 * - assembleContract: clause filtering, condition evaluation, placeholder resolution, ordering
 * - renderContractHtml: HTML document wrapping
 * - createGuestContract: insertion with draft status
 * - getGuestContract: record retrieval
 * - Error handling: missing template, empty clauses
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockEvaluateCondition = vi.fn();
vi.mock("../conditions/evaluator", () => ({
  evaluateCondition: (...args: unknown[]) => mockEvaluateCondition(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// --- Import module under test ---

import {
  assembleContract,
  renderContractHtml,
  createGuestContract,
  getGuestContract,
} from "./contracts";

// --- Fixtures ---

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tmpl-1",
    name: "Guest Agreement",
    description: "Standard guest agreement",
    base_content: "<h1>Contract for {{name}}</h1>",
    version: 1,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function guestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "guest-1",
    name: "Tanaka Ichiro",
    type: "JP",
    department: "Music",
    status: "confirmed",
    company: "TechCorp",
    properties: { interpreterRequired: true },
    ...overrides,
  };
}

function clauseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "clause-1",
    template_id: "tmpl-1",
    name: "General Terms",
    content: "<p>This contract is between {{name}} of {{company}}.</p>",
    condition: null,
    sort_order: 0,
    required: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "contract-1",
    guest_id: "guest-1",
    template_id: "tmpl-1",
    rendered_html: "<html>...</html>",
    status: "draft",
    sent_at: null,
    signed_at: null,
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// --- Setup ---

/**
 * Set up mock responses for template, guest, and clauses queries.
 * Call order: 1=template, 2=guest, 3=clauses
 */
function setupQueryMocks(
  template: Record<string, unknown> | null,
  guest: Record<string, unknown> | null,
  clauses: Record<string, unknown>[]
) {
  mockQuery
    .mockResolvedValueOnce({ rows: template ? [template] : [] }) // template
    .mockResolvedValueOnce({ rows: guest ? [guest] : [] })       // guest
    .mockResolvedValueOnce({ rows: clauses });                    // clauses
}

// --- Tests ---

describe("assembleContract", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEvaluateCondition.mockReset();
  });

  it("includes unconditional clauses (no condition)", async () => {
    const clause = clauseRow();
    setupQueryMocks(templateRow(), guestRow(), [clause]);

    const html = await assembleContract("guest-1", "tmpl-1");

    expect(html).toContain("General Terms");
    expect(html).toContain("contract-clause");
  });

  it("evaluates conditional clauses and excludes false ones", async () => {
    const condition = { type: "field", field: "type", operator: "eq", value: "NA" };
    const includedClause = clauseRow({
      id: "clause-inc",
      name: "Included Clause",
      condition: null,
      sort_order: 0,
    });
    const excludedClause = clauseRow({
      id: "clause-exc",
      name: "Domestic Travel",
      condition,
      sort_order: 1,
    });

    setupQueryMocks(templateRow(), guestRow(), [includedClause, excludedClause]);
    mockEvaluateCondition.mockReturnValue(false);

    const html = await assembleContract("guest-1", "tmpl-1");

    expect(html).toContain("Included Clause");
    expect(html).not.toContain("Domestic Travel");
    expect(mockEvaluateCondition).toHaveBeenCalledOnce();
  });

  it("includes conditional clauses when condition evaluates true", async () => {
    const condition = { type: "field", field: "type", operator: "eq", value: "JP" };
    const clause = clauseRow({
      name: "International Travel",
      condition,
      sort_order: 1,
    });

    setupQueryMocks(templateRow(), guestRow(), [clause]);
    mockEvaluateCondition.mockReturnValue(true);

    const html = await assembleContract("guest-1", "tmpl-1");

    expect(html).toContain("International Travel");
  });

  it("replaces {{name}} and {{company}} placeholders", async () => {
    const clause = clauseRow({
      content: "<p>Agreement with {{name}} from {{company}}.</p>",
    });
    setupQueryMocks(templateRow(), guestRow(), [clause]);

    const html = await assembleContract("guest-1", "tmpl-1");

    expect(html).toContain("Tanaka Ichiro");
    expect(html).toContain("TechCorp");
    expect(html).not.toContain("{{name}}");
    expect(html).not.toContain("{{company}}");
  });

  it("orders clauses by sort_order", async () => {
    const clauseA = clauseRow({ id: "c-a", name: "Second Clause", sort_order: 2 });
    const clauseB = clauseRow({ id: "c-b", name: "First Clause", sort_order: 1 });
    // Query returns them in sort_order (mock simulates ORDER BY)
    setupQueryMocks(templateRow(), guestRow(), [clauseB, clauseA]);

    const html = await assembleContract("guest-1", "tmpl-1");

    const firstIdx = html.indexOf("First Clause");
    const secondIdx = html.indexOf("Second Clause");
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("throws error when template is not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no template

    await expect(assembleContract("guest-1", "bad-tmpl")).rejects.toThrow(
      "Contract template not found: bad-tmpl"
    );
  });

  it("throws error when guest is not found", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [templateRow()] })
      .mockResolvedValueOnce({ rows: [] }); // no guest

    await expect(assembleContract("bad-guest", "tmpl-1")).rejects.toThrow(
      "Guest not found: bad-guest"
    );
  });

  it("produces empty clause body when clause list is empty", async () => {
    setupQueryMocks(templateRow(), guestRow(), []);

    const html = await assembleContract("guest-1", "tmpl-1");

    expect(html).toContain("Contract for Tanaka Ichiro");
    expect(html).not.toContain("contract-clause");
  });

  it("resolves base_content placeholders", async () => {
    const template = templateRow({ base_content: "<h1>{{name}} - {{department}}</h1>" });
    setupQueryMocks(template, guestRow(), []);

    const html = await assembleContract("guest-1", "tmpl-1");

    expect(html).toContain("Tanaka Ichiro - Music");
  });

  it("leaves unresolved placeholders intact", async () => {
    const clause = clauseRow({
      content: "<p>Flight: {{flightDetails}}</p>",
    });
    setupQueryMocks(templateRow(), guestRow(), [clause]);

    const html = await assembleContract("guest-1", "tmpl-1");

    expect(html).toContain("{{flightDetails}}");
  });
});

describe("renderContractHtml", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEvaluateCondition.mockReset();
  });

  it("wraps assembled contract in HTML document", async () => {
    setupQueryMocks(templateRow(), guestRow(), [clauseRow()]);

    const html = await renderContractHtml("guest-1", "tmpl-1");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
    expect(html).toContain("General Terms");
  });
});

describe("getGuestContract", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns contract record when found", async () => {
    const contract = contractRow();
    mockQuery.mockResolvedValueOnce({ rows: [contract] });

    const result = await getGuestContract("contract-1");

    expect(result).toEqual(contract);
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT * FROM guest_contracts WHERE id = $1",
      ["contract-1"]
    );
  });

  it("returns null when contract not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getGuestContract("bad-id");

    expect(result).toBeNull();
  });
});

describe("createGuestContract", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEvaluateCondition.mockReset();
  });

  it("inserts contract with status draft and returns record", async () => {
    // assembleContract queries: template, guest, clauses
    setupQueryMocks(templateRow(), guestRow(), [clauseRow()]);
    // INSERT RETURNING
    const created = contractRow();
    mockQuery.mockResolvedValueOnce({ rows: [created] });

    const result = await createGuestContract("guest-1", "tmpl-1", "user-1");

    expect(result).toEqual(created);

    // Verify the INSERT call (4th call)
    const insertCall = mockQuery.mock.calls[3];
    expect(insertCall[0]).toContain("INSERT INTO guest_contracts");
    expect(insertCall[0]).toContain("'draft'");
    expect(insertCall[1]).toContain("guest-1");
    expect(insertCall[1]).toContain("tmpl-1");
  });
});
