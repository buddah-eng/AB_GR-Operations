<template>
  <div class="vd-root" role="article" :aria-label="title">
    <!-- Loading skeleton -->
    <div v-if="loading" class="vd-skeleton" aria-busy="true">
      <div class="skeleton vd-skeleton-title" />
      <div class="vd-skeleton-grid">
        <div class="skeleton vd-skeleton-field" v-for="n in 6" :key="n" />
      </div>
    </div>

    <!-- Empty / not found state -->
    <div v-else-if="!data" class="vd-empty" role="status">
      <i class="pi pi-file vd-empty-icon" aria-hidden="true" />
      <h3 class="vd-empty-heading">No record selected</h3>
      <p class="vd-empty-text">
        Choose a record from the list to view its details.
      </p>
    </div>

    <!-- Detail content -->
    <template v-else>
      <div class="vd-header">
        <h2 class="vd-title">{{ title }}</h2>
      </div>

      <dl class="vd-fields">
        <div
          v-for="field in displayFields"
          :key="field.key"
          class="vd-field"
        >
          <dt class="vd-field-label">{{ field.label }}</dt>
          <dd class="vd-field-value">
            {{ formatValue(field.value, field.type) }}
          </dd>
        </div>
      </dl>

      <!-- Empty fields state -->
      <div
        v-if="displayFields.length === 0"
        class="vd-no-fields"
        role="status"
      >
        <i class="pi pi-info-circle vd-no-fields-icon" aria-hidden="true" />
        <p class="vd-no-fields-text">No fields configured for this detail view.</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { ViewConfig } from '@/types/views'

interface Props {
  config: ViewConfig
  data: Record<string, unknown> | null
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
})

interface DisplayField {
  key: string
  label: string
  value: unknown
  type?: string
}

const title = computed(() => {
  if (!props.data) return props.config.title ?? 'Detail'
  return String(
    props.data.name ?? props.data.title ?? props.data.label ?? props.config.title ?? 'Detail',
  )
})

const displayFields = computed<DisplayField[]>(() => {
  if (!props.data) return []

  // If columns are configured, use them as field definitions
  if (props.config.columns && props.config.columns.length > 0) {
    return props.config.columns
      .filter((col) => col.visible !== false)
      .map((col) => ({
        key: col.key,
        label: col.label,
        value: props.data?.[col.key],
        type: col.type,
      }))
  }

  // Otherwise, display all non-null data fields
  return Object.entries(props.data)
    .filter(([key, value]) => {
      if (key.startsWith('_')) return false
      if (value === null || value === undefined) return false
      if (typeof value === 'object') return false
      return true
    })
    .map(([key, value]) => ({
      key,
      label: formatLabel(key),
      value,
    }))
})

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim()
}

function formatValue(value: unknown, type?: string): string {
  if (value === null || value === undefined) return '—'

  const strValue = String(value)

  switch (type) {
    case 'date':
      try {
        return new Date(strValue).toLocaleDateString()
      } catch {
        return strValue
      }
    case 'datetime':
      try {
        return new Date(strValue).toLocaleString()
      } catch {
        return strValue
      }
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'currency':
      return typeof value === 'number'
        ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        : strValue
    case 'percentage':
      return typeof value === 'number' ? `${value}%` : strValue
    default:
      return strValue
  }
}
</script>

<style scoped>
.vd-root {
}

/* Skeleton */
.vd-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.vd-skeleton-title {
  width: 60%;
  height: 2rem;
}

.vd-skeleton-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
}

@media (min-width: 768px) {
  .vd-skeleton-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.vd-skeleton-field {
  width: 100%;
  height: 2.5rem;
}

/* Empty state */
.vd-empty {
  text-align: center;
  padding: var(--space-16) var(--space-8);
  border: var(--border-medium) dashed var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-50);
}

.vd-empty-icon {
  font-size: var(--text-4xl);
  color: var(--text-muted);
  opacity: 0.35;
  display: block;
  margin-bottom: var(--space-4);
}

.vd-empty-heading {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.vd-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  line-height: var(--leading-relaxed);
}

/* Header */
.vd-header {
  margin-bottom: var(--space-8);
  padding-bottom: var(--space-4);
  border-bottom: var(--border-medium) solid var(--primary-200);
}

.vd-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-display);
  margin: 0;
}

/* Fields grid */
.vd-fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-5) var(--space-8);
  margin: 0;
}

@media (min-width: 768px) {
  .vd-fields {
    grid-template-columns: 1fr 1fr;
  }
}

.vd-field {
  padding: var(--space-3) 0;
  border-bottom: var(--border-thin) solid var(--surface-100);
}

.vd-field-label {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  margin-bottom: var(--space-1);
}

.vd-field-value {
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: var(--leading-normal);
  margin: 0;
}

/* No fields state */
.vd-no-fields {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface-50);
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-lg);
  margin-top: var(--space-6);
}

.vd-no-fields-icon {
  color: var(--color-info);
  font-size: var(--text-lg);
  flex-shrink: 0;
}

.vd-no-fields-text {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0;
}
</style>
