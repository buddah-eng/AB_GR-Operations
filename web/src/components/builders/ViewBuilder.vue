<template>
  <div class="builder-shell" role="region" aria-label="View Builder">
    <!-- Toolbar -->
    <div class="builder-toolbar">
      <div class="builder-toolbar__left">
        <i class="pi pi-table builder-toolbar__icon" />
        <InputText
          v-model="viewName"
          placeholder="View name"
          class="builder-toolbar__name-input"
          aria-label="View name"
        />
      </div>

      <div class="builder-toolbar__right">
        <ToggleButton
          v-model="previewMode"
          on-label="Preview"
          off-label="Edit"
          on-icon="pi pi-eye"
          off-icon="pi pi-pencil"
          aria-label="Toggle preview mode"
        />
        <Button
          label="Save"
          icon="pi pi-save"
          :loading="saving"
          :disabled="saving"
          @click="handleSave"
        />
      </div>
    </div>

    <!-- Error -->
    <Message
      v-if="validationError"
      severity="error"
      :closable="true"
      class="builder-message"
      @close="validationError = null"
    >
      {{ validationError }}
    </Message>

    <!-- Preview mode -->
    <div v-if="previewMode" class="builder-preview">
      <DynamicView
        :config="builtViewConfig"
        :data="[]"
        :total-records="0"
      />
    </div>

    <!-- Edit mode -->
    <div v-else class="builder-edit-shell">
      <!-- View type selector -->
      <div class="builder-type-bar">
        <SelectButton
          v-model="selectedViewType"
          :options="viewTypeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          aria-label="View type"
        />
      </div>

      <!-- Config panels -->
      <div class="builder-panels">
        <!-- Type-specific config -->
        <div class="builder-main-config">
          <!-- TABLE config -->
          <template v-if="selectedViewType === 'table'">
            <div>
              <h3 class="section-header">Columns</h3>
              <div class="builder-column-list">
                <div
                  v-for="(col, idx) in tableColumns"
                  :key="col.key"
                  class="builder-column-item"
                  draggable="true"
                  @dragstart="() => { columnDragIdx = idx }"
                  @dragover.prevent
                  @drop.prevent="() => handleColumnReorder(idx)"
                >
                  <i class="pi pi-grip-vertical builder-grip" />
                  <span class="builder-column-item__label">{{ col.label }}</span>
                  <Tag :value="col.type ?? 'text'" rounded class="!text-[10px]" severity="secondary" />
                  <InputText
                    :model-value="col.width ?? ''"
                    placeholder="auto"
                    class="builder-column-item__width"
                    aria-label="Column width"
                    @update:model-value="(v) => updateColumnWidth(idx, String(v))"
                  />
                  <ToggleButton
                    :model-value="col.visible !== false"
                    on-icon="pi pi-eye"
                    off-icon="pi pi-eye-slash"
                    class="!p-1 !text-xs"
                    :aria-label="col.visible !== false ? 'Hide column' : 'Show column'"
                    @update:model-value="(v: boolean) => toggleColumnVisible(idx, v)"
                  />
                  <Button
                    icon="pi pi-times"
                    severity="danger"
                    text
                    rounded
                    size="small"
                    class="!p-1"
                    aria-label="Remove column"
                    @click="removeColumn(idx)"
                  />
                </div>
              </div>

              <div class="builder-add-column">
                <Select
                  :options="availableColumnProps"
                  option-label="label"
                  option-value="key"
                  placeholder="Add column..."
                  class="w-full"
                  @change="(e) => addColumn(e.value as string)"
                />
              </div>
            </div>

            <div class="form-field">
              <label>Row Click Action</label>
              <Select
                v-model="rowAction"
                :options="rowActionOptions"
                option-label="label"
                option-value="value"
                class="w-full"
              />
            </div>
          </template>

          <!-- KANBAN config -->
          <template v-if="selectedViewType === 'kanban'">
            <div class="form-field">
              <label>Group By</label>
              <Select
                v-model="groupByField"
                :options="selectStatusProperties"
                option-label="label"
                option-value="key"
                placeholder="Select a status/select field"
                class="w-full"
              />
            </div>
            <div>
              <h3 class="section-header">Card Fields</h3>
              <div class="builder-column-list">
                <div
                  v-for="(field, idx) in kanbanCardFields"
                  :key="field"
                  class="builder-column-item"
                >
                  <span class="builder-column-item__label">
                    {{ getPropertyLabel(field) }}
                  </span>
                  <Button
                    icon="pi pi-times"
                    severity="danger"
                    text
                    rounded
                    size="small"
                    class="!p-1"
                    @click="removeKanbanField(idx)"
                  />
                </div>
              </div>
              <Select
                :options="conceptProperties"
                option-label="label"
                option-value="key"
                placeholder="Add card field..."
                class="w-full"
                style="margin-top: var(--space-2)"
                @change="(e) => addKanbanField(e.value as string)"
              />
            </div>
          </template>

          <!-- TIMELINE config -->
          <template v-if="selectedViewType === 'timeline'">
            <div class="form-field">
              <label>Start Date Field</label>
              <Select
                v-model="timelineStartField"
                :options="dateProperties"
                option-label="label"
                option-value="key"
                placeholder="Select a date field"
                class="w-full"
              />
            </div>
            <div class="form-field">
              <label>End Date Field (optional)</label>
              <Select
                v-model="timelineEndField"
                :options="dateProperties"
                option-label="label"
                option-value="key"
                placeholder="Select a date field"
                class="w-full"
                show-clear
              />
            </div>
          </template>

          <!-- DASHBOARD config -->
          <template v-if="selectedViewType === 'dashboard'">
            <div class="empty-state">
              <div class="icon">
                <i class="pi pi-chart-bar" />
              </div>
              <p>Dashboard widget configuration is managed through the dashboard editor.</p>
            </div>
          </template>
        </div>

        <!-- Shared config sidebar -->
        <div class="builder-sidebar builder-sidebar--right">
          <div class="builder-sidebar-section">
            <h3 class="section-header">Filters</h3>
            <ConditionBuilder
              :model-value="filterCondition"
              :properties="conceptProperties"
              @update:model-value="(v) => { filterCondition = v }"
            />
          </div>

          <div class="builder-sidebar-section">
            <h3 class="section-header">Sort</h3>
            <div class="builder-sort-list">
              <div
                v-for="(sort, idx) in sortRules"
                :key="idx"
                class="builder-sort-row"
              >
                <Select
                  :model-value="sort.field"
                  :options="conceptProperties"
                  option-label="label"
                  option-value="key"
                  placeholder="Field"
                  class="flex-1"
                  @update:model-value="(v) => updateSortField(idx, v as string)"
                />
                <SelectButton
                  :model-value="sort.direction"
                  :options="sortDirectionOptions"
                  option-label="label"
                  option-value="value"
                  :allow-empty="false"
                  @update:model-value="(v) => updateSortDirection(idx, v as 'asc' | 'desc')"
                />
                <Button
                  icon="pi pi-times"
                  severity="danger"
                  text
                  rounded
                  size="small"
                  class="!p-1"
                  @click="removeSortRule(idx)"
                />
              </div>
            </div>
            <Button
              label="Add Sort"
              icon="pi pi-plus"
              severity="secondary"
              text
              size="small"
              style="margin-top: var(--space-2)"
              @click="addSortRule"
            />
          </div>

          <div class="builder-sidebar-section">
            <h3 class="section-header">Presets</h3>
            <div class="builder-preset-list">
              <div
                v-for="(preset, idx) in presets"
                :key="idx"
                class="builder-preset-item"
              >
                <span class="builder-preset-item__name">
                  {{ preset.name }}
                </span>
                <Button
                  icon="pi pi-times"
                  severity="danger"
                  text
                  rounded
                  size="small"
                  class="!p-1"
                  @click="removePreset(idx)"
                />
              </div>
            </div>
            <Button
              label="Save Current as Preset"
              icon="pi pi-bookmark"
              severity="secondary"
              text
              size="small"
              style="margin-top: var(--space-2)"
              @click="savePreset"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Message from 'primevue/message'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleButton from 'primevue/togglebutton'

import type { OntologyProperty } from '@/types'
import type { ConditionExpression } from '@/types/forms'
import type {
  ViewConfig,
  ViewColumn,
  ViewPreset,
  ViewType,
  SortDirection,
} from '@/types/views'
import { useOntologyStore } from '@/stores/ontology'
import { api } from '@/api/client'
import DynamicView from '@/components/views/DynamicView.vue'
import ConditionBuilder from '@/components/conditions/ConditionBuilder.vue'

/* ---- Route & Store ---- */

const route = useRoute()
const ontologyStore = useOntologyStore()

const conceptKey = computed(() => String(route.params.conceptKey ?? ''))

/* ---- Builder state ---- */

const viewName = ref('New View')
const selectedViewType = ref<ViewType>('table')
const previewMode = ref(false)
const saving = ref(false)
const validationError = ref<string | null>(null)
const viewId = ref<string | null>(null)

// Table
const tableColumns = ref<ViewColumn[]>([])
const rowAction = ref<string>('navigate_to_detail')
let columnDragIdx: number | null = null

// Kanban
const groupByField = ref<string | undefined>(undefined)
const kanbanCardFields = ref<string[]>([])

// Timeline
const timelineStartField = ref<string | undefined>(undefined)
const timelineEndField = ref<string | undefined>(undefined)

// Shared
const filterCondition = ref<ConditionExpression | null>(null)
const sortRules = ref<Array<{ field: string; direction: SortDirection }>>([])
const presets = ref<ViewPreset[]>([])

/* ---- Options ---- */

const viewTypeOptions = [
  { label: 'Table', value: 'table' as ViewType },
  { label: 'Kanban', value: 'kanban' as ViewType },
  { label: 'Timeline', value: 'timeline' as ViewType },
  { label: 'Dashboard', value: 'dashboard' as ViewType },
]

const rowActionOptions = [
  { label: 'Navigate to detail', value: 'navigate_to_detail' },
  { label: 'Inline edit', value: 'inline_edit' },
  { label: 'None', value: 'none' },
]

const sortDirectionOptions = [
  { label: 'Asc', value: 'asc' as SortDirection },
  { label: 'Desc', value: 'desc' as SortDirection },
]

/* ---- Properties ---- */

const conceptProperties = computed<OntologyProperty[]>(() =>
  ontologyStore.getPropertiesForConcept(conceptKey.value),
)

const selectStatusProperties = computed(() =>
  conceptProperties.value.filter(
    (p) => p.type === 'select' || p.type === 'status',
  ),
)

const dateProperties = computed(() =>
  conceptProperties.value.filter(
    (p) => p.type === 'date' || p.type === 'datetime',
  ),
)

const availableColumnProps = computed(() =>
  conceptProperties.value.filter(
    (p) => !tableColumns.value.some((c) => c.key === p.key),
  ),
)

function getPropertyLabel(key: string): string {
  const prop = conceptProperties.value.find((p) => p.key === key)
  return prop?.label ?? key
}

/* ---- Table column management ---- */

function addColumn(key: string): void {
  const prop = conceptProperties.value.find((p) => p.key === key)
  if (!prop) return
  tableColumns.value = [
    ...tableColumns.value,
    {
      key: prop.key,
      label: prop.label,
      type: prop.type,
      visible: true,
      sortable: true,
    },
  ]
}

function removeColumn(idx: number): void {
  tableColumns.value = tableColumns.value.filter((_, i) => i !== idx)
}

function updateColumnWidth(idx: number, width: string): void {
  tableColumns.value = tableColumns.value.map((c, i) =>
    i === idx ? { ...c, width: width || undefined } : c,
  )
}

function toggleColumnVisible(idx: number, visible: boolean): void {
  tableColumns.value = tableColumns.value.map((c, i) =>
    i === idx ? { ...c, visible } : c,
  )
}

function handleColumnReorder(targetIdx: number): void {
  if (columnDragIdx === null || columnDragIdx === targetIdx) {
    columnDragIdx = null
    return
  }
  const cols = [...tableColumns.value]
  const [moved] = cols.splice(columnDragIdx, 1)
  cols.splice(targetIdx, 0, moved)
  tableColumns.value = cols
  columnDragIdx = null
}

/* ---- Kanban management ---- */

function addKanbanField(key: string): void {
  if (!kanbanCardFields.value.includes(key)) {
    kanbanCardFields.value = [...kanbanCardFields.value, key]
  }
}

function removeKanbanField(idx: number): void {
  kanbanCardFields.value = kanbanCardFields.value.filter((_, i) => i !== idx)
}

/* ---- Sort management ---- */

function addSortRule(): void {
  const firstProp = conceptProperties.value[0]
  if (!firstProp) return
  sortRules.value = [
    ...sortRules.value,
    { field: firstProp.key, direction: 'asc' },
  ]
}

function removeSortRule(idx: number): void {
  sortRules.value = sortRules.value.filter((_, i) => i !== idx)
}

function updateSortField(idx: number, field: string): void {
  sortRules.value = sortRules.value.map((s, i) =>
    i === idx ? { ...s, field } : s,
  )
}

function updateSortDirection(idx: number, direction: SortDirection): void {
  sortRules.value = sortRules.value.map((s, i) =>
    i === idx ? { ...s, direction } : s,
  )
}

/* ---- Presets ---- */

function savePreset(): void {
  const name = `Preset ${presets.value.length + 1}`
  const preset: ViewPreset = {
    id: crypto.randomUUID(),
    name,
    viewType: selectedViewType.value,
    filters: filterCondition.value
      ? [{ field: '', operator: '', value: '' }]
      : undefined,
    sorts: sortRules.value.map((s) => ({ ...s })),
    groupBy: groupByField.value,
  }
  presets.value = [...presets.value, preset]
}

function removePreset(idx: number): void {
  presets.value = presets.value.filter((_, i) => i !== idx)
}

/* ---- Built config ---- */

const builtViewConfig = computed<ViewConfig>(() => {
  return {
    id: viewId.value ?? 'preview',
    title: viewName.value,
    viewType: selectedViewType.value,
    conceptKey: conceptKey.value,
    columns: selectedViewType.value === 'table' ? tableColumns.value : undefined,
    groupBy: selectedViewType.value === 'kanban' ? groupByField.value : undefined,
    dateField: selectedViewType.value === 'timeline' ? timelineStartField.value : undefined,
    endDateField: selectedViewType.value === 'timeline' ? timelineEndField.value : undefined,
    filterCondition: filterCondition.value ?? undefined,
    sorts: sortRules.value.map((s) => ({ ...s })),
    presets: presets.value,
  }
})

/* ---- Save ---- */

async function handleSave(): Promise<void> {
  // Validate kanban groupBy type
  if (selectedViewType.value === 'kanban' && groupByField.value) {
    const prop = conceptProperties.value.find((p) => p.key === groupByField.value)
    if (prop && prop.type !== 'select' && prop.type !== 'status') {
      validationError.value = `groupBy property '${prop.label}' must be select or status type`
      return
    }
  }

  // Validate timeline fields
  if (selectedViewType.value === 'timeline') {
    if (timelineStartField.value) {
      const prop = conceptProperties.value.find((p) => p.key === timelineStartField.value)
      if (prop && prop.type !== 'date' && prop.type !== 'datetime') {
        validationError.value = `Timeline start field '${prop.label}' must be date or datetime type`
        return
      }
    }
  }

  saving.value = true
  validationError.value = null

  try {
    const config = builtViewConfig.value
    if (viewId.value) {
      await api.put(`/api/view-configs/${viewId.value}`, config)
    } else {
      const result = await api.post<{ id: string }>('/api/view-configs', config)
      viewId.value = result.id
    }
  } catch (err) {
    validationError.value =
      err instanceof Error ? err.message : 'Failed to save view configuration'
  } finally {
    saving.value = false
  }
}

/* ---- Load existing config ---- */

async function loadExistingConfig(): Promise<void> {
  if (!conceptKey.value) return

  try {
    const configs = await api.get<ViewConfig[]>(
      `/api/view-configs?conceptKey=${conceptKey.value}`,
    )
    if (configs.length > 0) {
      const config = configs[0]
      viewId.value = config.id
      viewName.value = config.title
      selectedViewType.value = config.viewType
      tableColumns.value = config.columns ?? []
      groupByField.value = config.groupBy
      timelineStartField.value = config.dateField
      timelineEndField.value = config.endDateField
      filterCondition.value = config.filterCondition ?? null
      sortRules.value = (config.sorts ?? []).map((s) => ({ ...s }))
      presets.value = config.presets ?? []
    }
  } catch {
    // No existing config
  }
}

/* ---- Reset type-specific config on type change ---- */

watch(selectedViewType, () => {
  // Preserve shared config (filters, sort), reset type-specific
  tableColumns.value = []
  groupByField.value = undefined
  kanbanCardFields.value = []
  timelineStartField.value = undefined
  timelineEndField.value = undefined
})

/* ---- Lifecycle ---- */

onMounted(async () => {
  await ontologyStore.loadOntology()
  await loadExistingConfig()
})
</script>

<style scoped>
.builder-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-page);
}

.builder-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);
  border-bottom: var(--border-thin) solid var(--border-color);
  background: var(--bg-card);
}

.builder-toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.builder-toolbar__icon {
  color: var(--primary-500);
  font-size: var(--text-lg);
}

.builder-toolbar__name-input {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  width: 16rem;
  letter-spacing: var(--tracking-tight);
}

.builder-toolbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.builder-message {
  margin: var(--space-2) var(--space-5) 0;
}

.builder-preview {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-8);
}

.builder-edit-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.builder-type-bar {
  flex-shrink: 0;
  padding: var(--space-3) var(--space-5);
  border-bottom: var(--border-thin) solid var(--border-color);
  background: var(--surface-50);
}

.builder-panels {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.builder-main-config {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.builder-sidebar {
  flex-shrink: 0;
}

.builder-sidebar--right {
  width: 20rem;
  border-left: var(--border-thin) solid var(--border-color);
  background: var(--bg-card);
  overflow-y: auto;
  padding: var(--space-5);
}

.builder-sidebar-section {
  margin-bottom: var(--space-6);
}

.builder-column-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.builder-column-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: var(--border-thin) solid var(--border-color);
  transition: all var(--duration-fast) var(--ease-default);
}

.builder-column-item:hover {
  border-color: var(--surface-300);
  box-shadow: var(--shadow-xs);
}

.builder-column-item__label {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-primary);
  flex: 1;
}

.builder-column-item__width {
  width: 5rem;
  font-size: var(--text-xs) !important;
}

.builder-grip {
  font-size: var(--text-xs);
  color: var(--surface-300);
  cursor: grab;
}

.builder-add-column {
  margin-top: var(--space-3);
}

.builder-sort-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.builder-sort-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.builder-preset-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.builder-preset-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--surface-50);
  border-radius: var(--radius-md);
  border: var(--border-thin) solid var(--border-color);
}

.builder-preset-item__name {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
