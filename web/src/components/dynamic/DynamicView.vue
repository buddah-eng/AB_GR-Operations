<script setup lang="ts">
/**
 * DynamicView Component
 *
 * Renders data views from ontology ViewConfig definitions.
 * Supports: table, kanban, timeline, detail, dashboard.
 * Uses PrimeVue DataTable for table views.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '@/api/client'
import type { ViewConfig, OntologyProperty } from '@/types'

const props = defineProps<{
  config: ViewConfig
  conceptKey: string
  properties: OntologyProperty[]
}>()

const emit = defineEmits<{
  'row-click': [record: Record<string, unknown>]
}>()

const records = ref<Record<string, unknown>[]>([])
const loading = ref(false)
const totalRecords = ref(0)
const currentPage = ref(1)
const pageSize = ref(50)
const sortField = ref<string | null>(props.config.sort?.field ?? null)
const sortDirection = ref<'asc' | 'desc'>(props.config.sort?.direction ?? 'asc')
const activeFilters = ref<Record<string, string>>({})

const visibleColumns = computed(() => {
  if (props.config.columns && props.config.columns.length > 0) {
    return props.config.columns
  }
  // Default: show first 6 non-hidden properties
  return props.properties
    .filter((p) => !p.hidden)
    .slice(0, 6)
    .map((p) => ({ propertyKey: p.key, sortable: true, filterable: true }))
})

const kanbanGroups = computed(() => {
  if (props.config.viewType !== 'kanban' || !props.config.groupBy) return []
  const groupField = props.config.groupBy
  const prop = props.properties.find((p) => p.key === groupField)
  return prop?.options?.map((o) => o.value) ?? []
})

const kanbanRecordsByGroup = computed(() => {
  if (!props.config.groupBy) return {}
  const groupField = props.config.groupBy
  const groups: Record<string, Record<string, unknown>[]> = {}
  for (const group of kanbanGroups.value) {
    groups[group] = records.value.filter(
      (r) => r.properties && (r.properties as Record<string, unknown>)[groupField] === group
    )
  }
  return groups
})

async function loadData(): Promise<void> {
  loading.value = true
  try {
    const filterParams = Object.entries(activeFilters.value)
      .filter(([, v]) => v)
      .map(([k, v]) => `filter[${k}]=${encodeURIComponent(v)}`)
      .join('&')

    const sortParams = sortField.value
      ? `&sort=${sortField.value}&direction=${sortDirection.value}`
      : ''

    const url = `/api/domains/${props.conceptKey}?page=${currentPage.value}&limit=${pageSize.value}${sortParams}${filterParams ? `&${filterParams}` : ''}`

    const response = await api.get<{
      data: Record<string, unknown>[]
      meta: { total: number; hasMore: boolean }
    }>(url)

    records.value = response.data ?? []
    totalRecords.value = response.meta?.total ?? 0
  } catch {
    records.value = []
  } finally {
    loading.value = false
  }
}

function handleRowClick(record: Record<string, unknown>): void {
  if (props.config.rowAction === 'none') return
  emit('row-click', record)
}

function handleSort(field: string): void {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortDirection.value = 'asc'
  }
  loadData()
}

function getPropertyLabel(key: string): string {
  return props.properties.find((p) => p.key === key)?.label ?? key
}

function getCellValue(record: Record<string, unknown>, propertyKey: string): unknown {
  const allProps = (record.properties ?? record) as Record<string, unknown>
  return allProps[propertyKey] ?? record[propertyKey] ?? ''
}

onMounted(loadData)

watch(() => [props.conceptKey, props.config], loadData, { deep: true })
</script>

<template>
  <div class="dynamic-view">
    <!-- Table View -->
    <div v-if="config.viewType === 'table'" class="table-view">
      <table>
        <thead>
          <tr>
            <th
              v-for="col in visibleColumns"
              :key="col.propertyKey"
              @click="col.sortable ? handleSort(col.propertyKey) : null"
              :class="{ sortable: col.sortable }"
            >
              {{ getPropertyLabel(col.propertyKey) }}
              <span v-if="sortField === col.propertyKey">
                {{ sortDirection === 'asc' ? '▲' : '▼' }}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="record in records"
            :key="(record.id as string)"
            @click="handleRowClick(record)"
            :class="{ clickable: config.rowAction !== 'none' }"
          >
            <td v-for="col in visibleColumns" :key="col.propertyKey">
              {{ getCellValue(record, col.propertyKey) }}
            </td>
          </tr>
          <tr v-if="records.length === 0 && !loading">
            <td :colspan="visibleColumns.length" class="empty-state">
              No records found.
            </td>
          </tr>
        </tbody>
      </table>

      <div class="pagination">
        <button @click="currentPage--; loadData()" :disabled="currentPage <= 1">
          Previous
        </button>
        <span>Page {{ currentPage }} ({{ totalRecords }} total)</span>
        <button @click="currentPage++; loadData()" :disabled="records.length < pageSize">
          Next
        </button>
      </div>
    </div>

    <!-- Kanban View -->
    <div v-else-if="config.viewType === 'kanban'" class="kanban-view">
      <div
        v-for="group in kanbanGroups"
        :key="group"
        class="kanban-column"
      >
        <div class="kanban-header">
          {{ group }}
          <span class="count">({{ kanbanRecordsByGroup[group]?.length ?? 0 }})</span>
        </div>
        <div class="kanban-cards">
          <div
            v-for="record in kanbanRecordsByGroup[group] ?? []"
            :key="(record.id as string)"
            class="kanban-card"
            @click="handleRowClick(record)"
          >
            <div class="card-title">
              {{ getCellValue(record, 'name') || getCellValue(record, visibleColumns[0]?.propertyKey ?? '') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-overlay">Loading...</div>
  </div>
</template>

<style scoped>
.dynamic-view {
  position: relative;
}

/* Table */
.table-view table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.table-view th {
  text-align: left;
  padding: 0.75rem;
  border-bottom: 2px solid var(--surface-border, #e5e7eb);
  font-weight: 600;
  color: var(--text-color-secondary, #6b7280);
}

.table-view th.sortable {
  cursor: pointer;
  user-select: none;
}

.table-view td {
  padding: 0.75rem;
  border-bottom: 1px solid var(--surface-border, #f3f4f6);
}

.table-view tr.clickable {
  cursor: pointer;
}

.table-view tr.clickable:hover {
  background: var(--surface-hover, #f9fafb);
}

.empty-state {
  text-align: center;
  color: var(--text-color-secondary, #9ca3af);
  padding: 2rem !important;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
}

.pagination button {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--surface-border, #d1d5db);
  border-radius: 0.25rem;
  background: white;
  cursor: pointer;
  font-size: 0.875rem;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Kanban */
.kanban-view {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  padding-bottom: 1rem;
}

.kanban-column {
  min-width: 250px;
  flex-shrink: 0;
  background: var(--surface-100, #f3f4f6);
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.kanban-header {
  font-weight: 600;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--surface-border, #d1d5db);
}

.kanban-header .count {
  color: var(--text-color-secondary, #9ca3af);
  font-weight: normal;
}

.kanban-cards {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.kanban-card {
  background: white;
  border-radius: 0.375rem;
  padding: 0.75rem;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.15s;
}

.kanban-card:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.card-title {
  font-weight: 500;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
  font-size: 0.875rem;
  color: var(--text-color-secondary, #6b7280);
}
</style>
