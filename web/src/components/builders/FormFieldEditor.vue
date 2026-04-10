<template>
  <div v-if="field" class="field-editor">
    <div class="field-editor__title section-header">
      Field Configuration
    </div>

    <div class="field-editor__fields">
      <!-- Label override -->
      <div class="form-field">
        <label>Label</label>
        <InputText
          v-model="field.label"
          :placeholder="propertyLabel"
          class="w-full"
        />
      </div>

      <!-- Placeholder -->
      <div class="form-field">
        <label>Placeholder</label>
        <InputText
          v-model="field.placeholder"
          placeholder="Placeholder text"
          class="w-full"
        />
      </div>

      <!-- Help text -->
      <div class="form-field">
        <label>Help Text</label>
        <InputText
          v-model="field.helpText"
          placeholder="Help text shown below field"
          class="w-full"
        />
      </div>

      <!-- ColSpan (two-column only) -->
      <div v-if="showColSpan" class="form-field">
        <label>Column Span</label>
        <SelectButton
          :model-value="field.colSpan ?? 1"
          :options="colSpanOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          @update:model-value="(v: 1 | 2) => { if (field) field.colSpan = v }"
        />
      </div>

      <!-- Required -->
      <div class="field-editor__toggle-row">
        <label class="form-field">Required</label>
        <ToggleButton
          :model-value="field.required ?? false"
          on-label="Yes"
          off-label="No"
          class="!text-xs"
          @update:model-value="(v: boolean) => { if (field) field.required = v }"
        />
      </div>

      <!-- Read only -->
      <div class="field-editor__toggle-row">
        <label class="form-field">Read Only</label>
        <ToggleButton
          :model-value="field.readOnly ?? false"
          on-label="Yes"
          off-label="No"
          class="!text-xs"
          @update:model-value="(v: boolean) => { if (field) field.readOnly = v }"
        />
      </div>

      <!-- ShowIf condition -->
      <div class="form-field">
        <label>Visibility Condition</label>
        <ConditionBuilder
          :model-value="field.showIf ?? null"
          :properties="properties"
          @update:model-value="(v) => { if (field) field.showIf = v ?? undefined }"
        />
      </div>
    </div>
  </div>

  <!-- No field selected -->
  <div v-else class="empty-state">
    <div class="icon">
      <i class="pi pi-arrow-left" />
    </div>
    <p>Click a field on the canvas to configure it</p>
  </div>
</template>

<script setup lang="ts">
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import ToggleButton from 'primevue/togglebutton'

import type { OntologyProperty } from '@/types'
import type { ConditionExpression } from '@/types/forms'
import ConditionBuilder from '@/components/conditions/ConditionBuilder.vue'

export interface BuilderField {
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

defineProps<{
  field: BuilderField | null
  propertyLabel: string
  showColSpan: boolean
  properties: OntologyProperty[]
}>()

const colSpanOptions = [
  { label: '1 col', value: 1 as const },
  { label: '2 cols', value: 2 as const },
]
</script>

<style scoped>
.field-editor {
  padding: var(--space-5);
}

.field-editor__title {
  margin-bottom: var(--space-4);
}

.field-editor__fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.field-editor__toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-editor__toggle-row label {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  letter-spacing: var(--tracking-wide);
}
</style>
