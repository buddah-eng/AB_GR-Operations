/**
 * MCP Surface API Router
 *
 * HTTP API that MCP clients call. Auth delegation is handled by existing
 * middleware (X-MCP-Delegation header sets actorType='ai_agent').
 *
 * GET  /api/mcp/tools   - returns tool registry with MCP annotations
 * POST /api/mcp/execute  - executes a tool by name with parameters
 *
 * Every mutation flows through the same write pipeline as the REST API:
 * RBAC enforcement, withAuditContext, logAuditClaim, domain events.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { getOntology, getConceptByKey, getPropertiesForConcept } from "../ontology/loader";
import { roleEngine } from "../roles/engine";
import { emit, createDomainEvent } from "../events/bus";
import { requireAuth } from "../auth/middleware";
import { auditContextFromRequest, withAuditContext, logAuditClaim } from "../audit/context";
import { checkBulkLimit } from "./bulk-limit";
import {
  encryptPiiFields,
  decryptPiiFields,
  isEncryptionConfigured,
} from "../encryption/crypto";
import type { ApiResponse } from "../ontology/types";

// --- Types ---

interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
}

interface ToolParam {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
}

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  readonly params: ReadonlyArray<ToolParam>;
}

interface ExecuteBody {
  readonly tool: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly confirmBulk?: string;
  readonly mcpSession?: string;
}

// --- Tool Registry ---

const TOOL_REGISTRY: ReadonlyArray<ToolDefinition> = [
  {
    name: "get_ontology",
    description: "Returns the domain model: concepts, properties, relationships.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    params: [],
  },
  {
    name: "list_records",
    description: "List records for a concept with optional filters and pagination.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    params: [
      { name: "concept", required: true, description: "Concept key (e.g. 'guest', 'staff')" },
      { name: "filters", required: false, description: "Filter object: { field: value }" },
      { name: "page", required: false, description: "Page number (default 1)" },
      { name: "limit", required: false, description: "Records per page (default 50, max 200)" },
    ],
  },
  {
    name: "get_record",
    description: "Fetch a single record by concept and ID.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    params: [
      { name: "concept", required: true, description: "Concept key" },
      { name: "id", required: true, description: "Record ID (UUID)" },
    ],
  },
  {
    name: "create_record",
    description: "Create a new record for a concept.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    params: [
      { name: "concept", required: true, description: "Concept key" },
      { name: "data", required: true, description: "Record payload object" },
    ],
  },
  {
    name: "update_record",
    description: "Update an existing record. Only changed fields required.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    params: [
      { name: "concept", required: true, description: "Concept key" },
      { name: "id", required: true, description: "Record ID (UUID)" },
      { name: "data", required: true, description: "Changed fields object" },
    ],
  },
  {
    name: "run_workflow",
    description: "Trigger a named manual workflow.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    params: [
      { name: "workflowId", required: true, description: "Workflow name or ID" },
      { name: "context", required: false, description: "Workflow context data" },
    ],
  },
  {
    name: "my_assignments",
    description: "List all records across concepts assigned to the current user.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    params: [],
  },
];

const TOOL_MAP = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));

const DESTRUCTIVE_TOOLS = new Set(
  TOOL_REGISTRY.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)
);

// --- Concept-to-table mapping (shared with domains router) ---

function conceptToTable(conceptKey: string): string {
  const tableMap: Record<string, string> = {
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
  const table = tableMap[conceptKey];
  if (!table) {
    throw Object.assign(
      new Error(`No table mapping for concept "${conceptKey}"`),
      { status: 400 }
    );
  }
  return table;
}

function isSafeIdentifier(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(name);
}

// --- In-memory session mutation counters ---

const sessionMutationCounts = new Map<string, number>();

function getSessionKey(req: Request, body: ExecuteBody): string {
  return body.mcpSession ?? req.headers["x-mcp-session"] as string ?? req.user?.uid ?? "anonymous";
}

function trackMutation(sessionKey: string): number {
  const current = sessionMutationCounts.get(sessionKey) ?? 0;
  const next = current + 1;
  sessionMutationCounts.set(sessionKey, next);
  return next;
}

// --- Router ---

export const mcpRouter = Router();

mcpRouter.use(requireAuth);

// --- GET /tools ---

mcpRouter.get("/tools", (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: { tools: TOOL_REGISTRY },
  } as ApiResponse<{ tools: ReadonlyArray<ToolDefinition> }>);
});

// --- POST /execute ---

mcpRouter.post("/execute", async (req: Request, res: Response) => {
  try {
    const body = req.body as ExecuteBody;

    // Validate tool name
    if (!body.tool || typeof body.tool !== "string") {
      sendError(res, 400, 'Missing required field "tool".');
      return;
    }

    const toolDef = TOOL_MAP.get(body.tool);
    if (!toolDef) {
      sendError(res, 400, `Unknown tool: "${body.tool}".`);
      return;
    }

    // Validate required params
    const params = body.params ?? {};
    const missingParams = toolDef.params
      .filter((p) => p.required && !(p.name in params))
      .map((p) => p.name);

    if (missingParams.length > 0) {
      sendError(res, 400, `Missing required parameters: ${missingParams.join(", ")}`);
      return;
    }

    // Bulk limit check for destructive tools
    if (DESTRUCTIVE_TOOLS.has(body.tool)) {
      const sessionKey = getSessionKey(req, body);
      const mutationCount = trackMutation(sessionKey);

      if (mutationCount >= 5 && !body.confirmBulk) {
        const confirmation = checkBulkLimit(
          String(params.concept ?? "mcp"),
          body.tool,
          mutationCount,
          req.user?.uid ?? "anonymous"
        );
        if (confirmation) {
          res.status(202).json({
            success: false,
            error: "bulk_limit_exceeded",
            data: {
              message: `This session has performed ${mutationCount} mutations. Please confirm to proceed.`,
              confirmationToken: confirmation.token,
              recordCount: mutationCount,
            },
          });
          return;
        }
      }

      // If confirmBulk token provided, validate it
      if (body.confirmBulk) {
        try {
          checkBulkLimit(
            String(params.concept ?? "mcp"),
            body.tool,
            5, // above threshold
            req.user?.uid ?? "anonymous",
            body.confirmBulk
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendError(res, 400, message);
          return;
        }
      }
    }

    // Build MCP metadata for domain events
    const mcpSession = body.mcpSession ?? req.headers["x-mcp-session"] as string ?? undefined;
    const mcpMetadata: Record<string, unknown> = {
      mcp_tool: body.tool,
      ...(mcpSession ? { mcp_session: mcpSession } : {}),
    };

    // Dispatch to tool handler
    const result = await dispatchTool(body.tool, params, req, mcpMetadata);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    handleError(res, err, "executing MCP tool");
  }
});

// --- Tool Dispatch ---

async function dispatchTool(
  tool: string,
  params: Readonly<Record<string, unknown>>,
  req: Request,
  mcpMetadata: Record<string, unknown>
): Promise<unknown> {
  switch (tool) {
    case "get_ontology":
      return handleGetOntology();
    case "list_records":
      return handleListRecords(params, req);
    case "get_record":
      return handleGetRecord(params, req);
    case "create_record":
      return handleCreateRecord(params, req, mcpMetadata);
    case "update_record":
      return handleUpdateRecord(params, req, mcpMetadata);
    case "run_workflow":
      return handleRunWorkflow(params, req, mcpMetadata);
    case "my_assignments":
      return handleMyAssignments(req);
    default:
      throw Object.assign(new Error(`Unhandled tool: "${tool}"`), { status: 400 });
  }
}

// --- Tool Handlers ---

async function handleGetOntology(): Promise<unknown> {
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

async function handleListRecords(
  params: Readonly<Record<string, unknown>>,
  req: Request
): Promise<unknown> {
  const conceptKey = String(params.concept);
  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    throw Object.assign(new Error(`Unknown concept: "${conceptKey}"`), { status: 400 });
  }

  const roleKey = req.role?.roleKey ?? "viewer";
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

  // Build filter clauses
  const filters = (params.filters ?? {}) as Record<string, unknown>;
  const properties = await getPropertiesForConcept(conceptKey);
  const { whereClause, filterParams } = buildFilterClause(filters, properties);

  // Data scope
  const dataScopeFilter = await roleEngine.buildDataScopeFilter(roleKey, conceptKey, req.user?.uid ?? "");
  let dataScopeClause = "";
  const dataScopeParams: unknown[] = [];
  if (dataScopeFilter && isSafeIdentifier(dataScopeFilter.column)) {
    const paramIndex = filterParams.length + 1;
    dataScopeClause = ` AND ${dataScopeFilter.column} ${dataScopeFilter.operator} $${paramIndex}`;
    dataScopeParams.push(dataScopeFilter.value);
  }

  const combinedParams = [...filterParams, ...dataScopeParams];

  const countResult = await query(
    `SELECT COUNT(*) FROM ${table} WHERE NOT archived${whereClause}${dataScopeClause}`,
    combinedParams
  );
  const total = parseInt(countResult.rows[0].count as string, 10);

  const dataResult = await query(
    `SELECT * FROM ${table} WHERE NOT archived${whereClause}${dataScopeClause} ORDER BY created_at DESC LIMIT $${combinedParams.length + 1} OFFSET $${combinedParams.length + 2}`,
    [...combinedParams, limit, offset]
  );

  const records = await Promise.all(
    dataResult.rows.map(async (row) => {
      const record = rowToRecord(row, conceptKey);
      const filteredProps = await roleEngine.filterRecord(roleKey, conceptKey, record.properties);
      return { ...record, properties: filteredProps };
    })
  );

  return { records, meta: { total, page, limit, hasMore: offset + limit < total } };
}

async function handleGetRecord(
  params: Readonly<Record<string, unknown>>,
  req: Request
): Promise<unknown> {
  const conceptKey = String(params.concept);
  const id = String(params.id);

  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    throw Object.assign(new Error(`Unknown concept: "${conceptKey}"`), { status: 400 });
  }

  const roleKey = req.role?.roleKey ?? "viewer";
  const canView = await roleEngine.canPerformAction(roleKey, conceptKey, "view");
  if (!canView) {
    throw Object.assign(new Error("You do not have permission to view this record."), { status: 403 });
  }

  const table = conceptToTable(conceptKey);
  const result = await query(`SELECT * FROM ${table} WHERE id = $1 AND NOT archived`, [id]);

  if (result.rows.length === 0) {
    throw Object.assign(new Error("Record not found."), { status: 404 });
  }

  const record = rowToRecord(result.rows[0], conceptKey);
  const filteredProps = await roleEngine.filterRecord(roleKey, conceptKey, record.properties);
  return { ...record, properties: filteredProps };
}

async function handleCreateRecord(
  params: Readonly<Record<string, unknown>>,
  req: Request,
  mcpMetadata: Record<string, unknown>
): Promise<unknown> {
  const conceptKey = String(params.concept);
  const data = params.data as Record<string, unknown>;

  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    throw Object.assign(new Error(`Unknown concept: "${conceptKey}"`), { status: 400 });
  }

  const roleKey = req.role?.roleKey ?? "viewer";
  const canCreate = await roleEngine.canPerformAction(roleKey, conceptKey, "create");
  if (!canCreate) {
    throw Object.assign(
      new Error(`You do not have permission to create ${concept.pluralName}.`),
      { status: 403 }
    );
  }

  const filteredPayload = await roleEngine.filterWritePayload(roleKey, conceptKey, data);
  const properties = await getPropertiesForConcept(conceptKey);
  const table = conceptToTable(conceptKey);

  // Encrypt PII fields before DB write if encryption is configured
  const securedPayload = isEncryptionConfigured()
    ? encryptPiiFields(filteredPayload)
    : filteredPayload;

  const { coreColumns, jsonbProperties } = separateProperties(securedPayload, properties);
  coreColumns.created_by = req.user?.uid ?? null;

  const auditCtx = auditContextFromRequest(req);
  const row = await withAuditContext(auditCtx, async (client) => {
    const cols = Object.keys(coreColumns).filter(isSafeIdentifier);
    const vals = cols.map((c) => coreColumns[c]);
    cols.push("properties");
    vals.push(JSON.stringify(jsonbProperties));
    const placeholders = vals.map((_, i) => `$${i + 1}`);
    const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
    const result = await client.query(sql, vals);
    return result.rows[0];
  });

  const record = rowToRecord(row, conceptKey);

  // Decrypt PII fields after filterRecord for response
  const filteredProps = await roleEngine.filterRecord(roleKey, conceptKey, record.properties);
  const decryptedProps = isEncryptionConfigured()
    ? decryptPiiFields(filteredProps, { recordId: record.id, actorId: req.user?.uid ?? "anonymous" })
    : filteredProps;

  logAuditClaim(auditCtx, `POST /api/mcp/execute (create_record:${conceptKey})`);

  const event = createDomainEvent({
    eventName: `${conceptKey}.created`,
    domain: conceptKey,
    action: "created",
    recordId: record.id,
    newValues: filteredPayload,
    triggeredBy: req.user?.email ?? "system",
    changeSet: auditCtx.changeSet,
    metadata: mcpMetadata,
  });
  await emit(event);

  return { ...record, properties: decryptedProps };
}

async function handleUpdateRecord(
  params: Readonly<Record<string, unknown>>,
  req: Request,
  mcpMetadata: Record<string, unknown>
): Promise<unknown> {
  const conceptKey = String(params.concept);
  const id = String(params.id);
  const data = params.data as Record<string, unknown>;

  const concept = await getConceptByKey(conceptKey);
  if (!concept) {
    throw Object.assign(new Error(`Unknown concept: "${conceptKey}"`), { status: 400 });
  }

  const roleKey = req.role?.roleKey ?? "viewer";
  const canEdit = await roleEngine.canPerformAction(roleKey, conceptKey, "edit");
  if (!canEdit) {
    throw Object.assign(new Error("You do not have permission to edit this record."), { status: 403 });
  }

  const filteredPayload = await roleEngine.filterWritePayload(roleKey, conceptKey, data);
  const properties = await getPropertiesForConcept(conceptKey);
  const table = conceptToTable(conceptKey);

  // Encrypt PII fields before DB write if encryption is configured
  const securedPayload = isEncryptionConfigured()
    ? encryptPiiFields(filteredPayload)
    : filteredPayload;

  const { coreColumns, jsonbProperties } = separateProperties(securedPayload, properties);

  const auditCtx = auditContextFromRequest(req);
  const row = await withAuditContext(auditCtx, async (client) => {
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

    const sql = `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${paramIdx} AND NOT archived RETURNING *`;
    const result = await client.query(sql, updateParams);
    if (result.rows.length === 0) {
      throw Object.assign(new Error("Record not found"), { status: 404 });
    }
    return result.rows[0];
  });

  const record = rowToRecord(row, conceptKey);

  // Decrypt PII fields after filterRecord for response
  const filteredProps = await roleEngine.filterRecord(roleKey, conceptKey, record.properties);
  const decryptedProps = isEncryptionConfigured()
    ? decryptPiiFields(filteredProps, { recordId: record.id, actorId: req.user?.uid ?? "anonymous" })
    : filteredProps;

  logAuditClaim(auditCtx, `POST /api/mcp/execute (update_record:${conceptKey}/${id})`);

  const event = createDomainEvent({
    eventName: `${conceptKey}.updated`,
    domain: conceptKey,
    action: "updated",
    recordId: id,
    changedFields: Object.keys(filteredPayload),
    newValues: filteredPayload,
    triggeredBy: req.user?.email ?? "system",
    changeSet: auditCtx.changeSet,
    metadata: mcpMetadata,
  });
  await emit(event);

  return { ...record, properties: decryptedProps };
}

async function handleRunWorkflow(
  params: Readonly<Record<string, unknown>>,
  req: Request,
  mcpMetadata: Record<string, unknown>
): Promise<unknown> {
  const workflowId = String(params.workflowId);
  const context = (params.context ?? {}) as Record<string, unknown>;

  // Query for the workflow definition
  const result = await query(
    "SELECT * FROM workflow_configs WHERE (id = $1 OR name = $1) AND enabled = true",
    [workflowId]
  );

  if (result.rows.length === 0) {
    throw Object.assign(
      new Error(`Workflow "${workflowId}" not found or not enabled.`),
      { status: 404 }
    );
  }

  const workflow = result.rows[0];

  const auditCtx = auditContextFromRequest(req);
  logAuditClaim(auditCtx, `POST /api/mcp/execute (run_workflow:${workflowId})`);

  const event = createDomainEvent({
    eventName: `workflow.${workflowId}.triggered`,
    domain: "workflow",
    action: "created",
    recordId: workflow.id as string,
    newValues: context,
    triggeredBy: req.user?.email ?? "system",
    changeSet: auditCtx.changeSet,
    metadata: mcpMetadata,
  });
  await emit(event);

  return {
    workflowId: workflow.id,
    name: workflow.name,
    status: "triggered",
  };
}

async function handleMyAssignments(req: Request): Promise<unknown> {
  const userId = req.user?.uid ?? "";
  const roleKey = req.role?.roleKey ?? "viewer";

  // Query across assignment-bearing tables for the current user
  const assignmentQueries = [
    {
      concept: "guest",
      table: "guests",
      sql: "SELECT * FROM guests WHERE NOT archived AND (created_by = $1 OR properties->>'assigned_to' = $1)",
    },
    {
      concept: "prep_item",
      table: "prep_items",
      sql: "SELECT * FROM prep_items WHERE NOT archived AND (created_by = $1 OR properties->>'assigned_to' = $1)",
    },
    {
      concept: "shift_assignment",
      table: "shift_assignments",
      sql: "SELECT * FROM shift_assignments WHERE NOT archived AND (created_by = $1 OR properties->>'assigned_to' = $1)",
    },
  ];

  const assignments: Array<{ concept: string; records: unknown[] }> = [];

  for (const q of assignmentQueries) {
    try {
      const canView = await roleEngine.canPerformAction(roleKey, q.concept, "view");
      if (!canView) continue;

      const result = await query(q.sql, [userId]);
      if (result.rows.length > 0) {
        const records = await Promise.all(
          result.rows.map(async (row) => {
            const record = rowToRecord(row, q.concept);
            const filteredProps = await roleEngine.filterRecord(roleKey, q.concept, record.properties);
            return { ...record, properties: filteredProps };
          })
        );
        assignments.push({ concept: q.concept, records });
      }
    } catch {
      // Skip concepts that don't exist yet
      logger.debug(`my_assignments: skipping ${q.concept}`);
    }
  }

  return { assignments };
}

// --- Helpers ---

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

function buildFilterClause(
  filters: Record<string, unknown>,
  properties: ReadonlyArray<{ key: string; postgresColumn?: string }>
): { whereClause: string; filterParams: unknown[] } {
  const clauses: string[] = [];
  const filterParams: unknown[] = [];
  let paramIdx = 1;

  for (const [fieldKey, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    const prop = properties.find((p) => p.key === fieldKey);
    if (!prop) continue;

    if (prop.postgresColumn && isSafeIdentifier(prop.postgresColumn)) {
      clauses.push(` AND ${prop.postgresColumn} = $${paramIdx}`);
    } else if (isSafeIdentifier(fieldKey)) {
      clauses.push(` AND properties->>'${fieldKey}' = $${paramIdx}`);
    } else {
      continue;
    }
    filterParams.push(String(value));
    paramIdx++;
  }

  return { whereClause: clauses.join(""), filterParams };
}

function rowToRecord(
  row: Record<string, unknown>,
  conceptKey: string
): { id: string; conceptKey: string; properties: Record<string, unknown>; createdAt: string; updatedAt: string } {
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
    createdAt: (row.created_at as Date)?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: (row.updated_at as Date)?.toISOString?.() ?? new Date().toISOString(),
  };
}

function clampInt(value: unknown, min: number, max: number, defaultVal: number): number {
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message } as ApiResponse<never>);
}

function handleError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  logger.error(`Error ${context}`, { error: message });
  sendError(res, status ?? 500, `Internal error while ${context}: ${message}`);
}

// Exported for testing
export {
  TOOL_REGISTRY,
  TOOL_MAP,
  DESTRUCTIVE_TOOLS,
  sessionMutationCounts,
};
