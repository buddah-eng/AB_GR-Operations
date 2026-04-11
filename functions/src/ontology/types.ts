/**
 * Domain Ontology Type System
 *
 * These types define the structure of the ontology stored in Postgres.
 * The platform reads these at runtime to understand its own domain model.
 * Adding a new domain = adding rows in Postgres, not writing code.
 */

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
  readonly id: string
  readonly key: string
  readonly name: string
  readonly pluralName: string
  readonly extends?: string
  readonly icon?: string
  readonly description?: string
  readonly isRegistry?: boolean
  readonly isConfig?: boolean
}

// --- Ontology Property (field definition per concept) ---

export interface Property {
  readonly id: string
  readonly conceptKey: string
  readonly key: string
  readonly label: string
  readonly type: PropertyType
  readonly required: boolean
  readonly defaultValue?: unknown
  readonly placeholder?: string
  readonly description?: string
  readonly postgresColumn?: string
  readonly options?: ReadonlyArray<SelectOption>
  readonly validationRules?: ValidationRules
  readonly sortOrder: number
  readonly hidden?: boolean
  readonly readOnly?: boolean
}

export interface ValidationRules {
  readonly minLength?: number
  readonly maxLength?: number
  readonly min?: number
  readonly max?: number
  readonly pattern?: string
}

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly color?: string
}

// --- Ontology Relationship ---

export interface Relationship {
  readonly id: string
  readonly sourceConceptKey: string
  readonly targetConceptKey: string
  readonly key: string
  readonly label: string
  readonly cardinality: Cardinality
  readonly inverseKey?: string
  readonly description?: string
}

// --- Ontology Domain Event Definition ---

export interface DomainEventDef {
  readonly id: string
  readonly conceptKey: string
  readonly eventKey: string
  readonly fullEventName: string
  readonly triggerType: TriggerType
  readonly description?: string
  readonly changedFields?: ReadonlyArray<string>
  readonly schedule?: string
}

// --- Ontology Constraint (inheritance / conditional defaults) ---

export interface Constraint {
  readonly id: string
  readonly conceptKey: string
  readonly name: string
  readonly extends?: string
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
  readonly properties: ReadonlyMap<string, ReadonlyArray<Property>>
  readonly relationships: ReadonlyMap<string, ReadonlyArray<Relationship>>
  readonly events: ReadonlyMap<string, ReadonlyArray<DomainEventDef>>
  readonly constraints: ReadonlyMap<string, ReadonlyArray<Constraint>>
  readonly loadedAt: number
}

// --- Config types (Form, View, Page, Workflow configs from Postgres) ---

export interface FormConfig {
  readonly id: string
  readonly conceptKey: string
  readonly name: string
  readonly fields: ReadonlyArray<FormFieldConfig>
  readonly layout?: 'single' | 'two-column' | 'wizard'
  readonly steps?: ReadonlyArray<FormStep>
}

export interface FormFieldConfig {
  readonly propertyKey: string
  readonly groupName?: string
  readonly colSpan?: 1 | 2
  readonly showIf?: ConditionExpression
  readonly autocompleteSource?: string
  readonly overrideLabel?: string
  readonly overridePlaceholder?: string
}

export interface FormStep {
  readonly name: string
  readonly label: string
  readonly fields: ReadonlyArray<string>
}

export interface ViewConfig {
  readonly id: string
  readonly conceptKey: string
  readonly name: string
  readonly viewType: 'table' | 'kanban' | 'timeline' | 'detail' | 'dashboard'
  readonly columns?: ReadonlyArray<ViewColumn>
  readonly filters?: ReadonlyArray<ViewFilter>
  readonly sort?: ViewSort
  readonly groupBy?: string
  readonly timelineStart?: string
  readonly timelineEnd?: string
  readonly rowAction?: 'navigate_to_detail' | 'inline_edit' | 'none'
  readonly presets?: ReadonlyArray<ViewPreset>
  readonly tabs?: ReadonlyArray<{
    readonly label: string
    readonly conceptKey: string
    readonly filter: Readonly<Record<string, string>>
    readonly viewName: string
  }>
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
  readonly id: string
  readonly name: string
  readonly slug: string
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
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly trigger: WorkflowTrigger
  readonly condition?: ConditionExpression
  readonly actions: ReadonlyArray<WorkflowAction>
  readonly enabled: boolean
}

export interface WorkflowTrigger {
  readonly type: WorkflowTriggerType
  readonly event?: string
  readonly schedule?: string
  readonly field?: string
}

export interface WorkflowAction {
  readonly type: WorkflowActionType
  readonly target?: string
  readonly template?: string
  readonly defaults?: Readonly<Record<string, unknown>>
  readonly link?: string
  readonly source?: string
  readonly match?: string
  readonly copyFields?: ReadonlyArray<string>
  readonly recipients?: ReadonlyArray<string>
  readonly templateName?: string
}

// --- Role & Permission types ---

export interface Role {
  readonly id: string
  readonly key: string
  readonly name: string
  readonly description?: string
  readonly priority: number
  readonly isOperational?: boolean
}

export interface Permission {
  readonly id: string
  readonly roleKey: string
  readonly conceptKey: string
  readonly canView: boolean
  readonly canEdit: boolean
  readonly canCreate: boolean
  readonly canDelete: boolean
  readonly visibleProperties: ReadonlyArray<string>
  readonly editableProperties?: ReadonlyArray<string>
}

export interface DataScope {
  readonly id: string
  readonly roleKey: string
  readonly conceptKey: string
  readonly scopeType: 'relation' | 'field' | 'department' | 'all'
  readonly relationPath?: string
  readonly field?: string
  readonly value?: string
}

export interface ScreenAccess {
  readonly id: string
  readonly roleKey: string
  readonly pageSlug: string
  readonly visible: boolean
}

export interface StaffingTemplate {
  readonly id: string
  readonly condition: ConditionExpression
  readonly requiredRole: string
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
  readonly id: string
  readonly conceptKey: string
  readonly properties: Readonly<Record<string, unknown>>
  readonly relations: Readonly<Record<string, ReadonlyArray<string>>>
  readonly createdAt: string
  readonly updatedAt: string
}
