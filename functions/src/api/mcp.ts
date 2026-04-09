/**
 * MCP API Router
 *
 * HTTP API layer for Model Context Protocol clients. Exposes a tool registry
 * and an execution endpoint that dispatches to internal platform operations.
 *
 * Auth delegation is handled by the existing middleware chain:
 *   Firebase token + X-MCP-Delegation header -> actorType = 'ai_agent'
 *
 * This is NOT a full MCP server (no WebSocket/stdio). MCP clients call
 * these endpoints over HTTP like any other API consumer.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { getOntology, getConceptByKey, getPropertiesForConcept } from "../ontology/loader";
import { roleEngine } from "../roles/engine";
import { emit, createDomainEvent } from "../events/bus";
import { requireAuth } from "../auth/middleware";

// --- Types ---

export interface McpToolParameter {
  readonly type: string;
  readonly required?: boolean;
  readonly description: string;
}

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, McpToolParameter>>;
  readonly annotations: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
  };
}

interface McpExecuteRequest {
  readonly tool: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly confirmBulk?: boolean;
  readonly mcpSession?: string;
}

// --- Concept-to-table mapping (mirrors domains.ts) ---

const TABLE_MAP: Readonly<Record<string, string>> = {
  guest: "guests",
  staff: "staff",
  volunteer: "staff",
  schedule: "schedule_events",
  schedule_event: "schedule_events",
  prep_item: "prep_items",
  pairing: "pairings",
  venue: "venues",
  shift: "shifts",
  shift_assignment: "shift_assignments",
  equipment: "equipment",
  transport_booking: "transport_bookings",
  contract_template: "contract_templates",
  contract_clause: "contract_clauses",
  guest_contract: "guest_contracts",
};

function conceptToTable(conceptKey: string): string {
  const table = TABLE_MAP[conceptKey];
  if (!table) {
    throw Object.assign(
      new Error(`No table mapping for concept "${conceptKey}"`),
      { status: 400 }
    );
  }
  return table;
}

// --- Tool Registry ---

export const MCP_TOOLS: ReadonlyArray<McpTool> = [
  {
    name: "get_ontology",
    description: "Returns the domain ontology (concepts, properties, relationships). Use this to understand what data exists before querying.",
    parameters: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "list_records",
    description: "List records for a domain concept with optional filters and pagination.",
    parameters: {
      concept: { type: "string", required: true, description: "The concept key (e.g. 'guest', 'staff')" },
      filters: { type: "object", description: "Key-value pairs to filter records" },
      page: { type: "number", description: "Page number (default: 1)" },
      limit: { type: "number", description: "Records per page (default: 50, max: 200)" },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "get_record",
    description: "Fetch a single record by concept and ID.",
    parameters: {
      concept: { type: "string", required: true, description: "The concept key" },
      id: { type: "string", required: true, description: "The record ID (UUID)" },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "create_record",
    description: "Create a new record for a domain concept.",
    parameters: {
      concept: { type: "string", required: true, description: "The concept key" },
      data: { type: "object", required: true, description: "The record payload (field key-value pairs)" },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "update_record",
    description: "Update an existing record. Only include changed fields in data.",
    parameters: {
      concept: { type: "string", required: true, description: "The concept key" },
      id: { type: "string", required: true, description: "The record ID (UUID)" },
      data: { type: "object", required: true, description: "Changed fields only" },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "run_workflow",
    description: "Trigger a named manual workflow.",
    parameters: {
      workflowId: { type: "string", required: true, description: "The workflow ID to execute" },
      context: { type: "object", description: "Optional context data for the workflow" },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "my_assignments",
    description: "List all records across concepts assigned to the current user.",
    parameters: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
];

// --- Mutation tracking ---

const BULK_MUTATION_LIMIT = 5;

const DESTRUCTIVE_TOOLS = new Set(["create_record", "update_record", "run_workflow"]);

/** Per-session mutation counters. Keyed by session ID or request ID. */
const mutationCounts = new Map<string, number>();

function getSessionKey(req: Request, body: McpExecuteRequest): string {
  return body.mcpSession ?? req.headers["x-mcp-session"] as string ?? req.user?.uid ?? "anonymous";
}

function getMutationCount(sessionKey: string): number {
  return mutationCounts.get(sessionKey) ?? 0;
}

function incrementMutationCount(sessionKey: string): number {
  const current = getMutationCount(sessionKey);
  const next = current + 1;
  mutationCounts.set(sessionKey, next);
  return next;
}

// --- Router ---

export const mcpRouter = Router();

mcpRouter.use(requireAuth);

// --- GET /api/mcp/tools ---

mcpRouter.get("/tools", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: MCP_TOOLS,
  });
});

// --- POST /api/mcp/execute ---

mcpRouter.post("/execute", async (req: Request, res: Response) => {
  try {
    const body = req.body as McpExecuteRequest;

    if (!body.tool || typeof body.tool !== "string") {
      res.status(400).json({
        success: false,
        error: "Missing required field: tool",
      });
      return;
    }

    const tool = MCP_TOOLS.find((t) => t.name === body.tool);
    if (!tool) {
      res.status(400).json({
        success: false,
        error: `Unknown tool: "${body.tool}". Use GET /api/mcp/tools for available tools.`,
      });
      return;
    }

    // Validate required parameters
    const params = body.parameters ?? {};
    const missingParams = Object.entries(tool.parameters)
      .filter(([key, def]) => def.required && params[key] === undefined)
      .map(([key]) => key);

    if (missingParams.length > 0) {
      res.status(400).json({
        success: false,
        error: `Missing required parameters: ${missingParams.join(", ")}`,
      });
      return;
    }

    // Bulk mutation limit gate
    if (DESTRUCTIVE_TOOLS.has(body.tool)) {
      const sessionKey = getSessionKey(req, body);
      const count = getMutationCount(sessionKey);

      if (count >= BULK_MUTATION_LIMIT && !body.confirmBulk) {
        res.status(429).json({
          success: false,
          error: "bulk_limit_exceeded",
          mutationCount: count,
          requiresConfirmation: true,
        });
        return;
      }

      incrementMutationCount(sessionKey);
    }

    // Build metadata for audit
    const mcpMetadata = {
      mcp_tool: body.tool,
      mcp_session: body.mcpSession ?? req.headers["x-mcp-session"] ?? undefined,
    };

    // Dispatch to tool handler
    const result = await executeTool(req, body.tool, params, mcpMetadata);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status ?? 500;
    logger.error("MCP execute error", { error: message });
    res.status(status).json({
      success: false,
      error: message,
    });
  }
});

// --- Tool Dispatch ---

async function executeTool(
  req: Request,
  toolName: string,
  params: Readonly<Record<string, unknown>>,
  mcpMetadata: Readonly<Record<string, unknown>>
): Promise<unknown> {
  const roleKey = req.role?.roleKey ?? "viewer";

  switch (toolName) {
    case "get_ontology":
      return executeGetOntology();

    case "list_records":
      return executeListRecords(params, roleKey);

    case "get_record":
      return executeGetRecord(params, roleKey);

    case "create_record":
      return executeCreateRecord(req, params, roleKey, mcpMetadata);

    case "update_record":
      return executeUpdateRecord(req, params, roleKey, mcpMetadata);

    case "run_workflow":
      return executeRunWorkflow(req, params, mcpMetadata);

    case "my_assignments":
      return executeMyAssignments(req, roleKey);

    default:
      throw Object.assign(new Error(`Unknown tool: "${toolName}"`), { status: 400 });
  }
}

// --- Tool Implementations ---

async function executeGetOntology(): Promise<unknown> {
  const ontology = await getOntology();
  return {
    concepts: Object.fromEntries(ontology.concepts),
    properties: Object.fromEntries(
      Array.from(ontology.properties.entries()).map(
        ([key, props]) => [key, Array.from(props)]
      )
    ),
    relationships: Object.fromEntries(
      Array.from(ontology.relationships.entries()).map(
        ([key, rels]) => [key, Array.from(rels)]
      )
    ),
  };
}

async function executeListRecords(
  params: Readonly<Record<string, unknown>>,
  roleKey: string
): Promise<unknown> {
  const conceptKey = params.concept as string;
  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    throw Object.assign(new Error(`Unknown concept: "${conceptKey}"`), { status: 400 });
  }

  const canView = await roleEngine.canPerformAction(roleKey, conceptKey, "view");
  if (!canView) {
    throw Object.assign(
      new Error(`You do not have permission to view ${concept.pluralName}.`),
      { status: 403 }
    );
  }

  const table = conceptToTable(conceptKey);
  const page = clampInt(params.page, 1, 10000, 1);
  const limit = clampInt(params.limit, 1, 200, 50);
  const offset = (page - 1) * limit;

  const filters = (params.filters ?? {}) as Record<string, unknown>;
  const properties = await getPropertiesForConcept(conceptKey);

  // Build filter WHERE clause
  const { whereClauses, filterParams } = buildFilterClauses(filters, properties);

  const countResult = await query(
    `SELECT COUNT(*) FROM ${table} WHERE NOT archived ${whereClauses}`,
    filterParams
  );
  const total = parseInt(countResult.rows[0].count as string, 10);

  const dataResult = await query(
    `SELECT * FROM ${table} WHERE NOT archived ${whereClauses} ORDER BY created_at DESC LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
    [...filterParams, limit, offset]
  );

  const records = await Promise.all(
    dataResult.rows.map(async (row) => {
      const record = rowToDomainRecord(row, conceptKey);
      const filteredProps = await roleEngine.filterRecord(roleKey, conceptKey, record.properties);
      return { ...record, properties: filteredProps };
    })
  );

  return { records, total, page, limit };
}

async function executeGetRecord(
  params: Readonly<Record<string, unknown>>,
  roleKey: string
): Promise<unknown> {
  const conceptKey = params.concept as string;
  const id = params.id as string;

  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    throw Object.assign(new Error(`Unknown concept: "${conceptKey}"`), { status: 400 });
  }

  const canView = await roleEngine.canPerformAction(roleKey, conceptKey, "view");
  if (!canView) {
    throw Object.assign(new Error("You do not have permission to view this record."), { status: 403 });
  }

  const table = conceptToTable(conceptKey);
  const result = await query(
    `SELECT * FROM ${table} WHERE id = $1 AND NOT archived`,
    [id]
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error("Record not found."), { status: 404 });
  }

  const record = rowToDomainRecord(result.rows[0], conceptKey);
  const filteredProps = await roleEngine.filterRecord(roleKey, conceptKey, record.properties);
  return { ...record, properties: filteredProps };
}

async function executeCreateRecord(
  req: Request,
  params: Readonly<Record<string, unknown>>,
  roleKey: string,
  mcpMetadata: Readonly<Record<string, unknown>>
): Promise<unknown> {
  const conceptKey = params.concept as string;
  const data = params.data as Record<string, unknown>;

  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    throw Object.assign(new Error(`Unknown concept: "${conceptKey}"`), { status: 400 });
  }

  const canCreate = await roleEngine.canPerformAction(roleKey, conceptKey, "create");
  if (!canCreate) {
    throw Object.assign(
      new Error(`You do not have permission to create ${concept.pluralName}.`),
      { status: 403 }
    );
  }

  const table = conceptToTable(conceptKey);
  const properties = await getPropertiesForConcept(conceptKey);
  const filteredPayload = await roleEngine.filterWritePayload(roleKey, conceptKey, data);

  const { coreColumns, jsonbProperties } = separateProperties(filteredPayload, properties);
  const finalCoreColumns: Record<string, unknown> = { ...coreColumns, created_by: req.user?.uid ?? null };

  const cols = Object.keys(finalCoreColumns).filter(isSafeIdentifier);
  const vals = cols.map((c) => finalCoreColumns[c]);
  cols.push("properties");
  vals.push(JSON.stringify(jsonbProperties));

  const placeholders = vals.map((_, i) => `$${i + 1}`);
  const insertResult = await query(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
    vals
  );

  const record = rowToDomainRecord(insertResult.rows[0], conceptKey);

  const event = createDomainEvent({
    eventName: `${conceptKey}.created`,
    domain: conceptKey,
    action: "created",
    recordId: record.id,
    newValues: filteredPayload,
    triggeredBy: req.user?.email ?? "system",
    metadata: mcpMetadata,
  });
  await emit(event);

  return record;
}

async function executeUpdateRecord(
  req: Request,
  params: Readonly<Record<string, unknown>>,
  roleKey: string,
  mcpMetadata: Readonly<Record<string, unknown>>
): Promise<unknown> {
  const conceptKey = params.concept as string;
  const id = params.id as string;
  const data = params.data as Record<string, unknown>;

  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    throw Object.assign(new Error(`Unknown concept: "${conceptKey}"`), { status: 400 });
  }

  const canEdit = await roleEngine.canPerformAction(roleKey, conceptKey, "edit");
  if (!canEdit) {
    throw Object.assign(new Error("You do not have permission to edit this record."), { status: 403 });
  }

  const table = conceptToTable(conceptKey);
  const properties = await getPropertiesForConcept(conceptKey);
  const filteredPayload = await roleEngine.filterWritePayload(roleKey, conceptKey, data);

  const { coreColumns, jsonbProperties } = separateProperties(filteredPayload, properties);

  const setClauses: string[] = [];
  const updateParams: unknown[] = [];
  let paramIdx = 1;

  for (const [col, val] of Object.entries(coreColumns)) {
    if (!isSafeIdentifier(col)) continue;
    setClauses.push(`${col} = $${paramIdx}`);
    updateParams.push(val);
    paramIdx++;
  }

  if (Object.keys(jsonbProperties).length > 0) {
    setClauses.push(`properties = properties || $${paramIdx}`);
    updateParams.push(JSON.stringify(jsonbProperties));
    paramIdx++;
  }

  setClauses.push("updated_at = now()");
  updateParams.push(id);

  const updateResult = await query(
    `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${paramIdx} AND NOT archived RETURNING *`,
    updateParams
  );

  if (updateResult.rows.length === 0) {
    throw Object.assign(new Error("Record not found."), { status: 404 });
  }

  const record = rowToDomainRecord(updateResult.rows[0], conceptKey);

  const event = createDomainEvent({
    eventName: `${conceptKey}.updated`,
    domain: conceptKey,
    action: "updated",
    recordId: id,
    newValues: filteredPayload,
    triggeredBy: req.user?.email ?? "system",
    metadata: mcpMetadata,
  });
  await emit(event);

  return record;
}

async function executeRunWorkflow(
  req: Request,
  params: Readonly<Record<string, unknown>>,
  mcpMetadata: Readonly<Record<string, unknown>>
): Promise<unknown> {
  const workflowId = params.workflowId as string;
  const context = (params.context ?? {}) as Record<string, unknown>;

  const wfResult = await query(
    "SELECT * FROM workflow_configs WHERE id = $1 AND status = 'active' AND enabled = true",
    [workflowId]
  );

  if (wfResult.rows.length === 0) {
    throw Object.assign(new Error(`Workflow "${workflowId}" not found or not active.`), { status: 404 });
  }

  const workflow = wfResult.rows[0];

  const event = createDomainEvent({
    eventName: `workflow.manual_trigger`,
    domain: "workflow",
    action: "created",
    recordId: workflowId,
    newValues: context,
    triggeredBy: req.user?.email ?? "system",
    metadata: { ...mcpMetadata, workflow_name: workflow.name },
  });
  await emit(event);

  return {
    workflowId,
    workflowName: workflow.name as string,
    status: "triggered",
  };
}

async function executeMyAssignments(
  req: Request,
  roleKey: string
): Promise<unknown> {
  const userId = req.user?.uid ?? "";

  // Query tables that have an assigned_to column
  const assignableTables = [
    { concept: "guest", table: "guests" },
    { concept: "prep_item", table: "prep_items" },
    { concept: "shift_assignment", table: "shift_assignments" },
  ];

  const results: Array<{ concept: string; records: unknown[] }> = [];

  for (const { concept, table } of assignableTables) {
    const canView = await roleEngine.canPerformAction(roleKey, concept, "view");
    if (!canView) continue;

    const dataResult = await query(
      `SELECT * FROM ${table} WHERE assigned_to = $1 AND NOT archived ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    const records = await Promise.all(
      dataResult.rows.map(async (row) => {
        const record = rowToDomainRecord(row, concept);
        const filteredProps = await roleEngine.filterRecord(roleKey, concept, record.properties);
        return { ...record, properties: filteredProps };
      })
    );

    if (records.length > 0) {
      results.push({ concept, records });
    }
  }

  return results;
}

// --- Helpers (mirrored from domains.ts for encapsulation) ---

interface DomainRecord {
  readonly id: string;
  readonly conceptKey: string;
  readonly properties: Record<string, unknown>;
  readonly relations: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function rowToDomainRecord(
  row: Record<string, unknown>,
  conceptKey: string
): DomainRecord {
  const props = (row.properties ?? {}) as Record<string, unknown>;
  const allProperties: Record<string, unknown> = { ...props };
  const metaKeys = new Set(["id", "properties", "created_at", "updated_at", "created_by", "archived"]);

  for (const [key, value] of Object.entries(row)) {
    if (!metaKeys.has(key) && value !== null) {
      allProperties[key] = value;
    }
  }

  return {
    id: row.id as string,
    conceptKey,
    properties: allProperties,
    relations: {},
    createdAt: (row.created_at as Date)?.toISOString() ?? new Date().toISOString(),
    updatedAt: (row.updated_at as Date)?.toISOString() ?? new Date().toISOString(),
  };
}

function separateProperties(
  payload: Readonly<Record<string, unknown>>,
  properties: ReadonlyArray<{ key: string; postgresColumn?: string }>
): { coreColumns: Record<string, unknown>; jsonbProperties: Record<string, unknown> } {
  const coreColumns: Record<string, unknown> = {};
  const jsonbProperties: Record<string, unknown> = {};

  const corePropertyKeys = new Set(
    properties.filter((p) => p.postgresColumn).map((p) => p.key)
  );
  const corePropToColumn = new Map(
    properties.filter((p) => p.postgresColumn).map((p) => [p.key, p.postgresColumn!])
  );

  const wellKnownCore = new Set(["name", "status", "type", "department", "email", "phone", "company", "role_key"]);

  for (const [key, value] of Object.entries(payload)) {
    if (corePropertyKeys.has(key)) {
      coreColumns[corePropToColumn.get(key)!] = value;
    } else if (wellKnownCore.has(key)) {
      coreColumns[key] = value;
    } else {
      jsonbProperties[key] = value;
    }
  }

  return { coreColumns, jsonbProperties };
}

function isSafeIdentifier(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(name);
}

function buildFilterClauses(
  filters: Record<string, unknown>,
  properties: ReadonlyArray<{ key: string; postgresColumn?: string }>
): { whereClauses: string; filterParams: unknown[] } {
  const clauses: string[] = [];
  const filterParams: unknown[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;

    const prop = properties.find((p) => p.key === key);
    if (!prop) continue;

    if (prop.postgresColumn && isSafeIdentifier(prop.postgresColumn)) {
      clauses.push(`AND ${prop.postgresColumn} = $${paramIdx}`);
    } else if (isSafeIdentifier(key)) {
      clauses.push(`AND properties->>'${key}' = $${paramIdx}`);
    } else {
      continue;
    }
    filterParams.push(String(value));
    paramIdx++;
  }

  return { whereClauses: clauses.join(" "), filterParams };
}

function clampInt(value: unknown, min: number, max: number, defaultVal: number): number {
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

// --- Exports for testing ---

export {
  conceptToTable,
  getSessionKey,
  getMutationCount,
  incrementMutationCount,
  mutationCounts,
  BULK_MUTATION_LIMIT,
  DESTRUCTIVE_TOOLS,
};
