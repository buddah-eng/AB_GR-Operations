<script setup lang="ts">
/**
 * DynamicForm Component
 *
 * Renders a form from ontology FormConfig + Property definitions.
 * Supports single-column, two-column, and wizard layouts.
 * Conditional visibility via showIf ConditionExpression evaluation.
 * Uses FormKit for input rendering and validation.
 */
import { ref, computed, watch } from 'vue'
import type {
  OntologyProperty,
  FormConfig,
  FormFieldConfig,
  ConditionExpression,
} from '@/types'

const props = defineProps<{
  config: FormConfig
  properties: OntologyProperty[]
  initialValues?: Record<string, unknown>
  readOnly?: boolean
}>()

const emit = defineEmits<{
  submit: [values: Record<string, unknown>]
  save: [values: Record<string, unknown>]
}>()

const formValues = ref<Record<string, unknown>>({ ...props.initialValues })
const currentStep = ref(0)

const isWizard = computed(() => props.config.layout === 'wizard')
const steps = computed(() => props.config.steps ?? [])
const totalSteps = computed(() => steps.value.length)

const visibleFields = computed(() => {
  return props.config.fields.filter((fieldConfig) => {
    if (!fieldConfig.showIf) return true
    return evaluateCondition(fieldConfig.showIf, formValues.value)
  })
})

const currentStepFields = computed(() => {
  if (!isWizard.value || steps.value.length === 0) return visibleFields.value

  const step = steps.value[currentStep.value]
  if (!step) return []

  const stepFieldKeys = new Set(step.fields)
  return visibleFields.value.filter((f) => stepFieldKeys.has(f.propertyKey))
})

function getProperty(propertyKey: string): OntologyProperty | undefined {
  return props.properties.find((p) => p.key === propertyKey)
}

function getInputType(prop: OntologyProperty): string {
  const typeMap: Record<string, string> = {
    text: 'text',
    rich_text: 'textarea',
    number: 'number',
    select: 'select',
    multi_select: 'select',
    date: 'date',
    datetime: 'datetime-local',
    checkbox: 'checkbox',
    url: 'url',
    email: 'email',
    phone: 'tel',
    status: 'select',
  }
  return typeMap[prop.type] ?? 'text'
}

function getLabel(fieldConfig: FormFieldConfig): string {
  if (fieldConfig.overrideLabel) return fieldConfig.overrideLabel
  const prop = getProperty(fieldConfig.propertyKey)
  return prop?.label ?? fieldConfig.propertyKey
}

function handleSubmit(): void {
  emit('submit', { ...formValues.value })
}

function handleSave(): void {
  emit('save', { ...formValues.value })
}

function nextStep(): void {
  if (currentStep.value < totalSteps.value - 1) {
    currentStep.value++
  }
}

function prevStep(): void {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

// Minimal condition evaluator for client-side showIf
function evaluateCondition(
  expr: ConditionExpression,
  ctx: Record<string, unknown>
): boolean {
  if (expr.type === 'field') {
    const val = ctx[expr.field]
    switch (expr.operator) {
      case 'eq': return val == expr.value
      case 'neq': return val != expr.value
      case 'is_empty': return val === undefined || val === null || val === ''
      case 'is_not_empty': return val !== undefined && val !== null && val !== ''
      case 'contains':
        return typeof val === 'string' ? val.includes(String(expr.value)) : false
      default: return true
    }
  }
  if (expr.type === 'and') {
    return expr.conditions.every((c) => evaluateCondition(c, ctx))
  }
  if (expr.type === 'or') {
    return expr.conditions.some((c) => evaluateCondition(c, ctx))
  }
  if (expr.type === 'not') {
    return !evaluateCondition(expr.condition, ctx)
  }
  return true
}

watch(() => props.initialValues, (newVals) => {
  if (newVals) formValues.value = { ...newVals }
})
</script>

<template>
  <form @submit.prevent="handleSubmit" class="dynamic-form">
    <!-- Wizard step indicator -->
    <div v-if="isWizard && steps.length > 0" class="wizard-steps">
      <div
        v-for="(step, idx) in steps"
        :key="step.name"
        :class="['wizard-step', { active: idx === currentStep, completed: idx < currentStep }]"
      >
        <span class="step-number">{{ idx + 1 }}</span>
        <span class="step-label">{{ step.label }}</span>
      </div>
    </div>

    <!-- Form fields -->
    <div :class="['form-grid', `layout-${config.layout ?? 'single'}`]">
      <div
        v-for="fieldConfig in currentStepFields"
        :key="fieldConfig.propertyKey"
        :class="['form-field', { 'col-span-2': fieldConfig.colSpan === 2 }]"
      >
        <label :for="fieldConfig.propertyKey">
          {{ getLabel(fieldConfig) }}
          <span v-if="getProperty(fieldConfig.propertyKey)?.required" class="required">*</span>
        </label>

        <template v-if="getProperty(fieldConfig.propertyKey)">
          <select
            v-if="getInputType(getProperty(fieldConfig.propertyKey)!) === 'select'"
            :id="fieldConfig.propertyKey"
            v-model="formValues[fieldConfig.propertyKey]"
            :disabled="readOnly"
          >
            <option value="">Select...</option>
            <option
              v-for="opt in getProperty(fieldConfig.propertyKey)!.options"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>

          <textarea
            v-else-if="getInputType(getProperty(fieldConfig.propertyKey)!) === 'textarea'"
            :id="fieldConfig.propertyKey"
            v-model="formValues[fieldConfig.propertyKey] as string"
            :placeholder="fieldConfig.overridePlaceholder ?? getProperty(fieldConfig.propertyKey)?.placeholder"
            :disabled="readOnly"
            rows="4"
          />

          <input
            v-else-if="getInputType(getProperty(fieldConfig.propertyKey)!) === 'checkbox'"
            :id="fieldConfig.propertyKey"
            type="checkbox"
            v-model="formValues[fieldConfig.propertyKey] as boolean"
            :disabled="readOnly"
          />

          <input
            v-else
            :id="fieldConfig.propertyKey"
            :type="getInputType(getProperty(fieldConfig.propertyKey)!)"
            v-model="formValues[fieldConfig.propertyKey] as string"
            :placeholder="fieldConfig.overridePlaceholder ?? getProperty(fieldConfig.propertyKey)?.placeholder"
            :required="getProperty(fieldConfig.propertyKey)?.required"
            :disabled="readOnly"
          />
        </template>
      </div>
    </div>

    <!-- Actions -->
    <div class="form-actions">
      <template v-if="isWizard">
        <button type="button" @click="prevStep" :disabled="currentStep === 0">
          Back
        </button>
        <button type="button" @click="handleSave" class="secondary">
          Save Draft
        </button>
        <button
          v-if="currentStep < totalSteps - 1"
          type="button"
          @click="nextStep"
        >
          Next
        </button>
        <button v-else type="submit" :disabled="readOnly">
          Submit
        </button>
      </template>
      <template v-else>
        <button type="button" @click="handleSave" class="secondary">
          Save Draft
        </button>
        <button type="submit" :disabled="readOnly">
          Submit
        </button>
      </template>
    </div>
  </form>
</template>

<style scoped>
.dynamic-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.wizard-steps {
  display: flex;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--surface-border, #e0e0e0);
}

.wizard-step {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  opacity: 0.5;
}

.wizard-step.active {
  opacity: 1;
  font-weight: bold;
}

.wizard-step.completed {
  opacity: 0.8;
}

.step-number {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--primary-color, #3b82f6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
}

.form-grid {
  display: grid;
  gap: 1rem;
}

.layout-single {
  grid-template-columns: 1fr;
}

.layout-two-column {
  grid-template-columns: 1fr 1fr;
}

.col-span-2 {
  grid-column: span 2;
}

.form-field label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 500;
  font-size: 0.875rem;
}

.required {
  color: red;
}

.form-field input,
.form-field select,
.form-field textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--surface-border, #d1d5db);
  border-radius: 0.375rem;
  font-size: 0.875rem;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  padding-top: 1rem;
  border-top: 1px solid var(--surface-border, #e0e0e0);
}

.form-actions button {
  padding: 0.5rem 1.25rem;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  font-size: 0.875rem;
  background: var(--primary-color, #3b82f6);
  color: white;
}

.form-actions button.secondary {
  background: var(--surface-200, #e5e7eb);
  color: var(--text-color, #374151);
}

.form-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
