/**
 * Domain Ontology Type System
 *
 * These types define the structure of the ontology that lives in Notion.
 * The platform reads these at runtime to understand its own domain model.
 * Adding a new domain = adding rows in Notion, not writing code.
 */

// --- Notion record identifiers ---

export type NotionPageId = string
export type NotionDatabaseId = string

// --- Property types supported by the ontology ---

export type PropertyType =
  | 'text'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'date'
  | 'datetime'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'relation'
  | 'formula'
  | 'rollup'
  | 'files'
  | 'people'
  | 'status'

export type Cardinality = 'has-one' | 'has-many' | 'many-to-many'

export type TriggerType = 'on_create' | 'on_update' | 'on_delete' | 'on_field_change' | 'scheduled' | 'manual'

// --- Ontology Concept ---

export interface Concept {
  readonly id: NotionPageId
  readonly key: string             // e.g. "guest", "staff", "schedule"
  readonly name: string            // e.g. "Guest", "Staff", "Schedule Event"
  readonly pluralName: string      // e.g. "Guests", "Staff", "Schedule Events"
  readonly extends?: string        // parent concept key (inheritance)
  readonly notionDatabaseId: NotionDatabaseId
  readonly icon?: string           // PrimeIcons name
  readonly description?: string
  readonly isRegistry?: boolean    // YoY persistent data
  readonly isConfig?: boolean      // Platform config (not domain data)
}

// --- Ontology Property (field definition per concept) ---

export interface Property {
  readonly id: NotionPageId
  readonly conceptKey: string      // which concept this belongs to
  readonly key: string             // field key, e.g. "name", "status"
  readonly label: string           // display label
  readonly type: PropertyType
  readonly required: boolean
  readonly defaultValue?: unknown
  readonly placeholder?: string
  readonly description?: string
  readonly notionPropertyName: string  // actual Notion property name
  // Select/multi-select options
  readonly options?: ReadonlyArray<SelectOption>
  // Validation
  readonly minLength?: number
  readonly maxLength?: number
  readonly min?: number
  readonly max?: number
  readonly pattern?: string        // regex pattern
  // Display
  readonly sortOrder: number       // default display order
  readonly hidden?: boolean        // hidden from default views
  readonly readOnly?: boolean      // computed/formula fields
}

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly color?: string
}

// --- Ontology Relationship ---

export interface Relationship {
  readonly id: NotionPageId
  readonly sourceConceptKey: string
  readonly targetConceptKey: string
  readonly key: string             // e.g. "pairings", "travel"
  readonly label: string           // e.g. "Staff Pairings", "Travel Records"
  readonly cardinality: Cardinality
  readonly notionRelationName: string  // Notion relation property name
  readonly inverseKey?: string     // key on the target side
  readonly description?: string
}

// --- Ontology Domain Event Definition ---

export interface DomainEventDef {
  readonly id: NotionPageId
  readonly conceptKey: string
  readonly eventKey: string        // e.g. "created", "updated", "deleted"
  readonly fullEventName: string   // e.g. "guest.created"
  readonly triggerType: TriggerType
  readonly description?: string
  readonly changedFields?: ReadonlyArray<string>  // for on_field_change
  readonly schedule?: string       // cron expression for scheduled
}

// --- Ontology Constraint (inheritance / conditional defaults) ---

export interface Constraint {
  readonly id: NotionPageId
  readonly conceptKey: string      // which concept this constrains
  readonly name: string            // e.g. "JP Guest"
  readonly extends?: string        // parent concept key
  readonly condition: ConditionExpression
  readonly defaults?: Readonly<Record<string, unknown>>
  readonly requiredFields?: ReadonlyArray<string>
  readonly description?: string
}

// --- Condition expressions (used by constraints and workflows) ---

export type ConditionExpression =
  | FieldCondition
  | AndCondition
  | OrCondition
  | NotCondition

export interface FieldCondition {
  readonly type: 'field'
  readonly field: string
  readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'
  readonly value?: unknown
}

export interface AndCondition {
  readonly type: 'and'
  readonly conditions: ReadonlyArray<ConditionExpression>
}

export interface OrCondition {
  readonly type: 'or'
  readonly conditions: ReadonlyArray<ConditionExpression>
}

export interface NotCondition {
  readonly type: 'not'
  readonly condition: ConditionExpression
}

// --- Resolved Ontology (cached in memory) ---

export interface OntologyCache {
  readonly concepts: ReadonlyMap<string, Concept>
  readonly properties: ReadonlyMap<string, ReadonlyArray<Property>>  // conceptKey → properties
  readonly relationships: ReadonlyMap<string, ReadonlyArray<Relationship>>  // conceptKey → relationships
  readonly events: ReadonlyMap<string, ReadonlyArray<DomainEventDef>>  // conceptKey → events
  readonly constraints: ReadonlyMap<string, ReadonlyArray<Constraint>>  // conceptKey → constraints
  readonly loadedAt: number  // timestamp
}

// --- Config types (Form, View, Page, Workflow configs from Notion) ---

export interface FormConfig {
  readonly id: NotionPageId
  readonly conceptKey: string
  readonly name: string
  readonly fields: ReadonlyArray<FormFieldConfig>
  readonly layout?: 'single' | 'two-column' | 'wizard'
  readonly steps?: ReadonlyArray<FormStep>  // for wizard layout
}

export interface FormFieldConfig {
  readonly propertyKey: string
  readonly groupName?: string
  readonly colSpan?: 1 | 2
  readonly showIf?: ConditionExpression
  readonly autocompleteSource?: string  // concept key for autocomplete
  readonly overrideLabel?: string
  readonly overridePlaceholder?: string
}

export interface FormStep {
  readonly name: string
  readonly label: string
  readonly fields: ReadonlyArray<string>  // property keys
}

export interface ViewConfig {
  readonly id: NotionPageId
  readonly conceptKey: string
  readonly name: string
  readonly viewType: 'table' | 'kanban' | 'timeline' | 'detail' | 'dashboard'
  readonly columns?: ReadonlyArray<ViewColumn>
  readonly filters?: ReadonlyArray<ViewFilter>
  readonly sort?: ViewSort
  readonly groupBy?: string  // property key (for kanban)
  readonly timelineStart?: string  // property key (for timeline)
  readonly timelineEnd?: string
  readonly rowAction?: 'navigate_to_detail' | 'inline_edit' | 'none'
  readonly presets?: ReadonlyArray<ViewPreset>
}

export interface ViewColumn {
  readonly propertyKey: string
  readonly width?: number
  readonly sortable?: boolean
  readonly filterable?: boolean
  readonly editable?: boolean
}

export interface ViewFilter {
  readonly field: string
  readonly operator: string
  readonly options?: ReadonlyArray<string>
}

export interface ViewSort {
  readonly field: string
  readonly direction: 'asc' | 'desc'
}

export interface ViewPreset {
  readonly name: string
  readonly filter: Readonly<Record<string, unknown>>
}

export interface PageConfig {
  readonly id: NotionPageId
  readonly name: string
  readonly slug: string  // URL path
  readonly widgets: ReadonlyArray<WidgetConfig>
  readonly breakpoints?: {
    readonly desktop: ReadonlyArray<WidgetLayout>
    readonly tablet?: ReadonlyArray<WidgetLayout>
    readonly mobile?: ReadonlyArray<WidgetLayout>
  }
}

export interface WidgetConfig {
  readonly widgetId: string
  readonly type: 'stat_card' | 'data_table' | 'chart' | 'timeline_preview' | 'prep_progress' | 'action_banner' | 'quick_add' | 'activity_feed'
  readonly title?: string
  readonly conceptKey?: string
  readonly filter?: Readonly<Record<string, unknown>>
  readonly displayOptions?: Readonly<Record<string, unknown>>
}

export interface WidgetLayout {
  readonly widgetId: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

// --- Workflow types ---

export type WorkflowTriggerType = 'domain_event' | 'scheduled' | 'manual' | 'field_changed'

export type WorkflowActionType =
  | 'create_record'
  | 'create_records'
  | 'update_record'
  | 'delete_record'
  | 'notify'
  | 'sync_calendar'
  | 'generate_doc'
  | 'call_api'
  | 'lookup_registry'

export interface WorkflowConfig {
  readonly id: NotionPageId
  readonly name: string
  readonly description?: string
  readonly trigger: WorkflowTrigger
  readonly condition?: ConditionExpression
  readonly actions: ReadonlyArray<WorkflowAction>
  readonly enabled: boolean
}

export interface WorkflowTrigger {
  readonly type: WorkflowTriggerType
  readonly event?: string          // e.g. "guest.created" (for domain_event)
  readonly schedule?: string       // cron expression (for scheduled)
  readonly field?: string          // property key (for field_changed)
}

export interface WorkflowAction {
  readonly type: WorkflowActionType
  readonly target?: string         // concept key
  readonly template?: string       // template name (for create_records)
  readonly defaults?: Readonly<Record<string, unknown>>
  readonly link?: string           // relation field to link back
  readonly source?: string         // concept key (for lookup_registry)
  readonly match?: string          // property key to match on
  readonly copyFields?: ReadonlyArray<string>
  readonly recipients?: ReadonlyArray<string>
  readonly templateName?: string   // for notify, generate_doc
}

// --- Role & Permission types ---

export interface Role {
  readonly id: NotionPageId
  readonly key: string             // e.g. "director", "liaison"
  readonly name: string            // e.g. "Director", "Liaison"
  readonly description?: string
  readonly priority: number        // hierarchy (lower = more access)
  readonly isOperational?: boolean // staffing role vs app role
}

export interface Permission {
  readonly id: NotionPageId
  readonly roleKey: string
  readonly conceptKey: string
  readonly canView: boolean
  readonly canEdit: boolean
  readonly canCreate: boolean
  readonly canDelete: boolean
  readonly visibleProperties: ReadonlyArray<string>  // property keys
  readonly editableProperties?: ReadonlyArray<string>
}

export interface DataScope {
  readonly id: NotionPageId
  readonly roleKey: string
  readonly conceptKey: string
  readonly scopeType: 'relation' | 'field' | 'department' | 'all'
  readonly relationPath?: string   // e.g. "pairings.staff" = current user
  readonly field?: string
  readonly value?: string
}

export interface ScreenAccess {
  readonly id: NotionPageId
  readonly roleKey: string
  readonly pageSlug: string
  readonly visible: boolean
}

export interface StaffingTemplate {
  readonly id: NotionPageId
  readonly condition: ConditionExpression  // guest constraint
  readonly requiredRole: string    // role key
  readonly designation: 'primary' | 'backup'
  readonly count: number
}

// --- API response types ---

export interface ApiResponse<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: string
  readonly meta?: {
    readonly total: number
    readonly page: number
    readonly limit: number
    readonly hasMore: boolean
  }
}

export interface DomainRecord {
  readonly id: NotionPageId
  readonly conceptKey: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly relations: Readonly<Record<string, ReadonlyArray<string>>>  // relation key → page IDs
  readonly createdAt: string
  readonly updatedAt: string
}
