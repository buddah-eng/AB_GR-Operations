/* ------------------------------------------------------------------ */
/*  Workflow type definitions                                          */
/* ------------------------------------------------------------------ */

import type { ConditionExpression } from '@/types/forms'

/** Trigger types for workflow initiation */
export type TriggerType = 'domain_event' | 'field_changed' | 'scheduled' | 'manual'

/** All supported workflow action types */
export type ActionType =
  | 'create_record'
  | 'create_records'
  | 'update_record'
  | 'delete_record'
  | 'notify'
  | 'call_api'
  | 'sync_calendar'
  | 'generate_doc'
  | 'lookup_registry'

/** Workflow trigger configuration */
export interface WorkflowTrigger {
  readonly type: TriggerType
  readonly conceptKey?: string
  readonly eventName?: string
  readonly fieldName?: string
  readonly schedule?: string
  readonly buttonLabel?: string
  readonly description?: string
}

/** A single workflow action */
export interface WorkflowAction {
  readonly id: string
  readonly type: ActionType
  readonly label: string
  readonly config: Record<string, unknown>
  readonly position: number
}

/** Top-level workflow configuration */
export interface WorkflowConfig {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly trigger: WorkflowTrigger
  readonly condition?: ConditionExpression | null
  readonly actions: readonly WorkflowAction[]
  readonly enabled: boolean
  readonly createdAt?: string
  readonly updatedAt?: string
}

/** Dry-run result from the API */
export interface DryRunResult {
  readonly workflowId: string
  readonly recordId: string
  readonly conditionResult: boolean | null
  readonly conditionEvalDetail: string
  readonly actionResults: ReadonlyArray<{
    readonly actionIndex: number
    readonly wouldExecute: boolean
    readonly reason: string
    readonly previewData: Record<string, unknown> | null
  }>
  readonly executionPath: ReadonlyArray<string>
}

/** Validation status from CI/QA pipeline */
export interface WorkflowValidation {
  readonly noLoops: boolean
  readonly targetsExist: boolean
  readonly rateOk: boolean
  readonly warnings: readonly string[]
  readonly errors: readonly string[]
}

/** Action type metadata for the palette */
export interface ActionTypeInfo {
  readonly type: ActionType
  readonly label: string
  readonly icon: string
  readonly color: string
  readonly description: string
}

/** All available action type metadata */
export const ACTION_TYPE_INFO: readonly ActionTypeInfo[] = [
  { type: 'create_record', label: 'Create Record', icon: 'pi pi-plus-circle', color: 'green', description: 'Create a new record in a concept' },
  { type: 'create_records', label: 'Create Records', icon: 'pi pi-clone', color: 'green', description: 'Create multiple records from a template' },
  { type: 'update_record', label: 'Update Record', icon: 'pi pi-pencil', color: 'blue', description: 'Update fields on an existing record' },
  { type: 'delete_record', label: 'Delete Record', icon: 'pi pi-trash', color: 'red', description: 'Delete an existing record' },
  { type: 'notify', label: 'Send Notification', icon: 'pi pi-bell', color: 'cyan', description: 'Send a notification to users or roles' },
  { type: 'call_api', label: 'Call API', icon: 'pi pi-cloud', color: 'indigo', description: 'Call an external API endpoint' },
  { type: 'sync_calendar', label: 'Sync Calendar', icon: 'pi pi-calendar', color: 'teal', description: 'Sync event to Google Calendar' },
  { type: 'generate_doc', label: 'Generate Document', icon: 'pi pi-file', color: 'orange', description: 'Generate a document from a template' },
  { type: 'lookup_registry', label: 'Lookup Registry', icon: 'pi pi-search', color: 'purple', description: 'Look up data from a registry' },
] as const

/** Trigger type metadata */
export interface TriggerTypeInfo {
  readonly type: TriggerType
  readonly label: string
  readonly icon: string
  readonly bgClass: string
  readonly description: string
}

export const TRIGGER_TYPE_INFO: readonly TriggerTypeInfo[] = [
  { type: 'domain_event', label: 'Domain Event', icon: 'pi pi-play', bgClass: 'bg-blue-500', description: 'Triggered when a record is created, updated, or deleted' },
  { type: 'field_changed', label: 'Field Changed', icon: 'pi pi-pencil', bgClass: 'bg-purple-500', description: 'Triggered when a specific field value changes' },
  { type: 'scheduled', label: 'Scheduled', icon: 'pi pi-clock', bgClass: 'bg-orange-500', description: 'Triggered on a recurring schedule' },
  { type: 'manual', label: 'Manual', icon: 'pi pi-hand-point-up-fill', bgClass: 'bg-green-500', description: 'Triggered manually by a user clicking a button' },
] as const
