<template>
  <div class="form-builder flex flex-col h-full" role="region" aria-label="Form Builder">
    <!-- Toolbar -->
    <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-surface-200 bg-white">
      <div class="flex items-center gap-3">
        <i class="pi pi-pencil text-primary-500" />
        <InputText
          v-model="formName"
          placeholder="Form name"
          class="text-lg font-semibold w-64"
          aria-label="Form name"
        />
      </div>

      <div class="flex items-center gap-2">
        <!-- Layout picker -->
        <SelectButton
          v-model="selectedLayout"
          :options="layoutOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          aria-label="Layout mode"
        />

        <!-- Preview toggle -->
        <ToggleButton
          v-model="previewMode"
          on-label="Preview"
          off-label="Edit"
          on-icon="pi pi-eye"
          off-icon="pi pi-pencil"
          aria-label="Toggle preview mode"
        />

        <!-- Save -->
        <Button
          label="Save"
          icon="pi pi-save"
          :loading="saving"
          :disabled="saving"
          @click="handleSave"
        />
      </div>
    </div>

    <!-- Validation warnings -->
    <div
      v-if="validationWarnings.length > 0"
      class="shrink-0 px-4 py-2 bg-yellow-50 border-b border-yellow-200"
    >
      <div
        v-for="(warning, idx) in validationWarnings"
        :key="idx"
        class="flex items-center gap-2 text-sm text-yellow-700"
      >
        <i class="pi pi-exclamation-triangle text-yellow-500" />
        <span>{{ warning }}</span>
      </div>
    </div>

    <!-- Validation errors -->
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
      <div class="max-w-3xl mx-auto">
        <DynamicForm
          :config="previewConfig"
          :properties="conceptProperties"
          :initial-values="{}"
          @submit="() => {}"
        />
      </div>
    </div>

    <!-- Edit mode: 3-panel layout -->
    <div v-else class="flex-1 flex overflow-hidden">
      <!-- Left: Property list -->
      <div class="w-64 shrink-0 border-r border-surface-200 bg-surface-50 flex flex-col">
        <div class="p-3 border-b border-surface-200">
          <InputText
            v-model="propertySearch"
            placeholder="Search properties..."
            class="w-full"
            aria-label="Search properties"
          />
          <div class="text-xs text-surface-400 mt-2">
            {{ unplacedCount }} unplaced
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-2 space-y-1">
          <div
            v-for="prop in filteredProperties"
            :key="prop.key"
            :class="[
              'flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-grab transition-colors',
              isPropertyPlaced(prop.key)
                ? 'bg-surface-100 text-surface-400'
                : 'bg-white border border-surface-200 hover:border-primary-300 text-surface-700',
            ]"
            draggable="true"
            :aria-label="`Drag ${prop.label} to canvas`"
            @dragstart="(e) => handlePropertyDragStart(e, prop)"
          >
            <i
              v-if="isPropertyPlaced(prop.key)"
              class="pi pi-check text-xs text-green-500"
            />
            <i v-else class="pi pi-grip-vertical text-xs text-surface-300" />
            <span class="truncate">{{ prop.label }}</span>
            <Tag
              :value="prop.type"
              rounded
              class="!text-[10px] ml-auto shrink-0"
              severity="secondary"
            />
          </div>

          <!-- Empty property list -->
          <div
            v-if="filteredProperties.length === 0"
            class="text-center py-8 text-sm text-surface-400"
          >
            No properties found.
          </div>
        </div>
      </div>

      <!-- Center: Form canvas -->
      <div class="flex-1 overflow-y-auto p-6 bg-surface-50">
        <!-- Wizard step navigator -->
        <div
          v-if="selectedLayout === 'wizard'"
          class="flex items-center gap-2 mb-6 p-3 bg-white rounded-lg border border-surface-200"
        >
          <div
            v-for="(section, sIdx) in sections"
            :key="sIdx"
            :class="[
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors',
              activeSection === sIdx
                ? 'bg-primary-500 text-white'
                : 'bg-surface-100 text-surface-600 hover:bg-surface-200',
            ]"
            @click="activeSection = sIdx"
          >
            <span class="font-medium">Step {{ sIdx + 1 }}:</span>
            <span>{{ section.title }}</span>
          </div>
          <Button
            icon="pi pi-plus"
            severity="secondary"
            text
            rounded
            size="small"
            aria-label="Add step"
            @click="addSection"
          />
        </div>

        <!-- Sections (or single section for non-wizard) -->
        <div
          v-for="(section, sIdx) in visibleSections"
          :key="sIdx"
          class="mb-6"
        >
          <!-- Section header (editable) -->
          <div
            v-if="sections.length > 1 || selectedLayout === 'wizard'"
            class="flex items-center gap-2 mb-3"
          >
            <InputText
              v-model="section.title"
              class="text-sm font-semibold flex-1"
              :placeholder="`Section ${sIdx + 1}`"
            />
            <Button
              v-if="sections.length > 1"
              icon="pi pi-trash"
              severity="danger"
              text
              rounded
              size="small"
              aria-label="Remove section"
              @click="removeSection(sIdx)"
            />
          </div>

          <!-- Drop zone -->
          <div
            :class="[
              'min-h-[120px] rounded-lg border-2 border-dashed p-4 transition-colors',
              dragOverSection === sIdx
                ? 'border-primary-400 bg-primary-50'
                : 'border-surface-200 bg-white',
              selectedLayout === 'two-column'
                ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
                : 'space-y-3',
            ]"
            @dragover.prevent="dragOverSection = sIdx"
            @dragleave="dragOverSection = null"
            @drop="(e) => handleDrop(e, sIdx)"
          >
            <!-- Placed fields -->
            <div
              v-for="(field, fIdx) in section.fields"
              :key="field.key"
              :class="[
                'flex items-center gap-2 px-3 py-2.5 rounded-md border cursor-pointer transition-all',
                selectedFieldKey === field.key
                  ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200'
                  : 'border-surface-200 bg-surface-50 hover:border-surface-300',
                selectedLayout === 'two-column' && field.colSpan === 2
                  ? 'md:col-span-2'
                  : '',
              ]"
              draggable="true"
              @click="selectedFieldKey = field.key"
              @dragstart="(e) => handleFieldDragStart(e, sIdx, fIdx)"
              @dragover.prevent
              @drop.stop="(e) => handleFieldReorder(e, sIdx, fIdx)"
            >
              <i class="pi pi-grip-vertical text-xs text-surface-300 cursor-grab" />
              <span class="text-sm font-medium text-surface-700 truncate">
                {{ field.label || getPropertyLabel(field.key) }}
              </span>
              <div class="ml-auto flex items-center gap-1.5 shrink-0">
                <i
                  v-if="field.showIf"
                  class="pi pi-eye text-[10px] text-blue-400"
                  title="Has visibility condition"
                />
                <Tag
                  v-if="field.colSpan === 2"
                  value="full"
                  rounded
                  class="!text-[10px]"
                  severity="secondary"
                />
                <Button
                  icon="pi pi-times"
                  severity="danger"
                  text
                  rounded
                  size="small"
                  class="!p-1"
                  aria-label="Remove field"
                  @click.stop="removeField(sIdx, fIdx)"
                />
              </div>
            </div>

            <!-- Empty drop zone hint -->
            <div
              v-if="section.fields.length === 0"
              :class="[
                'flex flex-col items-center justify-center py-8 text-surface-400',
                selectedLayout === 'two-column' ? 'md:col-span-2' : '',
              ]"
            >
              <i class="pi pi-inbox text-2xl mb-2" />
              <p class="text-sm">Drop properties here to add fields</p>
            </div>
          </div>
        </div>

        <!-- Add section button (non-wizard) -->
        <Button
          v-if="selectedLayout !== 'wizard'"
          label="Add Section"
          icon="pi pi-plus"
          severity="secondary"
          outlined
          size="small"
          class="mt-2"
          @click="addSection"
        />
      </div>

      <!-- Right: Field config panel -->
      <div class="w-80 shrink-0 border-l border-surface-200 bg-white overflow-y-auto">
        <div v-if="selectedField" class="p-4 space-y-4">
          <div class="text-sm font-semibold text-surface-800 pb-2 border-b border-surface-100">
            Field Configuration
          </div>

          <!-- Label override -->
          <div>
            <label class="text-xs font-medium text-surface-500 block mb-1">
              Label
            </label>
            <InputText
              v-model="selectedField.label"
              :placeholder="getPropertyLabel(selectedField.key)"
              class="w-full"
            />
          </div>

          <!-- Placeholder -->
          <div>
            <label class="text-xs font-medium text-surface-500 block mb-1">
              Placeholder
            </label>
            <InputText
              v-model="selectedField.placeholder"
              placeholder="Placeholder text"
              class="w-full"
            />
          </div>

          <!-- Help text -->
          <div>
            <label class="text-xs font-medium text-surface-500 block mb-1">
              Help Text
            </label>
            <InputText
              v-model="selectedField.helpText"
              placeholder="Help text shown below field"
              class="w-full"
            />
          </div>

          <!-- ColSpan (two-column only) -->
          <div v-if="selectedLayout === 'two-column'">
            <label class="text-xs font-medium text-surface-500 block mb-1">
              Column Span
            </label>
            <SelectButton
              :model-value="selectedField.colSpan ?? 1"
              :options="colSpanOptions"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              @update:model-value="(v: 1 | 2) => { if (selectedField) selectedField.colSpan = v }"
            />
          </div>

          <!-- Required -->
          <div class="flex items-center justify-between">
            <label class="text-xs font-medium text-surface-500">
              Required
            </label>
            <ToggleButton
              :model-value="selectedField.required ?? false"
              on-label="Yes"
              off-label="No"
              class="!text-xs"
              @update:model-value="(v: boolean) => { if (selectedField) selectedField.required = v }"
            />
          </div>

          <!-- Read only -->
          <div class="flex items-center justify-between">
            <label class="text-xs font-medium text-surface-500">
              Read Only
            </label>
            <ToggleButton
              :model-value="selectedField.readOnly ?? false"
              on-label="Yes"
              off-label="No"
              class="!text-xs"
              @update:model-value="(v: boolean) => { if (selectedField) selectedField.readOnly = v }"
            />
          </div>

          <!-- ShowIf condition -->
          <div>
            <label class="text-xs font-medium text-surface-500 block mb-1">
              Visibility Condition
            </label>
            <ConditionBuilder
              :model-value="selectedField.showIf ?? null"
              :properties="conceptProperties"
              @update:model-value="(v) => { if (selectedField) selectedField.showIf = v ?? undefined }"
            />
          </div>
        </div>

        <!-- No field selected -->
        <div
          v-else
          class="flex flex-col items-center justify-center h-full text-surface-400 p-4"
        >
          <i class="pi pi-arrow-left text-2xl mb-2" />
          <p class="text-sm text-center">
            Click a field on the canvas to configure it
          </p>
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
import SelectButton from 'primevue/selectbutton'
import ToggleButton from 'primevue/togglebutton'

import type { OntologyProperty } from '@/types'
import type { FormConfig, FormFieldConfig, FormLayout, ConditionExpression } from '@/types/forms'
import { useOntologyStore } from '@/stores/ontology'
import { api } from '@/api/client'
import DynamicForm from '@/components/forms/DynamicForm.vue'
import ConditionBuilder from '@/components/conditions/ConditionBuilder.vue'

/* ---- Route & Store ---- */

const route = useRoute()
const ontologyStore = useOntologyStore()

const conceptKey = computed(() => String(route.params.conceptKey ?? ''))

/* ---- Builder state ---- */

interface BuilderField {
  key: string
  label?: string
  placeholder?: string
  helpText?: string
  colSpan?: 1 | 2
  showIf?: ConditionExpression
  required?: boolean
  readOnly?: boolean
  defaultValue?: unknown
}

interface BuilderSection {
  title: string
  fields: BuilderField[]
}

const formName = ref('New Form')
const selectedLayout = ref<FormLayout>('single-column')
const previewMode = ref(false)
const saving = ref(false)
const validationError = ref<string | null>(null)
const propertySearch = ref('')
const selectedFieldKey = ref<string | null>(null)
const dragOverSection = ref<number | null>(null)
const activeSection = ref(0)
const formId = ref<string | null>(null)

const sections = ref<BuilderSection[]>([
  { title: 'Section 1', fields: [] },
])

/* ---- Layout options ---- */

const layoutOptions = [
  { label: 'Single', value: 'single-column' as FormLayout },
  { label: 'Two Column', value: 'two-column' as FormLayout },
  { label: 'Wizard', value: 'wizard' as FormLayout },
]

const colSpanOptions = [
  { label: '1 col', value: 1 as const },
  { label: '2 cols', value: 2 as const },
]

/* ---- Properties ---- */

const conceptProperties = computed<OntologyProperty[]>(() =>
  ontologyStore.getPropertiesForConcept(conceptKey.value),
)

const filteredProperties = computed(() => {
  const query = propertySearch.value.toLowerCase().trim()
  const props = conceptProperties.value
  if (!query) return props
  return props.filter(
    (p) =>
      p.label.toLowerCase().includes(query) ||
      p.key.toLowerCase().includes(query),
  )
})

const placedKeys = computed<ReadonlySet<string>>(() => {
  const keys = new Set<string>()
  for (const section of sections.value) {
    for (const field of section.fields) {
      keys.add(field.key)
    }
  }
  return keys
})

const unplacedCount = computed(
  () => conceptProperties.value.filter((p) => !placedKeys.value.has(p.key)).length,
)

function isPropertyPlaced(key: string): boolean {
  return placedKeys.value.has(key)
}

function getPropertyLabel(key: string): string {
  const prop = conceptProperties.value.find((p) => p.key === key)
  return prop?.label ?? key
}

/* ---- Selected field ---- */

const selectedField = computed<BuilderField | null>(() => {
  if (!selectedFieldKey.value) return null
  for (const section of sections.value) {
    const found = section.fields.find((f) => f.key === selectedFieldKey.value)
    if (found) return found
  }
  return null
})

/* ---- Visible sections ---- */

const visibleSections = computed(() => {
  if (selectedLayout.value === 'wizard') {
    return sections.value.slice(activeSection.value, activeSection.value + 1)
  }
  return sections.value
})

/* ---- Validation warnings ---- */

const validationWarnings = computed<string[]>(() => {
  const warnings: string[] = []
  for (const section of sections.value) {
    for (const field of section.fields) {
      const prop = conceptProperties.value.find((p) => p.key === field.key)
      if (prop?.hidden) {
        warnings.push(
          `Field '${field.label ?? prop.label}' references deprecated property '${field.key}'. Remove or replace it.`,
        )
      }
    }
  }
  return warnings
})

/* ---- Drag & drop ---- */

let dragPropertyKey: string | null = null
let dragFieldSource: { sectionIdx: number; fieldIdx: number } | null = null

function handlePropertyDragStart(event: DragEvent, prop: OntologyProperty): void {
  dragPropertyKey = prop.key
  dragFieldSource = null
  event.dataTransfer?.setData('text/plain', prop.key)
}

function handleFieldDragStart(
  event: DragEvent,
  sectionIdx: number,
  fieldIdx: number,
): void {
  dragPropertyKey = null
  dragFieldSource = { sectionIdx, fieldIdx }
  event.dataTransfer?.setData('text/plain', 'reorder')
}

function handleDrop(event: DragEvent, sectionIdx: number): void {
  event.preventDefault()
  dragOverSection.value = null

  if (dragPropertyKey) {
    // Adding a new property from the left panel
    const alreadyInSection = sections.value[sectionIdx].fields.some(
      (f) => f.key === dragPropertyKey,
    )
    if (!alreadyInSection) {
      const newField: BuilderField = { key: dragPropertyKey }
      sections.value = sections.value.map((s, idx) =>
        idx === sectionIdx
          ? { ...s, fields: [...s.fields, newField] }
          : s,
      )
    }
    dragPropertyKey = null
  } else if (dragFieldSource) {
    // Reordering: move field to this section
    const { sectionIdx: fromSection, fieldIdx: fromField } = dragFieldSource
    const field = sections.value[fromSection].fields[fromField]
    if (field) {
      // Remove from source
      const updated = sections.value.map((s, idx) =>
        idx === fromSection
          ? { ...s, fields: s.fields.filter((_, i) => i !== fromField) }
          : s,
      )
      // Add to target
      sections.value = updated.map((s, idx) =>
        idx === sectionIdx
          ? { ...s, fields: [...s.fields, field] }
          : s,
      )
    }
    dragFieldSource = null
  }
}

function handleFieldReorder(
  event: DragEvent,
  targetSection: number,
  targetIdx: number,
): void {
  event.preventDefault()
  if (!dragFieldSource) return

  const { sectionIdx: fromSection, fieldIdx: fromField } = dragFieldSource
  if (fromSection === targetSection && fromField === targetIdx) return

  const field = sections.value[fromSection].fields[fromField]
  if (!field) return

  // Remove from source, insert at target
  let updated = sections.value.map((s, idx) =>
    idx === fromSection
      ? { ...s, fields: s.fields.filter((_, i) => i !== fromField) }
      : s,
  )

  updated = updated.map((s, idx) => {
    if (idx === targetSection) {
      const newFields = [...s.fields]
      newFields.splice(targetIdx, 0, field)
      return { ...s, fields: newFields }
    }
    return s
  })

  sections.value = updated
  dragFieldSource = null
}

/* ---- Section management ---- */

function addSection(): void {
  sections.value = [
    ...sections.value,
    { title: `Section ${sections.value.length + 1}`, fields: [] },
  ]
}

function removeSection(idx: number): void {
  if (sections.value.length <= 1) return
  sections.value = sections.value.filter((_, i) => i !== idx)
  if (activeSection.value >= sections.value.length) {
    activeSection.value = sections.value.length - 1
  }
}

function removeField(sectionIdx: number, fieldIdx: number): void {
  const removedKey = sections.value[sectionIdx].fields[fieldIdx]?.key
  sections.value = sections.value.map((s, idx) =>
    idx === sectionIdx
      ? { ...s, fields: s.fields.filter((_, i) => i !== fieldIdx) }
      : s,
  )
  if (selectedFieldKey.value === removedKey) {
    selectedFieldKey.value = null
  }
}

/* ---- Preview config ---- */

const previewConfig = computed<FormConfig>(() => {
  const allFields: FormFieldConfig[] = []
  for (const section of sections.value) {
    for (const [, field] of section.fields.entries()) {
      allFields.push({
        key: field.key,
        label: field.label,
        placeholder: field.placeholder,
        helpText: field.helpText,
        colSpan: field.colSpan,
        showIf: field.showIf,
        required: field.required,
        readOnly: field.readOnly,
        defaultValue: field.defaultValue,
      })
    }
  }

  return {
    id: formId.value ?? 'preview',
    title: formName.value,
    layout: selectedLayout.value,
    conceptKey: conceptKey.value,
    fields:
      selectedLayout.value !== 'wizard' ? allFields : undefined,
    steps:
      selectedLayout.value === 'wizard'
        ? sections.value.map((s, idx) => ({
            key: `step-${idx}`,
            label: s.title,
            fields: s.fields.map((f) => ({
              key: f.key,
              label: f.label,
              placeholder: f.placeholder,
              helpText: f.helpText,
              colSpan: f.colSpan,
              showIf: f.showIf,
              required: f.required,
              readOnly: f.readOnly,
              defaultValue: f.defaultValue,
            })),
          }))
        : undefined,
  }
})

/* ---- Save ---- */

async function handleSave(): Promise<void> {
  // Validate
  if (selectedLayout.value === 'wizard' && sections.value.length < 2) {
    validationError.value = 'Wizard layout requires at least 2 steps'
    return
  }

  // Check for duplicate keys
  const allKeys = sections.value.flatMap((s) => s.fields.map((f) => f.key))
  const duplicates = allKeys.filter((k, i) => allKeys.indexOf(k) !== i)
  if (duplicates.length > 0) {
    validationError.value = `Duplicate field: '${duplicates[0]}'`
    return
  }

  saving.value = true
  validationError.value = null

  try {
    const config = previewConfig.value
    if (formId.value) {
      await api.put(`/api/form-configs/${formId.value}`, config)
    } else {
      const result = await api.post<{ id: string }>('/api/form-configs', config)
      formId.value = result.id
    }
  } catch (err) {
    validationError.value =
      err instanceof Error ? err.message : 'Failed to save form configuration'
  } finally {
    saving.value = false
  }
}

/* ---- Load existing config ---- */

async function loadExistingConfig(): Promise<void> {
  if (!conceptKey.value) return

  try {
    const configs = await api.get<FormConfig[]>(
      `/api/form-configs?conceptKey=${conceptKey.value}`,
    )
    if (configs.length > 0) {
      const config = configs[0]
      formId.value = config.id
      formName.value = config.title
      selectedLayout.value = config.layout

      if (config.layout === 'wizard' && config.steps) {
        sections.value = config.steps.map((step) => ({
          title: step.label,
          fields: step.fields.map((f) => ({ ...f })),
        }))
      } else if (config.fields) {
        sections.value = [
          {
            title: 'Section 1',
            fields: config.fields.map((f) => ({ ...f })),
          },
        ]
      }
    }
  } catch {
    // No existing config; start fresh
  }
}

/* ---- Lifecycle ---- */

onMounted(async () => {
  await ontologyStore.loadOntology()
  await loadExistingConfig()
})

// Reset when concept changes
watch(conceptKey, async () => {
  sections.value = [{ title: 'Section 1', fields: [] }]
  formId.value = null
  selectedFieldKey.value = null
  formName.value = 'New Form'
  await loadExistingConfig()
})
</script>
