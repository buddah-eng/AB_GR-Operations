/* ------------------------------------------------------------------ */
/*  View renderer type definitions                                     */
/* ------------------------------------------------------------------ */

import type { ConditionExpression } from '@/types/forms'

/** Supported view types */
export type ViewType = 'table' | 'kanban' | 'timeline' | 'detail' | 'dashboard'

/** Sort direction */
export type SortDirection = 'asc' | 'desc'

/** Column configuration for table views */
export interface ViewColumn {
  /** Property key (backend format) */
  propertyKey?: string
  /** Property key (frontend format) */
  key?: string
  /** Display header label (resolved from ontology if absent) */
  label?: string
  /** Whether column is sortable */
  sortable?: boolean
  /** Whether column is filterable */
  filterable?: boolean
  /** Column width (CSS value) */
  width?: string
  /** Property type (for formatting) */
  type?: string
  /** Whether column is visible by default */
  visible?: boolean
  /** Custom format string */
  format?: string
  /** Alignment */
  align?: 'left' | 'center' | 'right'
  /** Custom renderer name */
  renderer?: string
  /** Section for detail views */
  section?: string
  /** Column span for detail views */
  span?: string
  /** Whether column is editable inline */
  editable?: boolean
}

/** Filter configuration */
export interface ViewFilter {
  field: string
  operator: string
  value: unknown
}

/** Sort configuration */
export interface ViewSort {
  field: string
  direction: SortDirection
}

/** A saved view preset */
export interface ViewPreset {
  id: string
  name: string
  description?: string
  viewType: ViewType
  columns?: ViewColumn[]
  filters?: ViewFilter[]
  sorts?: ViewSort[]
  groupBy?: string
  isDefault?: boolean
  isSystem?: boolean
  createdBy?: string
  createdAt?: string
}

/** Widget type for dashboard views */
export type WidgetType = 'stat-card' | 'chart' | 'table' | 'list'

/** Dashboard widget configuration */
export interface DashboardWidget {
  id: string
  type: WidgetType
  title: string
  /** Grid column span (1-4) */
  colSpan?: number
  /** Grid row span */
  rowSpan?: number
  /** Data source concept key */
  conceptKey?: string
  /** Aggregation or query config */
  config?: Record<string, unknown>
}

/** Tab configuration for detail views */
export interface ViewTab {
  label: string
  conceptKey: string
  filter: Record<string, string>
  viewName: string
}

/** Top-level view configuration */
export interface ViewConfig {
  /** Unique view identifier */
  id: string
  /** Config name identifier (from backend) */
  name?: string
  /** Display title (computed from concept label if absent) */
  title?: string
  /** Description */
  description?: string
  /** View type to render */
  viewType: ViewType
  /** Concept key from ontology */
  conceptKey: string
  /** Columns for table view */
  columns?: ViewColumn[]
  /** Active filters */
  filters?: ViewFilter[]
  /** Single sort (backend format) */
  sort?: ViewSort
  /** Multiple sorts (frontend legacy) */
  sorts?: ViewSort[]
  /** Field to group by (kanban) */
  groupBy?: string
  /** Timeline start field (backend format) */
  timelineStart?: string
  /** Timeline end field (backend format) */
  timelineEnd?: string
  /** Legacy timeline fields */
  dateField?: string
  /** Legacy end date field for timeline */
  endDateField?: string
  /** Row action on click */
  rowAction?: 'navigate_to_detail' | 'inline_edit' | 'none'
  /** Rendering mode for table views */
  renderMode?: 'card-rows' | 'dense-table'
  /** Tabs for detail views */
  tabs?: ViewTab[]
  /** Widgets for dashboard */
  widgets?: DashboardWidget[]
  /** Saved presets */
  presets?: ViewPreset[]
  /** Active preset id */
  activePresetId?: string
  /** Filter condition expression */
  filterCondition?: ConditionExpression
  /** Page size for pagination */
  pageSize?: number
}
