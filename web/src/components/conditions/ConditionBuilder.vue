<template>
  <div
    class="cb-root"
    role="region"
    aria-label="Condition builder"
  >
    <!-- Loading skeleton -->
    <div v-if="loading" class="cb-skeleton" aria-busy="true">
      <div class="skeleton cb-skeleton-row" />
      <div class="skeleton cb-skeleton-row cb-skeleton-row--short" />
    </div>

    <!-- Error state -->
    <div v-else-if="errorMessage" class="cb-error" role="alert">
      <i class="pi pi-exclamation-triangle cb-error-icon" aria-hidden="true" />
      <p class="cb-error-text">{{ errorMessage }}</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="!modelValue" class="cb-empty">
      <i class="pi pi-filter cb-empty-icon" aria-hidden="true" />
      <h3 class="cb-empty-heading">No conditions defined</h3>
      <p class="cb-empty-text">Add a condition to filter data.</p>
      <Button
        label="Add condition"
        icon="pi pi-plus"
        size="small"
        outlined
        @click="addRootComparison"
      />
    </div>

    <!-- Condition tree -->
    <div v-else class="cb-tree">
      <ConditionNode
        :condition="modelValue"
        :properties="properties"
        :depth="0"
        @update="handleUpdate"
        @remove="handleRemoveRoot"
      />

      <!-- Preview -->
      <div class="cb-preview-section">
        <div class="cb-preview-label">Preview</div>
        <ConditionPreview :condition="modelValue" :properties="properties" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'

import type { OntologyProperty } from '@/types'
import type { ConditionExpression } from '@/types/forms'
import ConditionNode from './ConditionNode.vue'
import ConditionPreview from './ConditionPreview.vue'

interface Props {
  modelValue: ConditionExpression | null
  properties: OntologyProperty[]
  loading?: boolean
  error?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  error: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: ConditionExpression | null]
}>()

const errorMessage = computed(() => props.error)

function addRootComparison(): void {
  const firstProp = props.properties[0]
  emit('update:modelValue', {
    type: 'comparison',
    field: firstProp?.key ?? '',
    operator: 'equals',
    value: '',
  })
}

function handleUpdate(updated: ConditionExpression): void {
  emit('update:modelValue', updated)
}

function handleRemoveRoot(): void {
  emit('update:modelValue', null)
}
</script>

<style scoped>
.cb-root {
}

/* Skeleton */
.cb-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cb-skeleton-row {
  width: 100%;
  height: 3rem;
}

.cb-skeleton-row--short {
  width: 80%;
}

/* Error */
.cb-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-error-bg);
  border: var(--border-thin) solid var(--color-error-bg-border);
  border-radius: var(--radius-lg);
}

.cb-error-icon {
  color: var(--color-error);
  font-size: var(--text-lg);
  flex-shrink: 0;
  margin-top: 2px;
}

.cb-error-text {
  color: var(--color-error-text);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  margin: 0;
}

/* Empty state */
.cb-empty {
  text-align: center;
  padding: var(--space-10) var(--space-8);
  border: var(--border-medium) dashed var(--border-color);
  border-radius: var(--radius-xl);
  background: var(--surface-50);
}

.cb-empty-icon {
  font-size: var(--text-3xl);
  color: var(--text-muted);
  opacity: 0.35;
  display: block;
  margin-bottom: var(--space-3);
}

.cb-empty-heading {
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-1);
}

.cb-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0 0 var(--space-4);
  line-height: var(--leading-relaxed);
}

/* Tree */
.cb-tree {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Preview section */
.cb-preview-section {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: var(--border-thin) solid var(--border-color);
}

.cb-preview-label {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  margin-bottom: var(--space-2);
}
</style>
