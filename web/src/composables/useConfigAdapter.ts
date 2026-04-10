/**
 * Config Adapter
 *
 * Transforms backend ViewConfig (from Postgres/API) to the frontend
 * ViewConfig shape used by DynamicView and its renderers.
 */

import type { ViewConfig, ViewColumn } from '@/types/views'

/**
 * Adapt a raw backend ViewConfig to the frontend shape.
 * Handles field name differences between backend and frontend types.
 */
export function adaptViewConfig(raw: Record<string, unknown>): ViewConfig {
  const columns = adaptColumns(raw.columns as Record<string, unknown>[] | undefined)

  return {
    id: (raw.id as string) ?? '',
    name: raw.name as string | undefined,
    title: (raw.title as string) ?? '',
    viewType: (raw.viewType ?? raw.view_type ?? 'table') as ViewConfig['viewType'],
    conceptKey: (raw.conceptKey ?? raw.concept_key ?? '') as string,
    columns,
    filters: raw.filters as ViewConfig['filters'],
    sort: raw.sort as ViewConfig['sort'],
    sorts: raw.sorts as ViewConfig['sorts'],
    groupBy: (raw.groupBy ?? raw.group_by) as string | undefined,
    timelineStart: (raw.timelineStart ?? raw.timeline_start) as string | undefined,
    timelineEnd: (raw.timelineEnd ?? raw.timeline_end) as string | undefined,
    dateField: (raw.dateField ?? raw.timelineStart ?? raw.timeline_start) as string | undefined,
    endDateField: (raw.endDateField ?? raw.timelineEnd ?? raw.timeline_end) as string | undefined,
    rowAction: (raw.rowAction ?? raw.row_action) as ViewConfig['rowAction'],
    renderMode: (raw.renderMode ?? raw.render_mode) as ViewConfig['renderMode'],
    tabs: raw.tabs as ViewConfig['tabs'],
    presets: raw.presets as ViewConfig['presets'],
    pageSize: raw.pageSize as number | undefined,
  }
}

function adaptColumns(
  raw: Record<string, unknown>[] | undefined
): ViewColumn[] | undefined {
  if (!raw) return undefined
  return raw.map((col) => ({
    propertyKey: (col.propertyKey ?? col.property_key) as string | undefined,
    key: (col.key ?? col.propertyKey ?? col.property_key) as string | undefined,
    label: col.label as string | undefined,
    sortable: col.sortable as boolean | undefined,
    filterable: col.filterable as boolean | undefined,
    width: col.width as string | undefined,
    type: col.type as string | undefined,
    renderer: col.renderer as string | undefined,
    section: col.section as string | undefined,
    span: col.span as string | undefined,
    editable: col.editable as boolean | undefined,
  }))
}

/**
 * Get the effective property key from a column.
 * Backend uses propertyKey, frontend uses key. This resolves either.
 */
export function getColumnKey(col: ViewColumn): string {
  return col.key ?? col.propertyKey ?? ''
}
