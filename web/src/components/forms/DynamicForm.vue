<template>
  <div class="dynamic-form" role="form" :aria-label="config.title">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="space-y-4"
      aria-busy="true"
      aria-label="Loading form"
    >
      <Skeleton width="40%" height="2rem" />
      <Skeleton v-for="n in 4" :key="n" width="100%" height="3rem" />
    </div>

    <!-- Error state -->
    <Message
      v-else-if="errorMessage"
      severity="error"
      :closable="false"
      class="mb-4"
    >
      {{ errorMessage }}
    </Message>

    <!-- Form content -->
    <template v-else>
      <!-- Header -->
      <div v-if="config.title" class="mb-6">
        <h2 class="text-xl font-bold text-surface-800">{{ config.title }}</h2>
        <p v-if="config.description" class="text-sm text-surface-500 mt-1">
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
        class="space-y-5"
        novalidate
        @submit.prevent="handleSubmit"
      >
        <div
          :class="[
            config.layout === 'two-column'
              ? 'grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5'
              : 'space-y-5',
          ]"
        >
          <div
            v-for="field in visibleSchemaFields"
            :key="field.name"
            :class="[
              config.layout === 'two-column' && getFieldColSpan(field.name) === 2
                ? 'md:col-span-2'
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
        <Message
          v-if="visibleSchemaFields.length === 0"
          severity="info"
          :closable="false"
        >
          No fields are available for this form. Contact your administrator to
          configure form fields.
        </Message>

        <!-- Actions -->
        <div
          v-if="visibleSchemaFields.length > 0"
          class="flex items-center gap-3 pt-4 border-t border-surface-200"
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
import Message from 'primevue/message'
import Skeleton from 'primevue/skeleton'

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
