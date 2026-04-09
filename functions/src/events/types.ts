/**
 * Domain Event Types
 *
 * Every write to a domain database fires a domain event.
 * Events carry enough context for workflows to react without re-querying.
 */

export interface DomainEvent {
  readonly eventId: string
  readonly eventName: string       // e.g. "guest.created", "schedule.updated"
  readonly domain: string          // concept key, e.g. "guest"
  readonly action: EventAction
  readonly recordId: string        // Postgres row ID of the affected record
  readonly changedFields?: ReadonlyArray<string>
  readonly previousValues?: Readonly<Record<string, unknown>>
  readonly newValues?: Readonly<Record<string, unknown>>
  readonly triggeredBy: string     // user email or "system"
  readonly timestamp: string       // ISO 8601
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type EventAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'synced'
  | 'external_created'
  | 'external_updated'
  | 'intake_received'
  | 'completed'
  | 'overdue'
  | 'staffing_complete'

export type EventHandler = (event: DomainEvent) => Promise<void>

export interface EventSubscription {
  readonly pattern: string         // glob pattern, e.g. "guest.*", "*.created"
  readonly handler: EventHandler
  readonly priority?: number       // lower = runs first
}

export interface EventLogEntry {
  readonly eventId: string
  readonly eventName: string
  readonly recordId: string
  readonly triggeredBy: string
  readonly timestamp: string
  readonly workflowsTriggered: ReadonlyArray<string>
  readonly actionsExecuted: ReadonlyArray<{
    readonly workflowName: string
    readonly actionType: string
    readonly success: boolean
    readonly error?: string
  }>
}
