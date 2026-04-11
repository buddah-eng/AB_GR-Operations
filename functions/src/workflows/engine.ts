/**
 * Workflow Engine
 *
 * Subscribes to the domain event bus at priority 500 and executes
 * matching workflows. Supports four trigger types: domain_event,
 * scheduled, manual, and field_changed. Actions execute sequentially
 * with error isolation — a failing action does not block subsequent ones.
 *
 * Token interpolation replaces {{recordId}}, {{triggeredBy}}, {{field}}
 * placeholders in action defaults with values from the triggering event.
 */

import * as logger from "firebase-functions/logger";
import { subscribe, emit, createDomainEvent, matchesPattern } from "../events/bus";
import { evaluateCondition } from "../conditions/evaluator";
import { query } from "../db/client";
import { createAuditContext, withAuditContext, logAuditClaim } from "../audit/context";
import { cache, TTL_DOMAIN_MS } from "../cache";
import type { DomainEvent } from "../events/types";
import type {
  WorkflowConfig,
  WorkflowAction,
  WorkflowTrigger,
  ConditionExpression,
} from "../ontology/types";

// --- Constants ---

const WORKFLOWS_CACHE_KEY = "workflows:active";
const FETCH_TIMEOUT_MS = 10_000;

// --- Injected fetch (for testing) ---

type FetchFn = typeof globalThis.fetch;

let _fetch: FetchFn = globalThis.fetch;

/**
 * Replace the fetch implementation. Primarily for testing.
 */
export function setFetch(fn: FetchFn): void {
  _fetch = fn;
}

/**
 * Reset fetch to the global implementation.
 */
export function resetFetch(): void {
  _fetch = globalThis.fetch;
}

// --- Load active workflows ---

/**
 * Loads all enabled workflows from Postgres with caching.
 */
export async function loadActiveWorkflows(): Promise<ReadonlyArray<WorkflowConfig>> {
  return cache.getOrLoad(
    WORKFLOWS_CACHE_KEY,
    async () => {
      const result = await query<{
        id: string;
        name: string;
        description: string | null;
        trigger: WorkflowTrigger;
        condition: ConditionExpression | null;
        actions: ReadonlyArray<WorkflowAction>;
        enabled: boolean;
      }>(
        `SELECT id, name, description, trigger, condition, actions, enabled
         FROM workflow_configs WHERE enabled = true AND status = 'active'`
      );

      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        trigger: row.trigger,
        condition: row.condition ?? undefined,
        actions: row.actions,
        enabled: row.enabled,
      }));
    },
    TTL_DOMAIN_MS
  );
}

// --- Token interpolation ---

/**
 * Replaces {{recordId}}, {{triggeredBy}}, {{field}}, and any other
 * event-derived tokens in string values within a defaults object.
 */
export function interpolateTokens(
  defaults: Readonly<Record<string, unknown>>,
  event: DomainEvent
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(defaults)) {
    if (typeof value === "string") {
      result[key] = value
        .replace(/\{\{recordId\}\}/g, event.recordId)
        .replace(/\{\{triggeredBy\}\}/g, event.triggeredBy)
        .replace(/\{\{field\}\}/g, event.changedFields?.[0] ?? "");
    } else {
      result[key] = value;
    }
  }

  return result;
}

// --- Trigger matching ---

/**
 * Determines whether a workflow trigger matches a given domain event.
 */
export function triggerMatchesEvent(
  trigger: WorkflowTrigger,
  event: DomainEvent
): boolean {
  switch (trigger.type) {
    case "domain_event":
      return trigger.event
        ? matchesPattern(trigger.event, event.eventName)
        : false;

    case "field_changed":
      if (!trigger.event || !matchesPattern(trigger.event, event.eventName)) {
        return false;
      }
      if (!trigger.field || !event.changedFields) {
        return false;
      }
      return event.changedFields.includes(trigger.field);

    case "scheduled":
    case "manual":
      // These triggers are not matched by domain events
      return false;

    default:
      return false;
  }
}

// --- Action execution ---

/**
 * Executes a single workflow action. Returns a result object
 * indicating success or failure. Errors are caught and returned
 * rather than thrown.
 */
async function executeAction(
  action: WorkflowAction,
  event: DomainEvent
): Promise<{ readonly success: boolean; readonly error?: string }> {
  try {
    const interpolatedDefaults = action.defaults
      ? interpolateTokens(action.defaults, event)
      : {};

    switch (action.type) {
      case "create_record":
        await executeCreateRecord(action, event, interpolatedDefaults);
        break;

      case "create_records":
        await executeCreateRecords(action, event, interpolatedDefaults);
        break;

      case "update_record":
        await executeUpdateRecord(action, event, interpolatedDefaults);
        break;

      case "delete_record":
        await executeDeleteRecord(event);
        break;

      case "notify":
        await executeNotify(action, event);
        break;

      case "sync_calendar":
        await executeSyncCalendar(event);
        break;

      case "generate_doc":
        await executeGenerateDoc(action, event);
        break;

      case "call_api":
        await executeCallApi(action, interpolatedDefaults);
        break;

      case "lookup_registry":
        await executeLookupRegistry(action, event);
        break;

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Workflow action failed", {
      actionType: action.type,
      eventName: event.eventName,
      error: errorMessage,
    });
    return { success: false, error: errorMessage };
  }
}

// --- Individual action implementations ---

async function executeCreateRecord(
  action: WorkflowAction,
  event: DomainEvent,
  interpolatedDefaults: Record<string, unknown>
): Promise<void> {
  const target = action.target ?? event.domain;
  const fields = { ...interpolatedDefaults };

  const auditCtx = createAuditContext("system", "system");

  const record = await withAuditContext(auditCtx, async (client) => {
    const result = await client.query(
      `INSERT INTO domain_records (concept_key, properties, created_by)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [target, JSON.stringify(fields), event.triggeredBy]
    );
    return result.rows[0] as { id: string };
  });

  await logAuditClaim(auditCtx, `workflow:create_record:${target}`);

  const newEvent = createDomainEvent({
    eventName: `${target}.created`,
    domain: target,
    action: "created",
    recordId: record.id,
    newValues: fields,
    triggeredBy: "system",
    changeSet: auditCtx.changeSet,
  });
  await emit(newEvent);
}

async function executeCreateRecords(
  action: WorkflowAction,
  event: DomainEvent,
  interpolatedDefaults: Record<string, unknown>
): Promise<void> {
  const target = action.target ?? event.domain;
  const templateName = action.template;

  if (!templateName) {
    throw new Error("create_records action requires a template");
  }

  const templateResult = await query<{
    id: string;
    content: { items?: ReadonlyArray<Record<string, unknown>> } & Record<string, unknown>;
  }>(
    `SELECT id, content FROM templates WHERE name = $1 AND template_type = 'record_set' AND status = 'active'`,
    [templateName]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`Template not found: ${templateName}`);
  }

  const auditCtx = createAuditContext("system", "system");

  for (const templateRow of templateResult.rows) {
    const recordDefaults = templateRow.content.items?.[0] ?? templateRow.content;
    const fields = {
      ...recordDefaults,
      ...interpolatedDefaults,
    };

    const record = await withAuditContext(auditCtx, async (client) => {
      const result = await client.query(
        `INSERT INTO domain_records (concept_key, properties, created_by)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [target, JSON.stringify(fields), event.triggeredBy]
      );
      return result.rows[0] as { id: string };
    });

    const newEvent = createDomainEvent({
      eventName: `${target}.created`,
      domain: target,
      action: "created",
      recordId: record.id,
      newValues: fields,
      triggeredBy: "system",
      changeSet: auditCtx.changeSet,
    });
    await emit(newEvent);
  }

  await logAuditClaim(auditCtx, `workflow:create_records:${target}`);
}

async function executeUpdateRecord(
  action: WorkflowAction,
  event: DomainEvent,
  interpolatedDefaults: Record<string, unknown>
): Promise<void> {
  const fields = { ...interpolatedDefaults };
  const auditCtx = createAuditContext("system", "system");

  await withAuditContext(auditCtx, async (client) => {
    await client.query(
      `UPDATE domain_records
       SET properties = properties || $1::jsonb, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(fields), event.recordId]
    );
  });

  await logAuditClaim(auditCtx, `workflow:update_record:${event.domain}`);

  const updateEvent = createDomainEvent({
    eventName: `${event.domain}.updated`,
    domain: event.domain,
    action: "updated",
    recordId: event.recordId,
    changedFields: Object.keys(fields),
    newValues: fields,
    triggeredBy: "system",
    changeSet: auditCtx.changeSet,
  });
  await emit(updateEvent);
}

async function executeDeleteRecord(event: DomainEvent): Promise<void> {
  const auditCtx = createAuditContext("system", "system");

  await withAuditContext(auditCtx, async (client) => {
    await client.query(
      `UPDATE domain_records
       SET archived = true, updated_at = now()
       WHERE id = $1`,
      [event.recordId]
    );
  });

  await logAuditClaim(auditCtx, `workflow:delete_record:${event.domain}`);

  const deleteEvent = createDomainEvent({
    eventName: `${event.domain}.deleted`,
    domain: event.domain,
    action: "deleted",
    recordId: event.recordId,
    triggeredBy: "system",
    changeSet: auditCtx.changeSet,
  });
  await emit(deleteEvent);
}

async function executeNotify(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const notifyEvent = createDomainEvent({
    eventName: "notification.requested",
    domain: "notification",
    action: "created",
    recordId: event.recordId,
    triggeredBy: "system",
    metadata: {
      recipients: action.recipients ?? [],
      templateName: action.templateName ?? action.template,
      sourceEvent: event.eventName,
      sourceRecordId: event.recordId,
    },
  });
  await emit(notifyEvent);
}

async function executeSyncCalendar(event: DomainEvent): Promise<void> {
  const calendarEvent = createDomainEvent({
    eventName: "calendar.sync_requested",
    domain: "calendar",
    action: "synced",
    recordId: event.recordId,
    triggeredBy: "system",
    metadata: {
      sourceEvent: event.eventName,
      sourceRecordId: event.recordId,
    },
  });
  await emit(calendarEvent);
}

async function executeGenerateDoc(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const docEvent = createDomainEvent({
    eventName: "document.generation_requested",
    domain: "document",
    action: "created",
    recordId: event.recordId,
    triggeredBy: "system",
    metadata: {
      templateName: action.templateName ?? action.template,
      sourceEvent: event.eventName,
      sourceRecordId: event.recordId,
    },
  });
  await emit(docEvent);
}

async function executeCallApi(
  action: WorkflowAction,
  interpolatedDefaults: Record<string, unknown>
): Promise<void> {
  const url = action.target;
  if (!url) {
    throw new Error("call_api action requires a target URL");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await _fetch(url, {
      method: (interpolatedDefaults.method as string) ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...(interpolatedDefaults.headers as Record<string, string> | undefined),
      },
      body: interpolatedDefaults.body
        ? JSON.stringify(interpolatedDefaults.body)
        : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.warn("call_api: non-OK response", {
        url,
        status: response.status,
      });
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function executeLookupRegistry(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const matchField = action.match ?? "email";
  const copyFields = action.copyFields ?? [];

  const matchValue = event.newValues?.[matchField];
  if (!matchValue) {
    logger.info("lookup_registry: no match value found", { matchField });
    return;
  }

  const registryResult = await query<Record<string, unknown>>(
    `SELECT * FROM guest_registry WHERE properties->>$1 = $2 LIMIT 1`,
    [matchField, String(matchValue)]
  );

  if (registryResult.rows.length === 0) {
    logger.info("lookup_registry: no registry match", {
      matchField,
      matchValue,
    });
    return;
  }

  const registryRow = registryResult.rows[0];
  const fieldsToCopy: Record<string, unknown> = {};

  for (const field of copyFields) {
    if (registryRow[field] !== undefined) {
      fieldsToCopy[field] = registryRow[field];
    }
  }

  if (Object.keys(fieldsToCopy).length === 0) {
    return;
  }

  const auditCtx = createAuditContext("system", "system");

  await withAuditContext(auditCtx, async (client) => {
    await client.query(
      `UPDATE domain_records
       SET properties = properties || $1::jsonb, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(fieldsToCopy), event.recordId]
    );
  });

  await logAuditClaim(auditCtx, `workflow:lookup_registry:${event.domain}`);
}

// --- Workflow execution ---

/**
 * Executes a workflow's action chain sequentially.
 * Error isolation: a failing action does not prevent subsequent actions.
 */
export async function executeWorkflow(
  workflow: WorkflowConfig,
  event: DomainEvent
): Promise<void> {
  // Check condition (absent condition = always execute)
  if (workflow.condition) {
    const context: Record<string, unknown> = {
      ...(event.newValues ?? {}),
      ...(event.previousValues ?? {}),
      recordId: event.recordId,
      domain: event.domain,
      triggeredBy: event.triggeredBy,
    };

    if (!evaluateCondition(workflow.condition, context)) {
      logger.info(`Workflow "${workflow.name}" condition not met, skipping`, {
        workflowId: workflow.id,
        eventName: event.eventName,
      });
      return;
    }
  }

  logger.info(`Executing workflow "${workflow.name}"`, {
    workflowId: workflow.id,
    eventName: event.eventName,
    actionCount: workflow.actions.length,
  });

  for (const action of workflow.actions) {
    const result = await executeAction(action, event);

    if (!result.success) {
      logger.warn(`Workflow "${workflow.name}" action "${action.type}" failed`, {
        workflowId: workflow.id,
        error: result.error,
      });
      // Error isolation: continue with next action
    }
  }
}

// --- Domain event handler ---

/**
 * Handles any domain event by loading active workflows, matching triggers,
 * and executing matched workflows.
 */
export async function handleDomainEvent(event: DomainEvent): Promise<void> {
  let workflows: ReadonlyArray<WorkflowConfig>;

  try {
    workflows = await loadActiveWorkflows();
  } catch (err) {
    logger.error("Failed to load workflows", { error: err });
    return;
  }

  const matchedWorkflows = workflows.filter((wf) =>
    triggerMatchesEvent(wf.trigger, event)
  );

  if (matchedWorkflows.length === 0) return;

  logger.info(`${matchedWorkflows.length} workflow(s) matched "${event.eventName}"`);

  for (const workflow of matchedWorkflows) {
    try {
      await executeWorkflow(workflow, event);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`Workflow "${workflow.name}" failed`, {
        workflowId: workflow.id,
        error: errorMessage,
      });
      // Error isolation: continue with next workflow
    }
  }
}

// --- Manual workflow execution ---

/**
 * Executes a workflow manually by ID.
 * Only workflows with trigger.type === "manual" can be triggered this way.
 */
export async function executeManualWorkflow(
  workflowId: string,
  context: Readonly<Record<string, unknown>>,
  triggeredBy: string
): Promise<{ readonly success: boolean; readonly error?: string }> {
  const workflows = await loadActiveWorkflows();
  const workflow = workflows.find((wf) => wf.id === workflowId);

  if (!workflow) {
    return { success: false, error: `Workflow not found: ${workflowId}` };
  }

  if (workflow.trigger.type !== "manual") {
    return {
      success: false,
      error: `Workflow "${workflow.name}" is not a manual workflow (trigger: ${workflow.trigger.type})`,
    };
  }

  const syntheticEvent: DomainEvent = {
    eventId: `manual-${Date.now()}`,
    eventName: "workflow.manual_trigger",
    domain: "workflow",
    action: "created",
    recordId: context.recordId as string ?? workflowId,
    triggeredBy,
    timestamp: new Date().toISOString(),
    newValues: context,
  };

  try {
    await executeWorkflow(workflow, syntheticEvent);
    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMessage };
  }
}

// --- Registration ---

/**
 * Registers the workflow engine on the domain event bus at priority 500.
 * Call once during app startup.
 *
 * @returns An unsubscribe function.
 */
export function registerWorkflowEngine(): () => void {
  return subscribe("*", handleDomainEvent, 500);
}
