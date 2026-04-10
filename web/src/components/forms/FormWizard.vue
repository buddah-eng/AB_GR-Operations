<template>
  <div class="fw-root" role="form" aria-label="Multi-step form">
    <!-- Step indicator -->
    <nav class="fw-steps-nav" aria-label="Form steps">
      <ol class="fw-steps-list">
        <li
          v-for="(step, index) in steps"
          :key="step.key"
          class="fw-step-item"
        >
          <button
            type="button"
            :class="[
              'fw-step-button',
              index === currentStep ? 'fw-step-button--active' : '',
              index < currentStep ? 'fw-step-button--complete' : '',
              index > currentStep ? 'fw-step-button--upcoming' : '',
            ]"
            :aria-current="index === currentStep ? 'step' : undefined"
            :aria-label="`Step ${index + 1}: ${step.label}`"
            :disabled="index > currentStep"
            @click="goToStep(index)"
          >
            <span
              :class="[
                'fw-step-badge',
                index < currentStep ? 'fw-step-badge--done' : '',
                index === currentStep ? 'fw-step-badge--current' : '',
              ]"
            >
              <i v-if="index < currentStep" class="pi pi-check" aria-hidden="true" />
              <span v-else>{{ index + 1 }}</span>
            </span>
            <span class="fw-step-label">{{ step.label }}</span>
          </button>

          <span
            v-if="index < steps.length - 1"
            class="fw-step-connector"
            aria-hidden="true"
          />
        </li>
      </ol>

      <!-- Progress bar -->
      <div class="fw-progress-track">
        <div
          class="fw-progress-fill"
          :style="{ width: `${((currentStep) / (steps.length - 1)) * 100}%` }"
        />
      </div>
    </nav>

    <!-- Current step content -->
    <div class="fw-step-content">
      <h3 class="fw-step-title">{{ activeStep.label }}</h3>
      <p v-if="activeStep.description" class="fw-step-description">
        {{ activeStep.description }}
      </p>

      <!-- Empty step state -->
      <div
        v-if="activeStep.fields.length === 0"
        class="fw-step-empty"
        role="status"
      >
        <i class="pi pi-info-circle fw-step-empty-icon" aria-hidden="true" />
        <p class="fw-step-empty-text">No fields configured for this step.</p>
      </div>

      <div class="fw-fields">
        <div v-for="field in activeStep.fields" :key="field.name" class="fw-field">
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
    <div class="fw-actions">
      <div class="fw-actions-left">
        <Button
          v-if="showCancel"
          type="button"
          :label="cancelLabel"
          severity="secondary"
          text
          @click="$emit('cancel')"
        />
      </div>

      <div class="fw-actions-right">
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

<style scoped>
.fw-root {
  font-family: var(--font-body);
}

/* Step navigation */
.fw-steps-nav {
  margin-bottom: var(--space-8);
}

.fw-steps-list {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-3);
}

.fw-step-item {
  display: flex;
  align-items: center;
}

.fw-step-button {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  border: none;
  cursor: pointer;
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  transition: all var(--duration-normal) var(--ease-default);
  background: var(--surface-100);
  color: var(--text-muted);
}

.fw-step-button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.fw-step-button--active {
  background: var(--primary-700);
  color: var(--text-inverse);
  box-shadow: var(--shadow-sm);
}

.fw-step-button--complete {
  background: #dcfce7;
  color: #166534;
}

.fw-step-button--complete:hover {
  background: #bbf7d0;
}

.fw-step-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  background: var(--surface-200);
  color: var(--text-muted);
  flex-shrink: 0;
}

.fw-step-badge--done {
  background: #22c55e;
  color: white;
}

.fw-step-badge--done .pi {
  font-size: 0.625rem;
}

.fw-step-badge--current {
  background: rgba(255, 255, 255, 0.2);
  color: inherit;
}

.fw-step-label {
  display: none;
}

@media (min-width: 640px) {
  .fw-step-label {
    display: inline;
  }
}

.fw-step-connector {
  display: block;
  width: var(--space-4);
  height: 1px;
  background: var(--surface-300);
  margin: 0 var(--space-1);
}

/* Progress bar */
.fw-progress-track {
  width: 100%;
  height: 3px;
  background: var(--surface-200);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.fw-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary-600), var(--accent-400));
  border-radius: var(--radius-full);
  transition: width var(--duration-slow) var(--ease-default);
}

/* Step content */
.fw-step-content {
  margin-bottom: var(--space-8);
}

.fw-step-title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-display);
  margin: 0 0 var(--space-1);
}

.fw-step-description {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0 0 var(--space-5);
  line-height: var(--leading-relaxed);
}

/* Empty step */
.fw-step-empty {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  background: var(--surface-50);
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-lg);
}

.fw-step-empty-icon {
  color: var(--color-info);
  font-size: var(--text-lg);
  flex-shrink: 0;
}

.fw-step-empty-text {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0;
}

/* Fields */
.fw-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* Actions */
.fw-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: var(--space-6);
  border-top: var(--border-thin) solid var(--border-color);
}

.fw-actions-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
</style>
