import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assembleContract,
  renderContractHtml,
  createGuestContract,
} from "./contracts";

// --- Mock dependencies ---

vi.mock("../db/client", () => ({
  query: vi.fn(),
}));

vi.mock("../conditions/evaluator", () => ({
  evaluateCondition: vi.fn(),
}));

import { query } from "../db/client";
import { evaluateCondition } from "../conditions/evaluator";

const mockQuery = vi.mocked(query);
const mockEvaluate = vi.mocked(evaluateCondition);

// --- Fixtures ---

const TEMPLATE_ROW = {
  id: "tpl-1",
  name: "Guest Agreement",
  header_html: "<h1>Agreement for {{guest_name}}</h1>",
  footer_html: "<footer>Date: {{arrival_date}}</footer>",
};

const CLAUSE_UNCONDITIONAL = {
  id: "cl-1",
  template_id: "tpl-1",
  sort_order: 1,
  title: "Terms",
  body_html: "<p>Welcome, {{guest_name}}.</p>",
  condition: null,
};

const CLAUSE_CONDITIONAL = {
  id: "cl-2",
  template_id: "tpl-1",
  sort_order: 2,
  title: "Pet Policy",
  body_html: "<p>Pets allowed for {{guest_name}}.</p>",
  condition: { type: "field", field: "has_pets", operator: "eq", value: true },
};

const GUEST_ROW = {
  id: "g-1",
  guest_name: "Alice Smith",
  arrival_date: "2026-05-01",
  has_pets: true,
};

function setupQueryMock(clauses: unknown[] = [CLAUSE_UNCONDITIONAL, CLAUSE_CONDITIONAL]) {
  mockQuery.mockImplementation(async (text: string) => {
    if (text.includes("contract_templates")) {
      return { rows: [TEMPLATE_ROW], rowCount: 1 } as never;
    }
    if (text.includes("contract_clauses")) {
      return { rows: clauses, rowCount: clauses.length } as never;
    }
    if (text.includes("guests")) {
      return { rows: [GUEST_ROW], rowCount: 1 } as never;
    }
    if (text.includes("guest_contracts")) {
      return {
        rows: [{
          id: "gc-1",
          guest_id: "g-1",
          template_id: "tpl-1",
          html: "<html>mocked</html>",
          status: "draft",
          created_by: "user-1",
          created_at: "2026-05-01T10:00:00Z",
        }],
        rowCount: 1,
      } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEvaluate.mockReturnValue(true);
});

// --- assembleContract ---

describe("assembleContract", () => {
  it("includes unconditional clauses", async () => {
    setupQueryMock([CLAUSE_UNCONDITIONAL]);

    const html = await assembleContract("g-1", "tpl-1");

    expect(html).toContain("Terms");
    expect(html).toContain("Welcome, Alice Smith.");
  });

  it("evaluates conditional clauses and includes when true", async () => {
    setupQueryMock();
    mockEvaluate.mockReturnValue(true);

    const html = await assembleContract("g-1", "tpl-1");

    expect(html).toContain("Pet Policy");
    expect(html).toContain("Pets allowed for Alice Smith.");
  });

  it("excludes conditional clauses when condition is false", async () => {
    setupQueryMock();
    mockEvaluate.mockReturnValue(false);

    const html = await assembleContract("g-1", "tpl-1");

    // Unconditional clause should still be present
    expect(html).toContain("Terms");
    // Conditional clause should be excluded
    expect(html).not.toContain("Pet Policy");
  });

  it("replaces {{variable}} placeholders with guest data", async () => {
    setupQueryMock([CLAUSE_UNCONDITIONAL]);

    const html = await assembleContract("g-1", "tpl-1");

    expect(html).toContain("Agreement for Alice Smith");
    expect(html).toContain("Welcome, Alice Smith.");
    expect(html).toContain("Date: 2026-05-01");
  });

  it("replaces missing variables with empty string", async () => {
    const clauseWithMissing = {
      ...CLAUSE_UNCONDITIONAL,
      body_html: "<p>Room: {{room_number}}</p>",
    };
    setupQueryMock([clauseWithMissing]);

    const html = await assembleContract("g-1", "tpl-1");

    expect(html).toContain("<p>Room: </p>");
  });

  it("throws when template not found", async () => {
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes("contract_templates")) {
        return { rows: [], rowCount: 0 } as never;
      }
      if (text.includes("contract_clauses")) {
        return { rows: [], rowCount: 0 } as never;
      }
      if (text.includes("guests")) {
        return { rows: [GUEST_ROW], rowCount: 1 } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    });

    await expect(assembleContract("g-1", "tpl-missing")).rejects.toThrow(
      "Contract template not found"
    );
  });
});

// --- renderContractHtml ---

describe("renderContractHtml", () => {
  it("wraps assembled content in full HTML document", async () => {
    setupQueryMock([CLAUSE_UNCONDITIONAL]);

    const html = await renderContractHtml("g-1", "tpl-1");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
    expect(html).toContain("Agreement for Alice Smith");
  });
});

// --- createGuestContract ---

describe("createGuestContract", () => {
  it("inserts with status=draft and returns record", async () => {
    setupQueryMock([CLAUSE_UNCONDITIONAL]);

    const contract = await createGuestContract("g-1", "tpl-1", "user-1");

    // Verify the INSERT query was called
    const insertCall = mockQuery.mock.calls.find(
      (call) => (call[0] as string).includes("INSERT INTO guest_contracts")
    );
    expect(insertCall).toBeDefined();
    expect((insertCall?.[0] as string)).toContain("'draft'");

    expect(contract.status).toBe("draft");
    expect(contract.guest_id).toBe("g-1");
    expect(contract.template_id).toBe("tpl-1");
    expect(contract.created_by).toBe("user-1");
  });
});
