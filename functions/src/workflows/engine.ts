/**
 * Workflow Engine
 *
 * Evaluates workflow configs against domain events, checks conditions,
 * and executes action chains sequentially within Postgres transactions.
 *
 * Trigger types: domain_event, scheduled, manual, field_changed.
 * Conditions: evaluated via ConditionExpression engine.
 * Actions: executed sequentially with token interpolation.
 */

import * as logger from "firebase-functions/logger";
import { query } from "../db/client";
import { subscribe, emit, createDomainEvent } from "../events/bus";
import { evaluateCondition } from "../conditions/evaluator";
import type { DomainEvent } from "../events/types";
import type { WorkflowConfig, WorkflowAction } from "../ontology/types";
import { cache, TTL_ONTOLOGY_MS } from "../cache";

const WORKFLOWS_CACHE_KEY = "workflows:all";

// --- Workflow loading ---

async function loadWorkflows(): Promise<ReadonlyArray<WorkflowConfig>> {
  return cache.getOrLoad(
    WORKFLOWS_CACHE_KEY,
    async () => {
      const result = await query(
        "SELECT * FROM workflow_configs WHERE status = 'active' AND enabled = true"
      );
      return result.rows.map(parseWorkflowConfig);
    },
    TTL_ONTOLOGY_MS
  );
}

function parseWorkflowConfig(row: Record<string, unknown>): WorkflowConfig {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "unnamed",
    description: (row.description as string) ?? undefined,
    trigger: row.trigger as WorkflowConfig["trigger"],
    condition: row.condition as WorkflowConfig["condition"],
    actions: (row.actions as WorkflowAction[]) ?? [],
    enabled: row.enabled === true,
  };
}

// --- Workflow registration on event bus ---

export function registerWorkflowEngine(): void {
  subscribe("*", handleDomainEvent, 500);
  logger.info("Workflow engine registered on event bus (priority 500)");
}

async function handleDomainEvent(event: DomainEvent): Promise<void> {
  const workflows = await loadWorkflows();

  const matching = workflows.filter((wf) => {
    if (!wf.trigger) return false;

    switch (wf.trigger.type) {
      case "domain_event":
        return wf.trigger.event === event.eventName || matchesGlob(wf.trigger.event ?? "", event.eventName);

      case "field_changed":
        return (
          event.action === "updated" &&
          event.changedFields?.includes(wf.trigger.field ?? "") === true
        );

      default:
        return false;
    }
  });

  for (const workflow of matching) {
    try {
      await executeWorkflow(workflow, event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Workflow "${workflow.name}" failed`, { error: message, eventId: event.eventId });
    }
  }
}

function matchesGlob(pattern: string, eventName: string): boolean {
  if (pattern === "*") return true;
  const patternParts = pattern.split(".");
  const eventParts = eventName.split(".");
  if (patternParts.length !== eventParts.length) return false;
  return patternParts.every((p, i) => p === "*" || p === eventParts[i]);
}

// --- Workflow execution ---

async function executeWorkflow(
  workflow: WorkflowConfig,
  event: DomainEvent
): Promise<void> {
  // Check condition
  if (workflow.condition) {
    const context = buildConditionContext(event);
    if (!evaluateCondition(workflow.condition, context)) {
      logger.debug(`Workflow "${workflow.name}" condition not met, skipping`);
      return;
    }
  }

  logger.info(`Executing workflow "${workflow.name}"`, {
    eventId: event.eventId,
    actionCount: workflow.actions.length,
  });

  // Execute actions sequentially
  const results: Array<{ action: string; success: boolean; error?: string }> = [];

  for (const action of workflow.actions) {
    try {
      await executeAction(action, event);
      results.push({ action: action.type, success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ action: action.type, success: false, error: message });
      logger.error(`Workflow action "${action.type}" failed in "${workflow.name}"`, { error: message });
      // Continue executing remaining actions (error isolation)
    }
  }

  logger.info(`Workflow "${workflow.name}" completed`, {
    results: results.map((r) => `${r.action}:${r.success ? "ok" : "fail"}`).join(", "),
  });
}

function buildConditionContext(event: DomainEvent): Record<string, unknown> {
  return {
    domain: event.domain,
    action: event.action,
    recordId: event.recordId,
    triggeredBy: event.triggeredBy,
    ...event.newValues,
    _previousValues: event.previousValues,
    _changedFields: event.changedFields,
  };
}

// --- Action execution ---

async function executeAction(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  switch (action.type) {
    case "create_record":
      await executeCreateRecord(action, event);
      break;

    case "update_record":
      await executeUpdateRecord(action, event);
      break;

    case "delete_record":
      await executeDeleteRecord(action, event);
      break;

    case "notify":
      await executeNotify(action, event);
      break;

    case "lookup_registry":
      await executeLookupRegistry(action, event);
      break;

    case "create_records":
      await executeCreateRecords(action, event);
      break;

    case "sync_calendar":
      await executeSyncCalendar(action, event);
      break;

    case "generate_doc":
      await executeGenerateDoc(action, event);
      break;

    case "call_api":
      await executeCallApi(action, event);
      break;

    default:
      logger.warn(`Unknown workflow action type: ${action.type}`);
  }
}

async function executeCreateRecord(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const concept = action.target;
  if (!concept) throw new Error("create_record requires a target concept");

  const defaults = action.defaults ?? {};
  const data = interpolateTokens(defaults, event);

  // Link back to the triggering record if specified
  if (action.link && event.recordId) {
    data[action.link] = event.recordId;
  }

  const table = conceptToTable(concept);
  const cols = Object.keys(data);
  const vals = Object.values(data);
  const placeholders = vals.map((_, i) => `$${i + 1}`);

  const result = await query(
    `INSERT INTO ${table} (${cols.join(", ")}, properties) VALUES (${placeholders.join(", ")}, $${vals.length + 1}) RETURNING id`,
    [...vals, JSON.stringify(data)]
  );

  const newId = result.rows[0].id as string;

  const newEvent = createDomainEvent({
    eventName: `${concept}.created`,
    domain: concept,
    action: "created",
    recordId: newId,
    newValues: data,
    triggeredBy: "workflow",
    metadata: { workflowTriggeredBy: event.eventId },
  });
  await emit(newEvent);
}

async function executeUpdateRecord(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  if (!event.recordId) throw new Error("update_record requires a recordId");

  const concept = action.target ?? event.domain;
  const table = conceptToTable(concept);
  const updates = interpolateTokens(action.defaults ?? {}, event);

  const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 1}`);
  const vals = Object.values(updates);

  await query(
    `UPDATE ${table} SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $${vals.length + 1}`,
    [...vals, event.recordId]
  );
}

async function executeDeleteRecord(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  if (!event.recordId) throw new Error("delete_record requires a recordId");

  const concept = action.target ?? event.domain;
  const table = conceptToTable(concept);

  await query(
    `UPDATE ${table} SET archived = true, updated_at = now() WHERE id = $1`,
    [event.recordId]
  );
}

async function executeNotify(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const recipients = action.recipients ?? [];
  const templateName = action.templateName ?? "default";

  logger.info("Notification triggered", {
    recipients,
    templateName,
    recordId: event.recordId,
    eventName: event.eventName,
  });

  // TODO: Implement actual notification delivery (email, in-app, etc.)
  // For now, log the notification intent
}

async function executeLookupRegistry(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const source = action.source;
  const matchField = action.match;
  const copyFields = action.copyFields ?? [];

  if (!source || !matchField) {
    throw new Error("lookup_registry requires source and match fields");
  }

  const matchValue = event.newValues?.[matchField];
  if (!matchValue) return;

  const registryTable = source === "guest" ? "guest_registry" : "vendor_registry";
  const result = await query(
    `SELECT properties FROM ${registryTable} WHERE properties->>$1 = $2 LIMIT 1`,
    [matchField, String(matchValue)]
  );

  if (result.rows.length === 0) return;

  const registryData = result.rows[0].properties as Record<string, unknown>;
  const copied = Object.fromEntries(
    copyFields.filter((f) => f in registryData).map((f) => [f, registryData[f]])
  );

  if (Object.keys(copied).length > 0) {
    const table = conceptToTable(event.domain);
    await query(
      `UPDATE ${table} SET properties = properties || $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(copied), event.recordId]
    );
  }
}

async function executeCreateRecords(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const concept = action.target;
  if (!concept) throw new Error("create_records requires a target concept");

  const template = action.template;
  if (!template) throw new Error("create_records requires a template");

  const templateResult = await query(
    "SELECT properties FROM concept_templates WHERE concept_key = $1 AND template_key = $2",
    [concept, template]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`Template "${template}" not found for concept "${concept}"`);
  }

  const templateItems = templateResult.rows[0].properties as ReadonlyArray<Record<string, unknown>>;
  const items = Array.isArray(templateItems) ? templateItems : [templateItems];
  const defaults = action.defaults ?? {};

  for (const item of items) {
    const data = interpolateTokens({ ...defaults, ...item }, event);

    if (action.link && event.recordId) {
      data[action.link] = event.recordId;
    }

    const table = conceptToTable(concept);
    const cols = Object.keys(data);
    const vals = Object.values(data);
    const placeholders = vals.map((_, i) => `$${i + 1}`);

    const result = await query(
      `INSERT INTO ${table} (${cols.join(", ")}, properties) VALUES (${placeholders.join(", ")}, $${vals.length + 1}) RETURNING id`,
      [...vals, JSON.stringify(data)]
    );

    const newId = result.rows[0].id as string;

    const newEvent = createDomainEvent({
      eventName: `${concept}.created`,
      domain: concept,
      action: "created",
      recordId: newId,
      newValues: data,
      triggeredBy: "workflow",
      metadata: { workflowTriggeredBy: event.eventId, batchTemplate: template },
    });
    await emit(newEvent);
  }
}

async function executeCallApi(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const defaults = interpolateTokens(action.defaults ?? {}, event);
  const url = defaults.url as string | undefined;

  if (!url) throw new Error("call_api requires a url in defaults");

  const method = (defaults.method as string) ?? "GET";
  const headers = (defaults.headers as Record<string, string>) ?? {};
  const body = defaults.body as string | undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== "GET" && method !== "HEAD" ? body : undefined,
      signal: controller.signal,
    });

    logger.info("call_api completed", {
      url,
      method,
      status: response.status,
      recordId: event.recordId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("call_api request failed (non-blocking)", {
      url,
      method,
      error: message,
      recordId: event.recordId,
    });
    // Do not re-throw: HTTP errors should not fail the workflow
  } finally {
    clearTimeout(timeout);
  }
}

async function executeSyncCalendar(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const defaults = interpolateTokens(action.defaults ?? {}, event);

  const calendarEvent = createDomainEvent({
    eventName: "calendar.sync_requested",
    domain: "calendar",
    action: "created",
    recordId: event.recordId,
    newValues: {
      name: defaults.name ?? defaults.title ?? event.newValues?.name,
      startTime: defaults.startTime ?? defaults.start ?? event.newValues?.startTime,
      endTime: defaults.endTime ?? defaults.end ?? event.newValues?.endTime,
      venue: defaults.venue ?? event.newValues?.venue,
      guests: defaults.guests ?? event.newValues?.guests,
      sourceEvent: event.eventName,
      sourceDomain: event.domain,
    },
    triggeredBy: "workflow",
    metadata: { workflowTriggeredBy: event.eventId },
  });

  await emit(calendarEvent);

  logger.info("calendar.sync_requested emitted", {
    recordId: event.recordId,
    eventName: event.eventName,
  });
}

async function executeGenerateDoc(
  action: WorkflowAction,
  event: DomainEvent
): Promise<void> {
  const defaults = interpolateTokens(action.defaults ?? {}, event);

  const docEvent = createDomainEvent({
    eventName: "document.generation_requested",
    domain: "document",
    action: "created",
    recordId: event.recordId,
    newValues: {
      templateName: defaults.templateName ?? action.templateName ?? "default",
      recordId: event.recordId,
      outputFormat: defaults.outputFormat ?? "pdf",
      data: defaults,
      sourceDomain: event.domain,
      sourceEvent: event.eventName,
    },
    triggeredBy: "workflow",
    metadata: { workflowTriggeredBy: event.eventId },
  });

  await emit(docEvent);

  logger.info("document.generation_requested emitted", {
    recordId: event.recordId,
    templateName: defaults.templateName ?? action.templateName ?? "default",
  });
}

// --- Helpers ---

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
    equipment: "equipment",
    transport_booking: "transport_bookings",
    guest_contract: "guest_contracts",
  };
  return tableMap[conceptKey] ?? `${conceptKey}s`;
}

/**
 * Interpolates {{token}} placeholders in action defaults.
 * Tokens reference event fields: {{recordId}}, {{triggeredBy}}, etc.
 */
function interpolateTokens(
  defaults: Readonly<Record<string, unknown>>,
  event: DomainEvent
): Record<string, unknown> {
  const tokenMap: Record<string, unknown> = {
    recordId: event.recordId,
    triggeredBy: event.triggeredBy,
    domain: event.domain,
    action: event.action,
    timestamp: event.timestamp,
    ...event.newValues,
  };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (typeof value === "string" && value.includes("{{")) {
      result[key] = value.replace(/\{\{(\w+)}}/g, (_, token) =>
        String(tokenMap[token] ?? "")
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Execute a workflow manually (for API triggers).
 */
export async function executeManualWorkflow(
  workflowId: string,
  context: Record<string, unknown>,
  triggeredBy: string
): Promise<void> {
  const workflows = await loadWorkflows();
  const workflow = workflows.find((w) => w.id === workflowId);

  if (!workflow) {
    throw new Error(`Workflow "${workflowId}" not found`);
  }

  if (workflow.trigger.type !== "manual") {
    throw new Error(`Workflow "${workflow.name}" is not a manual trigger`);
  }

  const syntheticEvent = createDomainEvent({
    eventName: `workflow.manual_trigger`,
    domain: "workflow",
    action: "created",
    recordId: workflowId,
    newValues: context,
    triggeredBy,
  });

  await executeWorkflow(workflow, syntheticEvent);
}
