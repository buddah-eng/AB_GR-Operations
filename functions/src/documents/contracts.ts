/**
 * Contract Assembly Service
 *
 * Loads a contract template and its clauses from Postgres, evaluates
 * conditional clauses against guest data, replaces {{variable}} placeholders,
 * and assembles the final HTML document. Supports creating guest_contracts
 * records with status=draft.
 */

import { query } from "../db/client";
import { evaluateCondition } from "../conditions/evaluator";
import type { ConditionExpression } from "../ontology/types";

// --- Types ---

export interface ContractTemplate {
  readonly id: string;
  readonly name: string;
  readonly header_html: string;
  readonly footer_html: string;
}

export interface ContractClause {
  readonly id: string;
  readonly template_id: string;
  readonly sort_order: number;
  readonly title: string;
  readonly body_html: string;
  readonly condition: ConditionExpression | null;
}

export interface GuestContract {
  readonly id: string;
  readonly guest_id: string;
  readonly template_id: string;
  readonly html: string;
  readonly status: string;
  readonly created_by: string;
  readonly created_at: string;
}

// --- HTML escaping (XSS prevention) ---

/**
 * Escapes HTML special characters to prevent XSS when inserting
 * dynamic values into HTML output.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// --- Variable replacement ---

const VARIABLE_PATTERN = /\{\{(\w+(?:\.\w+)*)\}\}/g;

/**
 * Replaces all {{variable}} placeholders in text with values from the
 * context object. Supports dot-path resolution (e.g., {{guest.name}}).
 * Missing variables are replaced with an empty string.
 * All values are HTML-escaped to prevent XSS.
 */
function replaceVariables(
  text: string,
  context: Readonly<Record<string, unknown>>
): string {
  return text.replace(VARIABLE_PATTERN, (_match, path: string) => {
    const value = resolveDotPath(context, path);
    if (value === undefined || value === null) return "";
    return escapeHtml(String(value));
  });
}

function resolveDotPath(
  obj: Readonly<Record<string, unknown>>,
  path: string
): unknown {
  const segments = path.split(".");
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// --- Template & clause loading ---

async function loadTemplate(templateId: string): Promise<ContractTemplate> {
  const result = await query(
    "SELECT id, name, header_html, footer_html FROM contract_templates WHERE id = $1",
    [templateId]
  );
  if (result.rows.length === 0) {
    throw new Error(`Contract template not found: ${templateId}`);
  }
  const row = result.rows[0];
  return {
    id: row.id as string,
    name: row.name as string,
    header_html: row.header_html as string,
    footer_html: row.footer_html as string,
  };
}

async function loadClauses(templateId: string): Promise<ReadonlyArray<ContractClause>> {
  const result = await query(
    "SELECT id, template_id, sort_order, title, body_html, condition FROM contract_clauses WHERE template_id = $1 ORDER BY sort_order",
    [templateId]
  );
  return result.rows.map((row) => ({
    id: row.id as string,
    template_id: row.template_id as string,
    sort_order: row.sort_order as number,
    title: row.title as string,
    body_html: row.body_html as string,
    condition: (row.condition as ConditionExpression | null) ?? null,
  }));
}

async function loadGuestContext(
  guestId: string
): Promise<Record<string, unknown>> {
  const result = await query(
    "SELECT * FROM guests WHERE id = $1",
    [guestId]
  );
  if (result.rows.length === 0) {
    throw new Error(`Guest not found: ${guestId}`);
  }
  return result.rows[0] as Record<string, unknown>;
}

// --- Assembly ---

/**
 * Assembles a contract by loading template + clauses, evaluating conditions
 * against guest data, replacing {{variables}}, and returning assembled HTML
 * body (no wrapper document).
 */
export async function assembleContract(
  guestId: string,
  templateId: string
): Promise<string> {
  const [template, clauses, guestData] = await Promise.all([
    loadTemplate(templateId),
    loadClauses(templateId),
    loadGuestContext(guestId),
  ]);

  const context: Record<string, unknown> = {
    ...guestData,
    guest: guestData,
  };

  const includedClauses = clauses.filter((clause) => {
    if (!clause.condition) return true;
    return evaluateCondition(clause.condition, context);
  });

  const headerHtml = replaceVariables(template.header_html, context);
  const footerHtml = replaceVariables(template.footer_html, context);

  const clauseHtmlParts = includedClauses.map((clause) => {
    const title = replaceVariables(clause.title, context);
    const body = replaceVariables(clause.body_html, context);
    return `<section class="clause"><h2>${title}</h2>${body}</section>`;
  });

  return [headerHtml, ...clauseHtmlParts, footerHtml].join("\n");
}

// --- HTML rendering ---

/**
 * Renders a complete styled HTML document wrapping the assembled contract.
 */
export async function renderContractHtml(
  guestId: string,
  templateId: string
): Promise<string> {
  const body = await assembleContract(guestId, templateId);

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "<title>Contract</title>",
    "<style>",
    "  body { font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #1a1a1a; }",
    "  .clause { margin-bottom: 1.5rem; }",
    "  .clause h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }",
    "  .signature-line { margin-top: 3rem; border-top: 1px solid #333; width: 300px; padding-top: 0.25rem; }",
    "</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

// --- Persistence ---

/**
 * Assembles a contract and stores it in the guest_contracts table
 * with status=draft.
 */
export async function createGuestContract(
  guestId: string,
  templateId: string,
  createdBy: string
): Promise<GuestContract> {
  const html = await renderContractHtml(guestId, templateId);

  const result = await query(
    `INSERT INTO guest_contracts (guest_id, template_id, html, status, created_by)
     VALUES ($1, $2, $3, 'draft', $4)
     RETURNING id, guest_id, template_id, html, status, created_by, created_at`,
    [guestId, templateId, html, createdBy]
  );

  const row = result.rows[0];
  return {
    id: row.id as string,
    guest_id: row.guest_id as string,
    template_id: row.template_id as string,
    html: row.html as string,
    status: row.status as string,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
  };
}
