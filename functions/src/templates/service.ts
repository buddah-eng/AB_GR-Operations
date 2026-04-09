/**
 * Template Service
 *
 * CRUD, versioning, validation, application, and import/export for the
 * unified `templates` table. Follows the ontology versioning pattern:
 * updates create a new version row and deprecate the old one.
 *
 * Template types:
 *   record_set   — batch-create records in a target concept
 *   form_preset  — set FormConfig for a concept
 *   view_preset  — set ViewConfig for a concept
 *   workflow     — create WorkflowConfig
 *   notification — return content for caller to use
 *   document     — return content for caller to use
 */

import { query, withTransaction } from "../db/client";
import { withAuditContext } from "../audit/context";
import type { AuditContext } from "../audit/context";
import type { PoolClient } from "pg";

// --- Constants ---

export const TEMPLATE_TYPES = [
  "record_set",
  "form_preset",
  "view_preset",
  "workflow",
  "notification",
  "document",
] as const;

export type TemplateType = (typeof TEMPLATE_TYPES)[number];

const TEMPLATE_TYPE_SET = new Set<string>(TEMPLATE_TYPES);

export const EXPORT_FORMAT_VERSION = "gr-ops-template-v1";

// --- Types ---

export interface Template {
  readonly id: string;
  readonly template_type: TemplateType;
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly content: Record<string, unknown>;
  readonly concept_key: string | null;
  readonly version: number;
  readonly status: string;
  readonly owner_scope: string;
  readonly owner_department: string | null;
  readonly changed_by: string | null;
  readonly changed_at: string;
  readonly change_reason: string | null;
  readonly previous_version_id: string | null;
}

export interface TemplateFilters {
  readonly type?: string;
  readonly concept?: string;
  readonly category?: string;
}

export interface CreateTemplateData {
  readonly template_type: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly content: Record<string, unknown>;
  readonly concept_key?: string;
  readonly owner_scope?: string;
  readonly owner_department?: string;
  readonly changed_by?: string;
}

export interface UpdateTemplateData {
  readonly name?: string;
  readonly description?: string;
  readonly category?: string;
  readonly content?: Record<string, unknown>;
  readonly concept_key?: string;
}

export interface TemplateExport {
  readonly format: string;
  readonly exported_at: string;
  readonly templates: ReadonlyArray<Template>;
}

export interface ApplyResult {
  readonly applied: boolean;
  readonly template_type: TemplateType;
  readonly detail: string;
  readonly records_created?: number;
  readonly config_id?: string;
  readonly content?: Record<string, unknown>;
}

export interface ServiceResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

// --- Content schema definitions (per template type) ---

const REQUIRED_CONTENT_FIELDS: Readonly<Record<TemplateType, ReadonlyArray<string>>> = {
  record_set: ["records"],
  form_preset: ["fields"],
  view_preset: ["columns"],
  workflow: ["steps"],
  notification: ["subject", "body"],
  document: ["title", "body"],
};

// --- Public API ---

/**
 * List templates with optional filters. Only returns active templates.
 */
export async function listTemplates(
  filters?: TemplateFilters
): Promise<ServiceResult<ReadonlyArray<Template>>> {
  const conditions: string[] = ["status = 'active'"];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.type) {
    conditions.push(`template_type = $${paramIndex++}`);
    params.push(filters.type);
  }
  if (filters?.concept) {
    conditions.push(`concept_key = $${paramIndex++}`);
    params.push(filters.concept);
  }
  if (filters?.category) {
    conditions.push(`category = $${paramIndex++}`);
    params.push(filters.category);
  }

  const whereClause = conditions.join(" AND ");
  const result = await query(
    `SELECT * FROM templates WHERE ${whereClause} ORDER BY name ASC`,
    params
  );

  return { success: true, data: result.rows as unknown as Template[] };
}

/**
 * Get a single template by ID.
 */
export async function getTemplateById(
  id: string
): Promise<ServiceResult<Template | null>> {
  const result = await query("SELECT * FROM templates WHERE id = $1", [id]);

  return {
    success: true,
    data: (result.rows[0] as unknown as Template) ?? null,
  };
}

/**
 * Create a new template. Validates content against type schema.
 */
export async function createTemplate(
  data: CreateTemplateData,
  auditContext?: AuditContext
): Promise<ServiceResult<Template>> {
  const validation = validateTemplateContent(
    data.template_type,
    data.content
  );
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  const insertFn = async (client: PoolClient): Promise<ServiceResult<Template>> => {
    const result = await client.query(
      `INSERT INTO templates (
         template_type, name, description, category, content, concept_key,
         version, status, owner_scope, owner_department, changed_by, changed_at, change_reason
       ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', $7, $8, $9, now(), 'Initial creation')
       RETURNING *`,
      [
        data.template_type,
        data.name,
        data.description ?? null,
        data.category ?? null,
        JSON.stringify(data.content),
        data.concept_key ?? null,
        data.owner_scope ?? "org",
        data.owner_department ?? null,
        data.changed_by ?? null,
      ]
    );

    return { success: true, data: result.rows[0] as Template };
  };

  if (auditContext) {
    return withAuditContext(auditContext, insertFn);
  }
  return withTransaction(insertFn);
}

/**
 * Update a template by creating a new version. Deprecates the old version.
 */
export async function updateTemplate(
  id: string,
  updates: UpdateTemplateData,
  changedBy: string,
  reason: string,
  auditContext?: AuditContext
): Promise<ServiceResult<Template>> {
  const updateFn = async (client: PoolClient): Promise<ServiceResult<Template>> => {
    // 1. Read current active row (FOR UPDATE)
    const currentResult = await client.query(
      "SELECT * FROM templates WHERE id = $1 AND status = 'active' FOR UPDATE",
      [id]
    );

    if (currentResult.rows.length === 0) {
      return {
        success: false,
        error: `No active template found with id "${id}"`,
      };
    }

    const oldRow = currentResult.rows[0] as Template;

    // Validate content if being updated
    const newContent = updates.content ?? oldRow.content;
    const newType = oldRow.template_type;
    const validation = validateTemplateContent(newType, newContent);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    // 2. INSERT new version
    const newVersion = oldRow.version + 1;
    const insertResult = await client.query(
      `INSERT INTO templates (
         template_type, name, description, category, content, concept_key,
         version, status, owner_scope, owner_department,
         changed_by, changed_at, change_reason, previous_version_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, now(), $11, $12)
       RETURNING *`,
      [
        oldRow.template_type,
        updates.name ?? oldRow.name,
        updates.description !== undefined ? updates.description : oldRow.description,
        updates.category !== undefined ? updates.category : oldRow.category,
        JSON.stringify(newContent),
        updates.concept_key !== undefined ? updates.concept_key : oldRow.concept_key,
        newVersion,
        oldRow.owner_scope,
        oldRow.owner_department,
        changedBy,
        reason,
        oldRow.id,
      ]
    );

    // 3. Deprecate old row
    await client.query(
      "UPDATE templates SET status = 'deprecated' WHERE id = $1",
      [oldRow.id]
    );

    return { success: true, data: insertResult.rows[0] as Template };
  };

  if (auditContext) {
    return withAuditContext(auditContext, updateFn);
  }
  return withTransaction(updateFn);
}

/**
 * Soft-delete a template by deprecating it.
 * When an audit context is provided, wraps the query in withAuditContext.
 */
export async function deleteTemplate(
  id: string,
  auditContext?: AuditContext
): Promise<ServiceResult<Template>> {
  if (auditContext) {
    return withAuditContext(auditContext, async (client) => {
      const result = await client.query(
        `UPDATE templates SET status = 'deprecated' WHERE id = $1 AND status = 'active' RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        return {
          success: false,
          error: `No active template found with id "${id}"`,
        };
      }

      return { success: true, data: result.rows[0] as unknown as Template };
    });
  }

  const result = await query(
    `UPDATE templates SET status = 'deprecated' WHERE id = $1 AND status = 'active' RETURNING *`,
    [id]
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      error: `No active template found with id "${id}"`,
    };
  }

  return { success: true, data: result.rows[0] as unknown as Template };
}

/**
 * Retrieve the full version history of a template.
 * Walks the previous_version_id chain using a recursive CTE.
 */
export async function getTemplateHistory(
  id: string
): Promise<ServiceResult<ReadonlyArray<Template>>> {
  const result = await query(
    `WITH RECURSIVE history AS (
       SELECT * FROM templates WHERE id = $1
       UNION ALL
       SELECT t.* FROM templates t
       JOIN history h ON h.previous_version_id = t.id
     )
     SELECT * FROM history ORDER BY version DESC`,
    [id]
  );

  return { success: true, data: result.rows as unknown as Template[] };
}

/**
 * Apply a template based on its type.
 *
 * - record_set:   batch-create records in target concept
 * - form_preset:  set FormConfig for concept
 * - view_preset:  set ViewConfig for concept
 * - workflow:     create WorkflowConfig
 * - notification: return content for caller
 * - document:     return content for caller
 */
export async function applyTemplate(
  id: string,
  context: Record<string, unknown>,
  auditContext?: AuditContext
): Promise<ServiceResult<ApplyResult>> {
  const templateResult = await getTemplateById(id);
  if (!templateResult.success || !templateResult.data) {
    return {
      success: false,
      error: templateResult.error ?? `Template "${id}" not found`,
    };
  }

  const template = templateResult.data;

  if (template.status !== "active") {
    return {
      success: false,
      error: `Template "${id}" is not active (status: ${template.status})`,
    };
  }

  const conceptKey = (context.concept_key as string) ?? template.concept_key;

  switch (template.template_type) {
    case "record_set":
      return applyRecordSet(template, conceptKey, context);
    case "form_preset":
      return applyFormPreset(template, conceptKey, auditContext);
    case "view_preset":
      return applyViewPreset(template, conceptKey, auditContext);
    case "workflow":
      return applyWorkflow(template, auditContext);
    case "notification":
    case "document":
      return {
        success: true,
        data: {
          applied: true,
          template_type: template.template_type,
          detail: `${template.template_type} content returned for caller`,
          content: template.content,
        },
      };
    default:
      return {
        success: false,
        error: `Unknown template type: ${template.template_type}`,
      };
  }
}

/**
 * Validate template content against its type schema.
 */
export function validateTemplateContent(
  templateType: string,
  content: Record<string, unknown>
): { valid: boolean; reason?: string } {
  if (!TEMPLATE_TYPE_SET.has(templateType)) {
    return {
      valid: false,
      reason: `Invalid template type "${templateType}". Allowed: ${TEMPLATE_TYPES.join(", ")}`,
    };
  }

  const requiredFields = REQUIRED_CONTENT_FIELDS[templateType as TemplateType];

  for (const field of requiredFields) {
    if (!(field in content)) {
      return {
        valid: false,
        reason: `Missing required content field "${field}" for template type "${templateType}"`,
      };
    }
  }

  return { valid: true };
}

/**
 * Export templates matching the given filters as a JSON export object.
 */
export async function exportTemplates(
  filters?: TemplateFilters
): Promise<ServiceResult<TemplateExport>> {
  const listResult = await listTemplates(filters);
  if (!listResult.success || !listResult.data) {
    return { success: false, error: listResult.error };
  }

  return {
    success: true,
    data: {
      format: EXPORT_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      templates: listResult.data,
    },
  };
}

/**
 * Import templates from a JSON export. Creates new entries (no overwrite).
 * Returns the list of newly created templates.
 */
export async function importTemplates(
  data: TemplateExport
): Promise<ServiceResult<ReadonlyArray<Template>>> {
  if (data.format !== EXPORT_FORMAT_VERSION) {
    return {
      success: false,
      error: `Unsupported import format "${data.format}". Expected "${EXPORT_FORMAT_VERSION}"`,
    };
  }

  if (!Array.isArray(data.templates) || data.templates.length === 0) {
    return { success: false, error: "Import data contains no templates" };
  }

  const created: Template[] = [];

  for (const tpl of data.templates) {
    const result = await createTemplate({
      template_type: tpl.template_type,
      name: tpl.name,
      description: tpl.description ?? undefined,
      category: tpl.category ?? undefined,
      content: tpl.content,
      concept_key: tpl.concept_key ?? undefined,
      owner_scope: tpl.owner_scope,
      owner_department: tpl.owner_department ?? undefined,
    });

    if (result.success && result.data) {
      created.push(result.data);
    }
  }

  return { success: true, data: created };
}

// --- Private helpers for applyTemplate ---

async function applyRecordSet(
  template: Template,
  conceptKey: string | null,
  context: Record<string, unknown>
): Promise<ServiceResult<ApplyResult>> {
  if (!conceptKey) {
    return { success: false, error: "record_set template requires a concept_key" };
  }

  const records = template.content.records as ReadonlyArray<Record<string, unknown>> | undefined;
  if (!records || records.length === 0) {
    return { success: false, error: "record_set template has no records to create" };
  }

  const tableName = context.table_name as string | undefined;
  if (!tableName) {
    return { success: false, error: "record_set application requires context.table_name" };
  }

  let recordsCreated = 0;

  await withTransaction(async (client: PoolClient) => {
    for (const record of records) {
      const columns = Object.keys(record);
      const values = Object.values(record);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      await client.query(
        `INSERT INTO domain_records (concept_key, data) VALUES ($1, $2)`,
        [conceptKey, JSON.stringify(record)]
      );
      void columns;
      void placeholders;
      recordsCreated++;
    }
  });

  return {
    success: true,
    data: {
      applied: true,
      template_type: "record_set",
      detail: `Created ${recordsCreated} records for concept "${conceptKey}"`,
      records_created: recordsCreated,
    },
  };
}

async function applyFormPreset(
  template: Template,
  conceptKey: string | null,
  auditContext?: AuditContext
): Promise<ServiceResult<ApplyResult>> {
  if (!conceptKey) {
    return { success: false, error: "form_preset template requires a concept_key" };
  }

  const params = [
    conceptKey,
    `form_${conceptKey}_${Date.now()}`,
    JSON.stringify(template.content),
    `Applied from template "${template.name}"`,
  ];
  const sql = `INSERT INTO form_configs (concept_key, key, config, version, status, changed_by, changed_at, change_reason)
     VALUES ($1, $2, $3, 1, 'active', 'template_system', now(), $4)
     RETURNING id`;

  const result = auditContext
    ? await withAuditContext(auditContext, async (client) => client.query(sql, params))
    : await query(sql, params);

  return {
    success: true,
    data: {
      applied: true,
      template_type: "form_preset",
      detail: `FormConfig set for concept "${conceptKey}"`,
      config_id: result.rows[0]?.id as string,
    },
  };
}

async function applyViewPreset(
  template: Template,
  conceptKey: string | null,
  auditContext?: AuditContext
): Promise<ServiceResult<ApplyResult>> {
  if (!conceptKey) {
    return { success: false, error: "view_preset template requires a concept_key" };
  }

  const params = [
    conceptKey,
    `view_${conceptKey}_${Date.now()}`,
    JSON.stringify(template.content),
    `Applied from template "${template.name}"`,
  ];
  const sql = `INSERT INTO view_configs (concept_key, key, config, version, status, changed_by, changed_at, change_reason)
     VALUES ($1, $2, $3, 1, 'active', 'template_system', now(), $4)
     RETURNING id`;

  const result = auditContext
    ? await withAuditContext(auditContext, async (client) => client.query(sql, params))
    : await query(sql, params);

  return {
    success: true,
    data: {
      applied: true,
      template_type: "view_preset",
      detail: `ViewConfig set for concept "${conceptKey}"`,
      config_id: result.rows[0]?.id as string,
    },
  };
}

async function applyWorkflow(
  template: Template,
  auditContext?: AuditContext
): Promise<ServiceResult<ApplyResult>> {
  const params = [
    `wf_${template.name.replace(/\s+/g, "_").toLowerCase()}_${Date.now()}`,
    JSON.stringify(template.content),
    `Applied from template "${template.name}"`,
  ];
  const sql = `INSERT INTO workflow_configs (key, config, version, status, changed_by, changed_at, change_reason)
     VALUES ($1, $2, 1, 'active', 'template_system', now(), $3)
     RETURNING id`;

  const result = auditContext
    ? await withAuditContext(auditContext, async (client) => client.query(sql, params))
    : await query(sql, params);

  return {
    success: true,
    data: {
      applied: true,
      template_type: "workflow",
      detail: `WorkflowConfig created from template "${template.name}"`,
      config_id: result.rows[0]?.id as string,
    },
  };
}
