<template>
  <div class="vt-root">
    <!-- Empty state -->
    <div
      v-if="!loading && data.length === 0"
      class="vt-empty"
      role="status"
    >
      <i class="pi pi-table vt-empty-icon" aria-hidden="true" />
      <h3 class="vt-empty-heading">No records found</h3>
      <p class="vt-empty-text">
        Try adjusting your filters or create a new record to get started.
      </p>
    </div>

    <!-- Data table -->
    <div v-else class="vt-table-wrap">
      <DataTable
        :value="data"
        :loading="loading"
        :paginator="totalRecords > pageSize"
        :rows="pageSize"
        :totalRecords="totalRecords"
        :lazy="true"
        stripedRows
        :rowHover="true"
        removableSort
        dataKey="id"
        tableStyle="min-width: 40rem"
        :aria-label="config.title ?? 'Data table'"
        @sort="handleSort"
        @page="handlePage"
        @row-click="handleRowClick"
      >
        <Column
          v-for="col in visibleColumns"
          :key="col.key ?? col.propertyKey"
          :field="col.key ?? col.propertyKey"
          :header="col.label ?? formatLabel(col.key ?? col.propertyKey ?? '')"
          :sortable="col.sortable !== false"
          :style="col.width ? { width: col.width } : undefined"
        >
          <template #body="{ data: row }">
            <span :class="getCellClass(col)">
              {{ formatCellValue(row[col.key ?? col.propertyKey ?? ''], col) }}
            </span>
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'

import type { ViewConfig, ViewColumn, ViewSort } from '@/types/views'

interface Props {
  config: ViewConfig
  data: Record<string, unknown>[]
  totalRecords?: number
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  totalRecords: 0,
  loading: false,
})

const emit = defineEmits<{
  sort: [sort: ViewSort]
  filter: [filter: { field: string; value: unknown }]
  page: [event: { page: number; rows: number }]
  'row-click': [record: Record<string, unknown>]
}>()

const pageSize = computed(() => props.config.pageSize ?? 25)

const visibleColumns = computed<ViewColumn[]>(() => {
  const columns = props.config.columns ?? []
  return columns.filter((col) => col.visible !== false)
})

/** Format a property key into a human-readable label */
function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim()
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function formatCellValue(value: unknown, column: ViewColumn): string {
  if (value === null || value === undefined) return '—'

  const colType = column.type ?? 'text'
  const strValue = String(value)

  // Truncate raw UUIDs to a friendly short form
  if (UUID_PATTERN.test(strValue)) {
    return strValue.substring(0, 8) + '\u2026'
  }

  switch (colType) {
    case 'date':
      try {
        return new Date(strValue).toLocaleDateString()
      } catch {
        return strValue
      }
    case 'datetime':
      try {
        return new Date(strValue).toLocaleString()
      } catch {
        return strValue
      }
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'currency':
      return typeof value === 'number'
        ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        : strValue
    case 'percentage':
      return typeof value === 'number' ? `${value}%` : strValue
    default:
      // Format underscored values (e.g. "department_head" -> "Department Head")
      if (strValue.includes('_')) {
        return strValue.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
      }
      return strValue
  }
}

function getCellClass(column: ViewColumn): string {
  const classes: string[] = []
  if (column.align === 'right') classes.push('text-right')
  if (column.align === 'center') classes.push('text-center')
  if (column.type === 'number' || column.type === 'currency' || column.type === 'percentage') {
    classes.push('tabular-nums')
  }
  return classes.join(' ')
}

function handleSort(event: { sortField?: string | ((item: unknown) => string); sortOrder?: number | null }): void {
  const field = typeof event.sortField === 'string' ? event.sortField : ''
  emit('sort', {
    field,
    direction: event.sortOrder === 1 ? 'asc' : 'desc',
  })
}

function handlePage(event: { page: number; rows: number }): void {
  emit('page', { page: event.page, rows: event.rows })
}

function handleRowClick(event: { data: Record<string, unknown> }): void {
  emit('row-click', event.data)
}
</script>

<style scoped>
.vt-root {
}

/* Table wrapper */
.vt-table-wrap {
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--bg-card);
  box-shadow: var(--shadow-xs);
}

/* Cell alignment */
.vt-cell-right {
  text-align: right;
}

.vt-cell-center {
  text-align: center;
}

.vt-cell-mono {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

/* Empty state */
.vt-empty {
  text-align: center;
  padding: var(--space-16) var(--space-8);
  border: var(--border-medium) dashed var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-50);
}

.vt-empty-icon {
  font-size: var(--text-4xl);
  color: var(--text-muted);
  opacity: 0.35;
  display: block;
  margin-bottom: var(--space-4);
}

.vt-empty-heading {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.vt-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  max-width: 28rem;
  margin-left: auto;
  margin-right: auto;
  line-height: var(--leading-relaxed);
}

/* PrimeVue DataTable overrides within this component */
.vt-table-wrap :deep(.p-datatable) {
}

.vt-table-wrap :deep(.p-datatable-thead > tr > th) {
  font-family: var(--font-display);
  font-weight: var(--weight-semibold);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  background: var(--surface-50);
  color: var(--text-secondary);
  border-bottom: var(--border-medium) solid var(--border-color);
  padding: var(--space-3) var(--space-4);
}

.vt-table-wrap :deep(.p-datatable-tbody > tr) {
  transition: background var(--duration-fast) var(--ease-default);
}

.vt-table-wrap :deep(.p-datatable-tbody > tr:hover) {
  background: var(--primary-50);
}

.vt-table-wrap :deep(.p-datatable-tbody > tr > td) {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-primary);
  border-bottom: var(--border-thin) solid var(--surface-100);
}

.vt-table-wrap :deep(.p-datatable-striped .p-datatable-tbody > tr:nth-child(even)) {
  background: var(--surface-50);
}

.vt-table-wrap :deep(.p-paginator) {
  border-top: var(--border-thin) solid var(--border-color);
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-display);
  font-size: var(--text-sm);
}
</style>
