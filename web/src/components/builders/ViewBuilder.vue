<template>
  <div class="view-builder flex flex-col h-full" role="region" aria-label="View Builder">
    <!-- Toolbar -->
    <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-surface-200 bg-white">
      <div class="flex items-center gap-3">
        <i class="pi pi-table text-primary-500" />
        <InputText
          v-model="viewName"
          placeholder="View name"
          class="text-lg font-semibold w-64"
          aria-label="View name"
        />
      </div>

      <div class="flex items-center gap-2">
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
      class="mx-4 mt-2"
      @close="validationError = null"
    >
      {{ validationError }}
    </Message>

    <!-- Preview mode -->
    <div v-if="previewMode" class="flex-1 overflow-y-auto p-6">
      <DynamicView
        :config="builtViewConfig"
        :data="[]"
        :total-records="0"
      />
    </div>

    <!-- Edit mode -->
    <div v-else class="flex-1 flex flex-col overflow-hidden">
      <!-- View type selector -->
      <div class="shrink-0 px-4 py-3 border-b border-surface-200 bg-surface-50">
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
      <div class="flex-1 flex overflow-hidden">
        <!-- Type-specific config -->
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <!-- TABLE config -->
          <template v-if="selectedViewType === 'table'">
            <div>
              <h3 class="text-sm font-semibold text-surface-700 mb-3">Columns</h3>
              <div class="space-y-2">
                <div
                  v-for="(col, idx) in tableColumns"
                  :key="col.key"
                  class="flex items-center gap-3 px-3 py-2 bg-white rounded-md border border-surface-200"
                  draggable="true"
                  @dragstart="() => { columnDragIdx = idx }"
                  @dragover.prevent
                  @drop.prevent="() => handleColumnReorder(idx)"
                >
                  <i class="pi pi-grip-vertical text-xs text-surface-300 cursor-grab" />
                  <span class="text-sm text-surface-700 flex-1">{{ col.label }}</span>
                  <Tag :value="col.type ?? 'text'" rounded class="!text-[10px]" severity="secondary" />
                  <InputText
                    :model-value="col.width ?? ''"
                    placeholder="auto"
                    class="w-20 !text-xs"
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

              <!-- Add column -->
              <div class="mt-3">
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

            <!-- Row action -->
            <div>
              <label class="text-sm font-semibold text-surface-700 block mb-2">
                Row Click Action
              </label>
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
            <div>
              <label class="text-sm font-semibold text-surface-700 block mb-2">
                Group By
              </label>
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
              <h3 class="text-sm font-semibold text-surface-700 mb-3">Card Fields</h3>
              <div class="space-y-2">
                <div
                  v-for="(field, idx) in kanbanCardFields"
                  :key="field"
                  class="flex items-center gap-2 px-3 py-2 bg-white rounded-md border border-surface-200"
                >
                  <span class="text-sm text-surface-700 flex-1">
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
                class="w-full mt-2"
                @change="(e) => addKanbanField(e.value as string)"
              />
            </div>
          </template>

          <!-- TIMELINE config -->
          <template v-if="selectedViewType === 'timeline'">
            <div>
              <label class="text-sm font-semibold text-surface-700 block mb-2">
                Start Date Field
              </label>
              <Select
                v-model="timelineStartField"
                :options="dateProperties"
                option-label="label"
                option-value="key"
                placeholder="Select a date field"
                class="w-full"
              />
            </div>
            <div>
              <label class="text-sm font-semibold text-surface-700 block mb-2">
                End Date Field (optional)
              </label>
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
            <div class="text-center py-12 text-surface-400">
              <i class="pi pi-chart-bar text-3xl mb-3" />
              <p class="text-sm">
                Dashboard widget configuration is managed through the dashboard editor.
              </p>
            </div>
          </template>
        </div>

        <!-- Shared config sidebar: filters, sorts, presets -->
        <div class="w-80 shrink-0 border-l border-surface-200 bg-white overflow-y-auto p-4 space-y-6">
          <!-- Filters -->
          <div>
            <h3 class="text-sm font-semibold text-surface-700 mb-3">Filters</h3>
            <ConditionBuilder
              :model-value="filterCondition"
              :properties="conceptProperties"
              @update:model-value="(v) => { filterCondition = v }"
            />
          </div>

          <!-- Sort -->
          <div>
            <h3 class="text-sm font-semibold text-surface-700 mb-3">Sort</h3>
            <div class="space-y-2">
              <div
                v-for="(sort, idx) in sortRules"
                :key="idx"
                class="flex items-center gap-2"
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
              class="mt-2"
              @click="addSortRule"
            />
          </div>

          <!-- Presets -->
          <div>
            <h3 class="text-sm font-semibold text-surface-700 mb-3">Presets</h3>
            <div class="space-y-2">
              <div
                v-for="(preset, idx) in presets"
                :key="idx"
                class="flex items-center gap-2 px-3 py-2 bg-surface-50 rounded-md border border-surface-200"
              >
                <span class="text-sm text-surface-700 flex-1 truncate">
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
              class="mt-2"
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
