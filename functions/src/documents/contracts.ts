/**
 * Contract Assembly & Rendering Service
 *
 * Assembles contracts from conditional clauses (ConditionExpression per clause,
 * Handlebars-style variable substitution). Contracts are rendered as HTML for
 * in-app display and PDF export.
 *
 * Data flow:
 *   contract_template -> contract_clauses (filtered by condition) -> rendered HTML
 */

import { query } from "../db/client";
import { evaluateCondition } from "../conditions/evaluator";
import type { ConditionExpression } from "../ontology/types";
import * as logger from "firebase-functions/logger";

// --- Types ---

export interface ContractTemplate {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly base_content: string;
  readonly version: number;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ContractClause {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly template_id: string;
  readonly name: string;
  readonly content: string;
  readonly condition: ConditionExpression | null;
  readonly sort_order: number;
  readonly required: boolean;
  readonly created_at: string;
}

export interface GuestRecord {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly name: string;
  readonly type: string | null;
  readonly department: string | null;
  readonly status: string;
  readonly company: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface GuestContract {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly guest_id: string;
  readonly template_id: string;
  readonly rendered_html: string | null;
  readonly status: string;
  readonly sent_at: string | null;
  readonly signed_at: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly created_at: string;
  readonly updated_at: string;
}

// --- Placeholder Resolution ---

/**
 * Replace {{variable}} placeholders in content with values from the context.
 * Supports dot-path notation: {{properties.vip}} resolves nested values.
 * Unresolved placeholders are left as-is.
 */
function resolvePlaceholders(
  content: string,
  context: Readonly<Record<string, unknown>>
): string {
  return content.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const segments = path.split(".");
    let current: unknown = context;

    for (const segment of segments) {
      if (current === null || current === undefined || typeof current !== "object") {
        return `{{${path}}}`;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    if (current === null || current === undefined) {
      return `{{${path}}}`;
    }

    return String(current);
  });
}

/**
 * Build a flat context object from a guest record for condition evaluation
 * and placeholder resolution.
 */
function buildGuestContext(guest: GuestRecord): Record<string, unknown> {
  return {
    id: guest.id,
    name: guest.name,
    type: guest.type,
    department: guest.department,
    status: guest.status,
    company: guest.company,
    properties: guest.properties,
    ...guest.properties,
  };
}

// --- Core Functions ---

/**
 * Assemble a contract by loading the template, filtering clauses by condition,
 * and resolving placeholders against the guest record.
 *
 * Returns the assembled HTML body (clauses only, no document wrapper).
 */
export async function assembleContract(
  guestId: string,
  templateId: string
): Promise<string> {
  // Load template
  const templateResult = await query<ContractTemplate>(
    "SELECT * FROM contract_templates WHERE id = $1",
    [templateId]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`Contract template not found: ${templateId}`);
  }

  const template = templateResult.rows[0];

  // Load guest
  const guestResult = await query<GuestRecord>(
    "SELECT id, name, type, department, status, company, properties FROM guests WHERE id = $1",
    [guestId]
  );

  if (guestResult.rows.length === 0) {
    throw new Error(`Guest not found: ${guestId}`);
  }

  const guest = guestResult.rows[0];
  const context = buildGuestContext(guest);

  // Load clauses ordered by sort_order
  const clausesResult = await query<ContractClause>(
    "SELECT * FROM contract_clauses WHERE template_id = $1 ORDER BY sort_order ASC",
    [templateId]
  );

  // Filter clauses by condition
  const includedClauses: ContractClause[] = [];

  for (const clause of clausesResult.rows) {
    if (clause.condition === null) {
      // No condition = always include
      includedClauses.push(clause);
    } else {
      try {
        const shouldInclude = evaluateCondition(clause.condition, context);
        if (shouldInclude) {
          includedClauses.push(clause);
        }
      } catch (err) {
        logger.error("Clause condition evaluation failed", {
          clauseId: clause.id,
          clauseName: clause.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // Resolve placeholders and assemble HTML
  const resolvedBase = resolvePlaceholders(template.base_content, context);
  const clauseHtml = includedClauses
    .map((clause) => {
      const resolved = resolvePlaceholders(clause.content, context);
      return `<section class="contract-clause" data-clause-id="${clause.id}"><h3>${clause.name}</h3>${resolved}</section>`;
    })
    .join("\n");

  return `${resolvedBase}\n${clauseHtml}`;
}

/**
 * Render a complete HTML document for a contract.
 * Wraps the assembled clauses in an HTML document with styles.
 */
export async function renderContractHtml(
  guestId: string,
  templateId: string
): Promise<string> {
  const body = await assembleContract(guestId, templateId);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Contract</title>
<style>
  body { font-family: 'Georgia', serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #333; }
  .contract-clause { margin-bottom: 1.5rem; page-break-inside: avoid; }
  .contract-clause h3 { font-size: 1.1rem; margin-bottom: 0.5rem; }
  @media print { body { padding: 1cm; } }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Load a guest contract record by ID.
 */
export async function getGuestContract(
  contractId: string
): Promise<GuestContract | null> {
  const result = await query<GuestContract>(
    "SELECT * FROM guest_contracts WHERE id = $1",
    [contractId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Create a new guest contract: assemble the contract, render HTML,
 * and insert into guest_contracts with status='draft'.
 */
export async function createGuestContract(
  guestId: string,
  templateId: string,
  createdBy: string
): Promise<GuestContract> {
  const html = await renderContractHtml(guestId, templateId);

  const result = await query<GuestContract>(
    `INSERT INTO guest_contracts (guest_id, template_id, rendered_html, status, properties)
     VALUES ($1, $2, $3, 'draft', $4)
     RETURNING *`,
    [guestId, templateId, html, JSON.stringify({ created_by: createdBy })]
  );

  logger.info("Guest contract created", {
    contractId: result.rows[0].id,
    guestId,
    templateId,
  });

  return result.rows[0];
}
