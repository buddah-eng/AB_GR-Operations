<template>
  <div class="form-wizard" role="form" aria-label="Multi-step form">
    <!-- Step indicator -->
    <nav class="mb-8" aria-label="Form steps">
      <ol class="flex items-center gap-2">
        <li
          v-for="(step, index) in steps"
          :key="step.key"
          class="flex items-center"
        >
          <button
            type="button"
            :class="[
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              index === currentStep
                ? 'bg-primary text-primary-contrast'
                : index < currentStep
                  ? 'bg-green-100 text-green-800'
                  : 'bg-surface-100 text-surface-400',
            ]"
            :aria-current="index === currentStep ? 'step' : undefined"
            :aria-label="`Step ${index + 1}: ${step.label}`"
            :disabled="index > currentStep"
            @click="goToStep(index)"
          >
            <span
              :class="[
                'flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold',
                index < currentStep
                  ? 'bg-green-500 text-white'
                  : index === currentStep
                    ? 'bg-white/20 text-current'
                    : 'bg-surface-200 text-surface-500',
              ]"
            >
              <i v-if="index < currentStep" class="pi pi-check text-xs" />
              <span v-else>{{ index + 1 }}</span>
            </span>
            <span class="hidden sm:inline">{{ step.label }}</span>
          </button>

          <i
            v-if="index < steps.length - 1"
            class="pi pi-chevron-right text-surface-300 mx-1 text-xs"
          />
        </li>
      </ol>
    </nav>

    <!-- Current step content -->
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-surface-800 mb-1">
        {{ activeStep.label }}
      </h3>
      <p
        v-if="activeStep.description"
        class="text-sm text-surface-500 mb-4"
      >
        {{ activeStep.description }}
      </p>

      <!-- Empty step state -->
      <Message
        v-if="activeStep.fields.length === 0"
        severity="info"
        :closable="false"
      >
        No fields configured for this step.
      </Message>

      <div class="space-y-5">
        <div v-for="field in activeStep.fields" :key="field.name">
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
    </div>

    <!-- Navigation buttons -->
    <div class="flex items-center justify-between pt-4 border-t border-surface-200">
      <div>
        <Button
          v-if="showCancel"
          type="button"
          :label="cancelLabel"
          severity="secondary"
          text
          @click="$emit('cancel')"
        />
      </div>

      <div class="flex items-center gap-3">
        <Button
          v-if="currentStep > 0"
          type="button"
          label="Back"
          icon="pi pi-arrow-left"
          severity="secondary"
          outlined
          @click="previousStep"
        />
        <Button
          v-if="currentStep < steps.length - 1"
          type="button"
          label="Next"
          icon="pi pi-arrow-right"
          iconPos="right"
          @click="nextStep"
        />
        <Button
          v-if="currentStep === steps.length - 1"
          type="button"
          :label="submitLabel"
          icon="pi pi-check"
          @click="handleSubmit"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { FormKit } from '@formkit/vue'
import Button from 'primevue/button'
import Message from 'primevue/message'

import type { FormKitSchemaField } from '@/composables/useFormSchema'

interface WizardStep {
  key: string
  label: string
  description?: string
  icon?: string
  fields: FormKitSchemaField[]
}

interface Props {
  steps: WizardStep[]
  values: Record<string, unknown>
  submitLabel?: string
  showCancel?: boolean
  cancelLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  submitLabel: 'Submit',
  showCancel: false,
  cancelLabel: 'Cancel',
})

const emit = defineEmits<{
  submit: [values: Record<string, unknown>]
  cancel: []
  'update:values': [values: Record<string, unknown>]
}>()

const currentStep = ref(0)

const activeStep = computed(() => props.steps[currentStep.value])

function getFieldValue(fieldName: string): unknown {
  return props.values[fieldName] ?? undefined
}

function setFieldValue(fieldName: string, value: unknown): void {
  emit('update:values', { ...props.values, [fieldName]: value })
}

function goToStep(index: number): void {
  if (index <= currentStep.value) {
    currentStep.value = index
  }
}

function nextStep(): void {
  if (currentStep.value < props.steps.length - 1) {
    currentStep.value++
  }
}

function previousStep(): void {
  if (currentStep.value > 0) {
    currentStep.value--
  }
}

function handleSubmit(): void {
  emit('submit', { ...props.values })
}
</script>
