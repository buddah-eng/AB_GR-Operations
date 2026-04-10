<template>
  <div class="view-table">
    <!-- Empty state -->
    <Message
      v-if="!loading && data.length === 0"
      severity="info"
      :closable="false"
    >
      No records found. Try adjusting your filters or create a new record to
      get started.
    </Message>

    <!-- Data table -->
    <DataTable
      v-else
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
        :key="col.key"
        :field="col.key"
        :header="col.label"
        :sortable="col.sortable !== false"
        :style="col.width ? { width: col.width } : undefined"
        :class="col.align ? `text-${col.align}` : ''"
      >
        <template #body="{ data: row }">
          <span :class="getCellClass(col)">
            {{ formatCellValue(row[col.key], col) }}
          </span>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Message from 'primevue/message'

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

function formatCellValue(value: unknown, column: ViewColumn): string {
  if (value === null || value === undefined) return '—'

  const colType = column.type ?? 'text'
  const strValue = String(value)

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
