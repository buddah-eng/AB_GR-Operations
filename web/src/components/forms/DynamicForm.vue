<template>
  <div class="df-root" role="form" :aria-label="config.title">
    <!-- Loading skeleton -->
    <div
      v-if="loading"
      class="df-skeleton"
      aria-busy="true"
      aria-label="Loading form"
    >
      <div class="skeleton df-skeleton-title" />
      <div class="skeleton df-skeleton-field" v-for="n in 4" :key="n" />
    </div>

    <!-- Error state -->
    <div v-else-if="errorMessage" class="df-error" role="alert">
      <i class="pi pi-exclamation-triangle df-error-icon" aria-hidden="true" />
      <p class="df-error-text">{{ errorMessage }}</p>
    </div>

    <!-- Form content -->
    <template v-else>
      <!-- Header -->
      <div v-if="config.title" class="df-header">
        <h2 class="df-title">{{ config.title }}</h2>
        <p v-if="config.description" class="df-description">
          {{ config.description }}
        </p>
      </div>

      <!-- Wizard layout -->
      <FormWizard
        v-if="config.layout === 'wizard' && stepSchemas.length > 0"
        :steps="stepSchemas"
        :values="formValues"
        :submit-label="config.submitLabel ?? 'Submit'"
        :show-cancel="config.showCancel ?? false"
        :cancel-label="config.cancelLabel ?? 'Cancel'"
        @submit="handleSubmit"
        @cancel="handleCancel"
        @update:values="handleValuesUpdate"
      />

      <!-- Single or two-column layout -->
      <form
        v-else
        class="df-form"
        novalidate
        @submit.prevent="handleSubmit"
      >
        <div
          :class="[
            'df-fields',
            config.layout === 'two-column' ? 'df-fields--two-col' : '',
          ]"
        >
          <div
            v-for="field in visibleSchemaFields"
            :key="field.name"
            :class="[
              'df-field-wrapper',
              config.layout === 'two-column' && getFieldColSpan(field.name) === 2
                ? 'df-field-wrapper--full'
                : '',
            ]"
          >
            <FormKit
              :type="(field.$formkit as any)"
              :name="field.name"
              :label="field.label"
              :placeholder="field.placeholder"
              :help="field.help"
              :validation="field.validation"
              :options="field.options"
              :disabled="field.disabled"
              :value="getFieldValue(field.name)"
              @input="(val: unknown) => setFieldValue(field.name, val)"
            />
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-if="visibleSchemaFields.length === 0"
          class="df-empty"
          role="status"
        >
          <i class="pi pi-file-edit df-empty-icon" aria-hidden="true" />
          <h3 class="df-empty-heading">No fields available</h3>
          <p class="df-empty-text">
            Contact your administrator to configure form fields.
          </p>
        </div>

        <!-- Actions -->
        <div
          v-if="visibleSchemaFields.length > 0"
          class="df-actions"
        >
          <Button
            type="submit"
            :label="config.submitLabel ?? 'Submit'"
            icon="pi pi-check"
          />
          <Button
            v-if="config.showCancel"
            type="button"
            :label="config.cancelLabel ?? 'Cancel'"
            severity="secondary"
            text
            @click="handleCancel"
          />
        </div>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRef, watch } from 'vue'
import { FormKit } from '@formkit/vue'
import Button from 'primevue/button'

import type { OntologyProperty } from '@/types'
import type { FormConfig } from '@/types/forms'
import { useFormSchema } from '@/composables/useFormSchema'
import FormWizard from './FormWizard.vue'

interface Props {
  config: FormConfig
  properties?: OntologyProperty[]
  initialValues?: Record<string, unknown>
  loading?: boolean
  error?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  properties: () => [],
  initialValues: () => ({}),
  loading: false,
  error: null,
})

const emit = defineEmits<{
  submit: [values: Record<string, unknown>]
  save: [values: Record<string, unknown>]
  cancel: []
}>()

const formValues = ref<Record<string, unknown>>({ ...props.initialValues })

// Sync initial values when they change
watch(
  () => props.initialValues,
  (newVals) => {
    formValues.value = { ...newVals }
  },
)

const errorMessage = computed(() => props.error)

const configRef = toRef(props, 'config')
const propertiesRef = toRef(props, 'properties')

const { schemaFields, stepSchemas } = useFormSchema(
  configRef,
  propertiesRef,
  formValues,
)

const visibleSchemaFields = computed(() => schemaFields.value)

function getFieldColSpan(fieldName: string): number {
  const fieldConfig = props.config.fields?.find((f) => f.key === fieldName)
  return fieldConfig?.colSpan ?? 1
}

function getFieldValue(fieldName: string): unknown {
  return formValues.value[fieldName] ?? undefined
}

function setFieldValue(fieldName: string, value: unknown): void {
  formValues.value = { ...formValues.value, [fieldName]: value }
}

function handleValuesUpdate(values: Record<string, unknown>): void {
  formValues.value = { ...values }
}

function handleSubmit(): void {
  emit('submit', { ...formValues.value })
}

function handleCancel(): void {
  emit('cancel')
}
</script>

<style scoped>
.df-root {
}

/* Skeleton loading */
.df-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.df-skeleton-title {
  width: 40%;
  height: 2rem;
}

.df-skeleton-field {
  width: 100%;
  height: 3rem;
}

/* Error */
.df-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-error-bg);
  border: var(--border-thin) solid var(--color-error-bg-border);
  border-radius: var(--radius-lg);
}

.df-error-icon {
  color: var(--color-error);
  font-size: var(--text-lg);
  flex-shrink: 0;
  margin-top: 2px;
}

.df-error-text {
  color: var(--color-error-text);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  margin: 0;
}

/* Header */
.df-header {
  margin-bottom: var(--space-8);
}

.df-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-display);
  margin: 0;
}

.df-description {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: var(--space-2) 0 0;
  line-height: var(--leading-relaxed);
}

/* Form */
.df-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Fields layout */
.df-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.df-fields--two-col {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-5) var(--space-6);
}

@media (min-width: 768px) {
  .df-fields--two-col {
    grid-template-columns: 1fr 1fr;
  }
}

.df-field-wrapper--full {
  grid-column: 1 / -1;
}

/* Empty state */
.df-empty {
  text-align: center;
  padding: var(--space-12) var(--space-8);
  border: var(--border-medium) dashed var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-50);
}

.df-empty-icon {
  font-size: var(--text-4xl);
  color: var(--text-muted);
  opacity: 0.4;
  display: block;
  margin-bottom: var(--space-4);
}

.df-empty-heading {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.df-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  line-height: var(--leading-relaxed);
}

/* Actions */
.df-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-top: var(--space-6);
  border-top: var(--border-thin) solid var(--border-color);
}
</style>
