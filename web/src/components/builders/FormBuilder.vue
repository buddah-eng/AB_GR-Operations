<template>
  <div class="builder-shell" role="region" aria-label="Form Builder">
    <!-- Toolbar -->
    <div class="builder-toolbar">
      <div class="builder-toolbar__left">
        <i class="pi pi-pencil builder-toolbar__icon" />
        <InputText
          v-model="formName"
          placeholder="Form name"
          class="builder-toolbar__name-input"
          aria-label="Form name"
        />
      </div>

      <div class="builder-toolbar__right">
        <FormLayoutPicker v-model="selectedLayout" />
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

    <!-- Validation warnings -->
    <div v-if="validationWarnings.length > 0" class="builder-warnings">
      <div
        v-for="(warning, idx) in validationWarnings"
        :key="idx"
        class="builder-warnings__item"
      >
        <i class="pi pi-exclamation-triangle builder-warnings__icon" />
        <span>{{ warning }}</span>
      </div>
    </div>

    <!-- Validation errors -->
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
      <div class="builder-preview__container">
        <DynamicForm
          :config="previewConfig"
          :properties="conceptProperties"
          :initial-values="{}"
          @submit="() => {}"
        />
      </div>
    </div>

    <!-- Edit mode: 3-panel layout -->
    <div v-else class="builder-panels">
      <!-- Left: Property list -->
      <div class="builder-sidebar builder-sidebar--left">
        <div class="builder-sidebar__search">
          <InputText
            v-model="propertySearch"
            placeholder="Search properties..."
            class="w-full"
            aria-label="Search properties"
          />
          <div class="builder-sidebar__count">
            {{ unplacedCount }} unplaced
          </div>
        </div>

        <div class="builder-sidebar__list">
          <div
            v-for="prop in filteredProperties"
            :key="prop.key"
            :class="[
              'builder-prop-item',
              isPropertyPlaced(prop.key) ? 'builder-prop-item--placed' : 'builder-prop-item--available',
            ]"
            draggable="true"
            :aria-label="`Drag ${prop.label} to canvas`"
            @dragstart="(e) => handlePropertyDragStart(e, prop)"
          >
            <i
              v-if="isPropertyPlaced(prop.key)"
              class="pi pi-check builder-prop-item__check"
            />
            <i v-else class="pi pi-grip-vertical builder-prop-item__grip" />
            <span class="builder-prop-item__label">{{ prop.label }}</span>
            <Tag
              :value="prop.type"
              rounded
              class="!text-[10px] ml-auto shrink-0"
              severity="secondary"
            />
          </div>

          <!-- Empty property list -->
          <div v-if="filteredProperties.length === 0" class="empty-state">
            <div class="icon">
              <i class="pi pi-search" />
            </div>
            <p>No properties found.</p>
          </div>
        </div>
      </div>

      <!-- Center: Form canvas -->
      <div class="builder-canvas">
        <!-- Wizard step navigator -->
        <div v-if="selectedLayout === 'wizard'" class="builder-wizard-nav">
          <div
            v-for="(section, sIdx) in sections"
            :key="sIdx"
            :class="['builder-wizard-step', activeSection === sIdx ? 'builder-wizard-step--active' : '']"
            @click="activeSection = sIdx"
          >
            <span class="builder-wizard-step__number">{{ sIdx + 1 }}</span>
            <span class="builder-wizard-step__title">{{ section.title }}</span>
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

        <!-- Sections -->
        <div
          v-for="(section, sIdx) in visibleSections"
          :key="sIdx"
          class="builder-section"
        >
          <!-- Section header -->
          <div
            v-if="sections.length > 1 || selectedLayout === 'wizard'"
            class="builder-section__header"
          >
            <InputText
              v-model="section.title"
              class="builder-section__title-input"
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
              'builder-dropzone',
              dragOverSection === sIdx ? 'builder-dropzone--active' : '',
              selectedLayout === 'two-column' ? 'builder-dropzone--two-col' : '',
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
                'builder-field-card',
                selectedFieldKey === field.key ? 'builder-field-card--selected' : '',
                selectedLayout === 'two-column' && field.colSpan === 2 ? 'builder-field-card--full' : '',
              ]"
              draggable="true"
              @click="selectedFieldKey = field.key"
              @dragstart="(e) => handleFieldDragStart(e, sIdx, fIdx)"
              @dragover.prevent
              @drop.stop="(e) => handleFieldReorder(e, sIdx, fIdx)"
            >
              <i class="pi pi-grip-vertical builder-field-card__grip" />
              <span class="builder-field-card__label">
                {{ field.label || getPropertyLabel(field.key) }}
              </span>
              <div class="builder-field-card__actions">
                <i
                  v-if="field.showIf"
                  class="pi pi-eye builder-field-card__condition-icon"
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
              :class="['builder-dropzone__empty', selectedLayout === 'two-column' ? 'builder-dropzone__empty--full' : '']"
            >
              <i class="pi pi-inbox builder-dropzone__empty-icon" />
              <p>Drop properties here to add fields</p>
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
          class="builder-add-section-btn"
          @click="addSection"
        />
      </div>

      <!-- Right: Field config panel -->
      <div class="builder-sidebar builder-sidebar--right">
        <FormFieldEditor
          :field="selectedField"
          :property-label="selectedField ? getPropertyLabel(selectedField.key) : ''"
          :show-col-span="selectedLayout === 'two-column'"
          :properties="conceptProperties"
        />
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
import ToggleButton from 'primevue/togglebutton'

import type { OntologyProperty } from '@/types'
import type { FormConfig, FormFieldConfig, FormLayout } from '@/types/forms'
import { useOntologyStore } from '@/stores/ontology'
import { api } from '@/api/client'
import DynamicForm from '@/components/forms/DynamicForm.vue'
import FormFieldEditor from '@/components/builders/FormFieldEditor.vue'
import type { BuilderField } from '@/components/builders/FormFieldEditor.vue'
import FormLayoutPicker from '@/components/builders/FormLayoutPicker.vue'

/* ---- Route & Store ---- */

const route = useRoute()
const ontologyStore = useOntologyStore()

const conceptKey = computed(() => String(route.params.conceptKey ?? ''))

/* ---- Builder state ---- */

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

<style scoped>
/* Shell */
.builder-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-page);
}

/* Toolbar */
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

/* Warnings */
.builder-warnings {
  flex-shrink: 0;
  padding: var(--space-2) var(--space-5);
  background: var(--accent-50);
  border-bottom: var(--border-thin) solid var(--accent-200);
}

.builder-warnings__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--accent-800);
}

.builder-warnings__icon {
  color: var(--accent-500);
}

.builder-message {
  margin: var(--space-2) var(--space-5) 0;
}

/* Preview */
.builder-preview {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-8);
}

.builder-preview__container {
  max-width: 48rem;
  margin: 0 auto;
}

/* Panels */
.builder-panels {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Sidebar */
.builder-sidebar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.builder-sidebar--left {
  width: 16rem;
  border-right: var(--border-thin) solid var(--border-color);
  background: var(--surface-50);
}

.builder-sidebar--right {
  width: 20rem;
  border-left: var(--border-thin) solid var(--border-color);
  background: var(--bg-card);
}

.builder-sidebar__search {
  padding: var(--space-3);
  border-bottom: var(--border-thin) solid var(--border-color);
}

.builder-sidebar__count {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--space-2);
  letter-spacing: var(--tracking-wide);
}

.builder-sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* Property items */
.builder-prop-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  cursor: grab;
  transition: all var(--duration-fast) var(--ease-default);
}

.builder-prop-item--placed {
  background: var(--surface-100);
  color: var(--text-muted);
}

.builder-prop-item--available {
  background: var(--bg-card);
  border: var(--border-thin) solid var(--border-color);
  color: var(--text-primary);
}

.builder-prop-item--available:hover {
  border-color: var(--primary-300);
  box-shadow: var(--shadow-xs);
  transform: translateY(-1px);
}

.builder-prop-item__check {
  font-size: var(--text-xs);
  color: var(--color-success);
}

.builder-prop-item__grip {
  font-size: var(--text-xs);
  color: var(--surface-300);
}

.builder-prop-item__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Canvas */
.builder-canvas {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  background: var(--surface-50);
}

/* Wizard nav */
.builder-wizard-nav {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
  padding: var(--space-3);
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  border: var(--border-thin) solid var(--border-color);
  box-shadow: var(--shadow-xs);
}

.builder-wizard-step {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  background: var(--surface-100);
  color: var(--text-secondary);
}

.builder-wizard-step:hover {
  background: var(--surface-200);
}

.builder-wizard-step--active {
  background: var(--primary-600);
  color: var(--text-inverse);
}

.builder-wizard-step__number {
  font-weight: var(--weight-bold);
}

.builder-wizard-step__title {
  font-weight: var(--weight-medium);
}

/* Section */
.builder-section {
  margin-bottom: var(--space-6);
}

.builder-section__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.builder-section__title-input {
  flex: 1;
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

/* Dropzone */
.builder-dropzone {
  min-height: 120px;
  border-radius: var(--radius-lg);
  border: var(--border-medium) dashed var(--border-color);
  padding: var(--space-4);
  transition: all var(--duration-fast) var(--ease-default);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.builder-dropzone--active {
  border-color: var(--primary-400);
  background: var(--primary-50);
}

.builder-dropzone--two-col {
  display: grid;
  grid-template-columns: repeat(1, 1fr);
  gap: var(--space-4);
}

@media (min-width: 768px) {
  .builder-dropzone--two-col {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* Field card */
.builder-field-card {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  border: var(--border-thin) solid var(--border-color);
  background: var(--surface-50);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.builder-field-card:hover {
  border-color: var(--surface-300);
  box-shadow: var(--shadow-xs);
}

.builder-field-card--selected {
  border-color: var(--primary-500);
  background: var(--primary-50);
  box-shadow: 0 0 0 3px var(--primary-100);
}

.builder-field-card--full {
  grid-column: span 2;
}

.builder-field-card__grip {
  font-size: var(--text-xs);
  color: var(--surface-300);
  cursor: grab;
}

.builder-field-card__label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.builder-field-card__actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.builder-field-card__condition-icon {
  font-size: 10px;
  color: var(--color-info);
}

.builder-dropzone__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8) 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.builder-dropzone__empty--full {
  grid-column: span 2;
}

.builder-dropzone__empty-icon {
  font-size: var(--text-2xl);
  margin-bottom: var(--space-2);
  opacity: 0.4;
}

.builder-add-section-btn {
  margin-top: var(--space-2);
}

</style>
