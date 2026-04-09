/* ------------------------------------------------------------------ */
/*  GR-Ops shared type definitions                                     */
/* ------------------------------------------------------------------ */

// ---- API layer ----

export interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: string | null
}

// ---- Toast ----

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
}

// ---- Auth & Users ----

export type Role =
  | 'admin'
  | 'director'
  | 'department_head'
  | 'liaison'
  | 'interpreter'
  | 'volunteer'
  | 'staff'
  | 'viewer'

export interface AppUser {
  email: string
  displayName: string | null
  role: Role | null
}

export interface AuthUser {
  uid: string
  email: string
  displayName: string | null
  role: Role | null
  photoURL: string | null
}

// ---- Ontology ----

export interface OntologyProperty {
  key: string
  label: string
  type: string
  required: boolean
  options?: Array<{ value: string; label: string; color?: string }>
  placeholder?: string
  hidden?: boolean
  readOnly?: boolean
  description?: string
}

export interface OntologyRelationship {
  key: string
  label: string
  targetConcept: string
  cardinality: 'has-one' | 'has-many' | 'many-to-many'
}

export interface OntologyConcept {
  key: string
  label: string
  pluralLabel: string
  icon: string
  properties: OntologyProperty[]
  relationships: OntologyRelationship[]
}

export interface OntologyData {
  concepts: OntologyConcept[]
  version: string
}

// ---- Condition Expressions ----

export type ConditionExpression =
  | FieldCondition
  | AndCondition
  | OrCondition
  | NotCondition

export interface FieldCondition {
  type: 'field'
  field: string
  operator: string
  value?: unknown
}

export interface AndCondition {
  type: 'and'
  conditions: ConditionExpression[]
}

export interface OrCondition {
  type: 'or'
  conditions: ConditionExpression[]
}

export interface NotCondition {
  type: 'not'
  condition: ConditionExpression
}

// ---- Form Config ----

export interface FormConfig {
  id: string
  conceptKey: string
  name: string
  fields: FormFieldConfig[]
  layout?: 'single' | 'two-column' | 'wizard'
  steps?: FormStep[]
}

export interface FormFieldConfig {
  propertyKey: string
  groupName?: string
  colSpan?: 1 | 2
  showIf?: ConditionExpression
  autocompleteSource?: string
  overrideLabel?: string
  overridePlaceholder?: string
}

export interface FormStep {
  name: string
  label: string
  fields: string[]
}

// ---- View Config ----

export interface ViewConfig {
  id: string
  conceptKey: string
  name: string
  viewType: 'table' | 'kanban' | 'timeline' | 'detail' | 'dashboard'
  columns?: ViewColumn[]
  filters?: ViewFilter[]
  sort?: { field: string; direction: 'asc' | 'desc' }
  groupBy?: string
  timelineStart?: string
  timelineEnd?: string
  rowAction?: 'navigate_to_detail' | 'inline_edit' | 'none'
  presets?: ViewPreset[]
}

export interface ViewColumn {
  propertyKey: string
  width?: number
  sortable?: boolean
  filterable?: boolean
  editable?: boolean
}

export interface ViewFilter {
  field: string
  operator: string
  options?: string[]
}

export interface ViewPreset {
  name: string
  filter: Record<string, unknown>
}

// ---- Guest ----

export interface GuestSummary {
  guestId: string
  name: string
  type: string
  department: string
  status: string
  company: string
  interpreterRequired: boolean
  staffCount: number
  prepPercent: number
  prepTotal: number
  prepComplete: number
  rowVersion: number
}

export interface GuestDetail {
  guest: Record<string, unknown>
  schedule: Record<string, unknown>[]
  travel: Record<string, unknown>[]
  accommodations: Record<string, unknown>[]
  dietary: Record<string, unknown>[]
  autographs: Record<string, unknown>[]
  prepTracker: Record<string, unknown>[]
  pairings: Record<string, unknown>[]
  violations: Record<string, unknown>[]
}

// ---- Staff ----

export interface StaffSummary {
  staffId: string
  name: string
  email: string
  role: string
  department: string
  reportsTo: string
  phone: string
  lineId: string
  availability: string
  rowVersion: number
}

// ---- Schedule ----

export interface ScheduleEvent {
  eventId: string
  activity: string
  eventType: string
  guestId: string
  guestName: string
  date: string
  startTime: string
  endTime: string
  venue: string
  description: string
  status: string
  rowVersion: number
}

// ---- Prep Tracker ----

export interface PrepItem {
  id: string
  label: string
  guestName: string
  guestId: string
  dueDate: string
  status: string
  owner: string
}

// ---- Write service ----

export type WriteStatus =
  | 'APPLIED'
  | 'NOOP'
  | 'VERSION_CONFLICT'
  | 'BLOCKED'
  | 'FAILED'

export interface WriteResult {
  write_id: string
  row_version: number
  status: WriteStatus
  pk?: string
}

// ---- Table ----

export interface TableColumn {
  key: string
  label: string
  sortable?: boolean
  type?: string
}

// ---- Dashboard ----

export interface DashboardData {
  guests: Record<string, unknown>
  schedule: Record<string, unknown>
  prep: Record<string, unknown>
  staffing: Record<string, unknown>
  violations: Record<string, unknown>
  pendingChanges: Record<string, unknown>
}

// ---- Config ----

export interface ConfigData {
  departments: Record<string, unknown>[]
  roles: Record<string, unknown>[]
  eventTypes: Record<string, unknown>[]
  venues: Record<string, unknown>[]
  prepTemplates: Record<string, unknown>[]
  constraints: Record<string, unknown>[]
  convention: Record<string, unknown>
}

// ---- Drive import ----

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size: number
  lastModified: string
  importable: boolean
  typeLabel: string
}

export interface DrivePreview {
  fileName: string
  headers: string[]
  preview: string[][]
  totalRows: number
}

export interface ImportError {
  row: number
  status: string
  message: string
}

export interface ImportResult {
  imported: number
  failed: number
  errors: ImportError[]
  total: number
}

// ---- Navigation ----

export interface NavItem {
  label: string
  icon: string
  to: string
  badge?: string | number
}
