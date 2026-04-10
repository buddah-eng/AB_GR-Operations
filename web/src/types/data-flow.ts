/* ------------------------------------------------------------------ */
/*  Data flow / routing type definitions                               */
/* ------------------------------------------------------------------ */

/** PII filter mode for a data route */
export type PiiFilterMode = 'pass' | 'strip' | 'hash'

/** Execution mode for a data route */
export type RouteExecutionMode = 'sync' | 'async'

/** A field-level mapping within a route */
export interface FieldMapping {
  readonly sourceField: string
  readonly destField: string
  readonly transformRef?: string
}

/** Data route configuration */
export interface DataRoute {
  readonly id: string
  readonly name: string
  readonly sourceConceptKey: string
  readonly destConceptKey: string
  readonly enabled: boolean
  readonly piiFilterMode: PiiFilterMode
  readonly executionMode: RouteExecutionMode
  readonly fieldMappings: readonly FieldMapping[]
  readonly transformId?: string
  readonly inlineTransforms?: readonly DataTransformStep[]
  readonly department?: string
  readonly createdAt?: string
  readonly updatedAt?: string
}

/** Transform step types */
export type TransformStepType =
  | 'pii_strip'
  | 'field_rename'
  | 'format'
  | 'conditional'
  | 'static'
  | 'compute'
  | 'filter'
  | 'aggregate'

/** A single step in a transform chain */
export interface DataTransformStep {
  readonly type: TransformStepType
  readonly config: Record<string, unknown>
  readonly description?: string
}

/** A named, reusable data transform */
export interface DataTransform {
  readonly id: string
  readonly name: string
  readonly steps: readonly DataTransformStep[]
  readonly status: 'active' | 'deprecated'
  readonly createdAt?: string
  readonly updatedAt?: string
}

/** Observability metrics for live animation */
export interface PipelineHealth {
  readonly routeId: string
  readonly lastRunStatus: 'success' | 'partial_failure' | 'failure' | null
  readonly lastRunRecordsProcessed: number
  readonly throughput: number
  readonly isOverdue: boolean
  readonly lastRunAt?: string
}
