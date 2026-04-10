/**
 * Internal Pipeline Service
 *
 * Orchestrates multi-stage cross-department data flows.
 * Subscribes to the event bus at priority 550 (between workflows at 500
 * and data routing at 600). Executes pipeline stages sequentially with
 * configurable error strategies.
 *
 * Stage types: route, transform, quality_check, workflow, gate.
 * Error strategies: fail_fast, continue, retry_then_skip.
 */

import * as logger from "firebase-functions/logger";
import { subscribe, emit, createDomainEvent, matchesPattern } from "../events/bus";
import { query } from "../db/client";
import { executeRoute, getRouteById } from "../data-routing/service";
import { executeTransformChain } from "../data-routing/transforms";
import { evaluateCondition } from "../conditions/evaluator";
import type { DomainEvent } from "../events/types";
import type { ConditionExpression } from "../ontology/types";
import type { TransformStep } from "../data-routing/transforms";

// --- Types ---

export interface Pipeline {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly trigger_type: "domain_event" | "scheduled" | "manual" | "pipeline";
  readonly trigger_config: Readonly<Record<string, unknown>>;
  readonly stages: ReadonlyArray<PipelineStage>;
  readonly error_strategy: "fail_fast" | "continue" | "retry_then_skip";
  readonly status: "draft" | "active" | "paused" | "deprecated";
  readonly owner_scope: string;
  readonly owner_department: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export type PipelineStage =
  | RouteStage
  | TransformStage
  | QualityCheckStage
  | WorkflowStage
  | GateStage;

export interface RouteStage {
  readonly type: "route";
  readonly name: string;
  readonly route_id: string;
}

export interface TransformStage {
  readonly type: "transform";
  readonly name: string;
  readonly transform_chain: ReadonlyArray<TransformStep>;
}

export interface QualityCheckStage {
  readonly type: "quality_check";
  readonly name: string;
  readonly check_type: "not_empty" | "field_present" | "value_range" | "custom";
  readonly config: Readonly<Record<string, unknown>>;
  readonly on_failure: "halt" | "warn" | "skip_remaining";
}

export interface WorkflowStage {
  readonly type: "workflow";
  readonly name: string;
  readonly workflow_id: string;
}

export interface GateStage {
  readonly type: "gate";
  readonly name: string;
  readonly condition: ConditionExpression;
  readonly on_failure: "halt" | "skip_to_stage";
  readonly skip_to_stage_name?: string;
}

export interface PipelineExecution {
  readonly id: string;
  readonly pipeline_id: string;
  readonly status: "running" | "completed" | "failed" | "partial";
  readonly stages_completed: number;
  readonly stages_total: number;
  readonly records_processed: number;
  readonly errors: ReadonlyArray<StageError>;
  readonly started_at: string;
  readonly completed_at: string | null;
}

export interface StageError {
  readonly stage_name: string;
  readonly error: string;
}

// --- Registration ---

/**
 * Registers the pipeline engine on the event bus at priority 550.
 * Call once during app startup.
 *
 * @returns An unsubscribe function.
 */
export function registerPipelineEngine(): () => void {
  return subscribe("*", handlePipelineTrigger, 550);
}

// --- Event handler ---

/**
 * Checks if any active pipeline should be triggered by this event.
 */
async function handlePipelineTrigger(event: DomainEvent): Promise<void> {
  let pipelines: ReadonlyArray<Pipeline>;

  try {
    pipelines = await loadActivePipelines();
  } catch (err) {
    logger.error("Failed to load pipelines", { error: err });
    return;
  }

  const matching = pipelines.filter((p) => {
    if (p.trigger_type !== "domain_event") return false;
    const pattern = (p.trigger_config as Record<string, unknown>).event_pattern as string | undefined;
    if (!pattern) return false;
    return matchesPattern(pattern, event.eventName);
  });

  for (const pipeline of matching) {
    try {
      await executePipeline(pipeline.id, event);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Pipeline "${pipeline.name}" failed`, { error: message });
    }
  }
}

// --- Pipeline execution ---

/**
 * Executes a pipeline by ID. Loads the pipeline definition, creates an
 * execution record, runs each stage sequentially, and updates the
 * execution with results.
 */
export async function executePipeline(
  pipelineId: string,
  triggerEvent?: DomainEvent
): Promise<PipelineExecution> {
  const pipeline = await getPipelineById(pipelineId);
  if (!pipeline) {
    throw new Error(`Pipeline not found: ${pipelineId}`);
  }

  if (pipeline.status !== "active") {
    throw new Error(`Pipeline "${pipeline.name}" is not active (status: ${pipeline.status})`);
  }

  // Create execution record
  const executionResult = await query<{ id: string; started_at: string }>(
    `INSERT INTO pipeline_executions (pipeline_id, status, stages_total)
     VALUES ($1, 'running', $2)
     RETURNING id, started_at`,
    [pipelineId, pipeline.stages.length]
  );
  const executionId = executionResult.rows[0].id;
  const startedAt = executionResult.rows[0].started_at;

  // Emit pipeline.started event
  const startEvent = createDomainEvent({
    eventName: "pipeline.started",
    domain: "pipeline",
    action: "created",
    recordId: executionId,
    newValues: { pipeline_name: pipeline.name, pipeline_id: pipelineId },
    triggeredBy: triggerEvent?.triggeredBy ?? "system",
  });
  await emit(startEvent);

  // Execute stages
  const errors: StageError[] = [];
  let stagesCompleted = 0;
  let recordsProcessed = 0;
  let stageContext: Readonly<Record<string, unknown>> = triggerEvent?.newValues ?? {};
  let shouldStop = false;

  for (let i = 0; i < pipeline.stages.length; i++) {
    if (shouldStop) break;

    const stage = pipeline.stages[i];

    try {
      const result = await executeStage(stage, stageContext, triggerEvent);
      stagesCompleted++;
      recordsProcessed += result.recordsProcessed;
      stageContext = result.output;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ stage_name: stage.name, error: message });

      switch (pipeline.error_strategy) {
        case "fail_fast":
          shouldStop = true;
          break;

        case "retry_then_skip": {
          // Simple retry: try once more, then skip
          try {
            const retryResult = await executeStage(stage, stageContext, triggerEvent);
            stagesCompleted++;
            recordsProcessed += retryResult.recordsProcessed;
            stageContext = retryResult.output;
            // Remove the error since retry succeeded
            errors.pop();
          } catch {
            // Retry failed, skip this stage
            logger.warn(`Pipeline "${pipeline.name}" stage "${stage.name}" failed after retry, skipping`);
          }
          break;
        }

        case "continue":
        default:
          // Log and continue
          logger.warn(`Pipeline "${pipeline.name}" stage "${stage.name}" failed, continuing`, { error: message });
          break;
      }
    }
  }

  // Determine final status
  let finalStatus: "completed" | "failed" | "partial";
  if (errors.length === 0) {
    finalStatus = "completed";
  } else if (pipeline.error_strategy === "fail_fast" && errors.length > 0) {
    finalStatus = "failed";
  } else if (stagesCompleted > 0) {
    finalStatus = "partial";
  } else {
    finalStatus = "failed";
  }

  // Update execution record
  await query(
    `UPDATE pipeline_executions
     SET status = $1, stages_completed = $2, records_processed = $3,
         errors = $4, completed_at = now()
     WHERE id = $5`,
    [finalStatus, stagesCompleted, recordsProcessed, JSON.stringify(errors), executionId]
  );

  // Emit completion event
  const completionEvent = createDomainEvent({
    eventName: finalStatus === "failed" ? "pipeline.failed" : "pipeline.completed",
    domain: "pipeline",
    action: "completed",
    recordId: executionId,
    newValues: {
      pipeline_name: pipeline.name,
      pipeline_id: pipelineId,
      status: finalStatus,
      stages_completed: stagesCompleted,
      errors,
    },
    triggeredBy: triggerEvent?.triggeredBy ?? "system",
  });
  await emit(completionEvent);

  return {
    id: executionId,
    pipeline_id: pipelineId,
    status: finalStatus,
    stages_completed: stagesCompleted,
    stages_total: pipeline.stages.length,
    records_processed: recordsProcessed,
    errors,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  };
}

// --- Stage execution ---

interface StageResult {
  readonly output: Readonly<Record<string, unknown>>;
  readonly recordsProcessed: number;
}

async function executeStage(
  stage: PipelineStage,
  context: Readonly<Record<string, unknown>>,
  triggerEvent?: DomainEvent
): Promise<StageResult> {
  switch (stage.type) {
    case "route":
      return executeRouteStage(stage, context, triggerEvent);

    case "transform":
      return executeTransformStage(stage, context);

    case "quality_check":
      return executeQualityCheckStage(stage, context);

    case "workflow":
      return executeWorkflowStage(stage, context);

    case "gate":
      return executeGateStage(stage, context);

    default:
      throw new Error(`Unknown stage type: ${(stage as { type: string }).type}`);
  }
}

async function executeRouteStage(
  stage: RouteStage,
  context: Readonly<Record<string, unknown>>,
  triggerEvent?: DomainEvent
): Promise<StageResult> {
  const route = await getRouteById(stage.route_id);
  if (!route) {
    throw new Error(`Route not found: ${stage.route_id}`);
  }

  const event = triggerEvent ?? createDomainEvent({
    eventName: `pipeline.route_stage`,
    domain: "pipeline",
    action: "created",
    recordId: "pipeline-stage",
    newValues: context,
    triggeredBy: "system",
  });

  const projection = await executeRoute(route, event);
  return { output: projection, recordsProcessed: 1 };
}

function executeTransformStage(
  stage: TransformStage,
  context: Readonly<Record<string, unknown>>
): Promise<StageResult> {
  const result = executeTransformChain(stage.transform_chain, context);
  return Promise.resolve({
    output: result.record as Record<string, unknown>,
    recordsProcessed: 1,
  });
}

function executeQualityCheckStage(
  stage: QualityCheckStage,
  context: Readonly<Record<string, unknown>>
): Promise<StageResult> {
  let passed = true;

  switch (stage.check_type) {
    case "not_empty":
      passed = Object.keys(context).length > 0;
      break;

    case "field_present": {
      const fields = (stage.config.fields as ReadonlyArray<string>) ?? [];
      passed = fields.every((f) => context[f] !== undefined && context[f] !== null);
      break;
    }

    case "value_range": {
      const field = stage.config.field as string;
      const min = stage.config.min as number | undefined;
      const max = stage.config.max as number | undefined;
      const value = Number(context[field]);
      if (min !== undefined && value < min) passed = false;
      if (max !== undefined && value > max) passed = false;
      break;
    }

    case "custom":
      // Custom checks evaluate a condition expression
      if (stage.config.condition) {
        passed = evaluateCondition(stage.config.condition as ConditionExpression, context);
      }
      break;
  }

  if (!passed) {
    if (stage.on_failure === "halt") {
      return Promise.reject(new Error(`Quality check "${stage.name}" failed`));
    }
    // warn or skip_remaining: log and continue
    logger.warn(`Quality check "${stage.name}" failed (on_failure: ${stage.on_failure})`);
  }

  return Promise.resolve({ output: { ...context }, recordsProcessed: 0 });
}

function executeWorkflowStage(
  _stage: WorkflowStage,
  context: Readonly<Record<string, unknown>>
): Promise<StageResult> {
  // Workflow execution is delegated to the workflow engine via events
  // For now, pass through context
  return Promise.resolve({ output: { ...context }, recordsProcessed: 1 });
}

function executeGateStage(
  stage: GateStage,
  context: Readonly<Record<string, unknown>>
): Promise<StageResult> {
  const passes = evaluateCondition(stage.condition, context);

  if (!passes) {
    if (stage.on_failure === "halt") {
      return Promise.reject(new Error(`Gate "${stage.name}" condition not met`));
    }
    // skip_to_stage: for now, treat as a pass-through since stage jumping
    // requires orchestrator-level control
    logger.info(`Gate "${stage.name}" skipping (condition not met)`);
  }

  return Promise.resolve({ output: { ...context }, recordsProcessed: 0 });
}

// --- CRUD ---

/**
 * Lists pipelines with optional status filter.
 */
export async function listPipelines(
  status?: string
): Promise<ReadonlyArray<Pipeline>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    conditions.push("status = $1");
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query(
    `SELECT * FROM data_pipelines ${whereClause} ORDER BY created_at DESC`,
    params
  );

  return result.rows as unknown as ReadonlyArray<Pipeline>;
}

/**
 * Gets a single pipeline by ID.
 */
export async function getPipelineById(id: string): Promise<Pipeline | null> {
  const result = await query(
    "SELECT * FROM data_pipelines WHERE id = $1",
    [id]
  );

  return (result.rows[0] as unknown as Pipeline) ?? null;
}

/**
 * Creates a new pipeline in draft status.
 */
export async function createPipeline(
  data: Omit<Pipeline, "id" | "created_at" | "updated_at">
): Promise<Pipeline> {
  const result = await query(
    `INSERT INTO data_pipelines (name, description, trigger_type, trigger_config, stages, error_strategy, status, owner_scope, owner_department)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.name,
      data.description,
      data.trigger_type,
      JSON.stringify(data.trigger_config),
      JSON.stringify(data.stages),
      data.error_strategy,
      data.status,
      data.owner_scope,
      data.owner_department,
    ]
  );

  return result.rows[0] as unknown as Pipeline;
}

/**
 * Updates an existing pipeline.
 */
export async function updatePipeline(
  id: string,
  data: Partial<Omit<Pipeline, "id" | "created_at" | "updated_at">>
): Promise<Pipeline | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  const fields = [
    "name", "description", "trigger_type", "trigger_config",
    "stages", "error_strategy", "status", "owner_scope", "owner_department",
  ] as const;

  for (const field of fields) {
    const value = data[field as keyof typeof data];
    if (value !== undefined) {
      const serialized = (field === "trigger_config" || field === "stages")
        ? JSON.stringify(value)
        : value;
      setClauses.push(`${field} = $${paramIdx++}`);
      params.push(serialized);
    }
  }

  if (setClauses.length === 0) return getPipelineById(id);

  setClauses.push("updated_at = now()");
  params.push(id);

  const result = await query(
    `UPDATE data_pipelines SET ${setClauses.join(", ")} WHERE id = $${paramIdx} RETURNING *`,
    params
  );

  return (result.rows[0] as unknown as Pipeline) ?? null;
}

/**
 * Deletes a pipeline by ID.
 */
export async function deletePipeline(id: string): Promise<boolean> {
  const result = await query(
    "DELETE FROM data_pipelines WHERE id = $1",
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Gets execution history for a pipeline.
 */
export async function getExecutions(
  pipelineId: string,
  limit = 20
): Promise<ReadonlyArray<PipelineExecution>> {
  const result = await query(
    `SELECT * FROM pipeline_executions
     WHERE pipeline_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [pipelineId, limit]
  );

  return result.rows as unknown as ReadonlyArray<PipelineExecution>;
}

// --- Helpers ---

async function loadActivePipelines(): Promise<ReadonlyArray<Pipeline>> {
  const result = await query(
    "SELECT * FROM data_pipelines WHERE status = 'active'"
  );

  return result.rows as unknown as ReadonlyArray<Pipeline>;
}
