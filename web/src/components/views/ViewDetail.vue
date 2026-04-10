<template>
  <div class="view-detail" role="article" :aria-label="title">
    <!-- Loading state -->
    <div v-if="loading" class="space-y-4" aria-busy="true">
      <Skeleton width="60%" height="2rem" />
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton v-for="n in 6" :key="n" width="100%" height="2.5rem" />
      </div>
    </div>

    <!-- Empty / not found state -->
    <Message
      v-else-if="!data"
      severity="info"
      :closable="false"
    >
      No record selected. Choose a record from the list to view its details.
    </Message>

    <!-- Detail content -->
    <template v-else>
      <div class="mb-6">
        <h2 class="text-xl font-bold text-surface-800">{{ title }}</h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        <div
          v-for="field in displayFields"
          :key="field.key"
          class="py-2"
        >
          <dt class="text-xs font-medium text-surface-400 uppercase tracking-wide mb-1">
            {{ field.label }}
          </dt>
          <dd class="text-sm text-surface-800">
            {{ formatValue(field.value, field.type) }}
          </dd>
        </div>
      </div>

      <!-- Empty fields state -->
      <Message
        v-if="displayFields.length === 0"
        severity="info"
        :closable="false"
        class="mt-4"
      >
        No fields configured for this detail view.
      </Message>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'

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
