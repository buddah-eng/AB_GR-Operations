<template>
  <div
    class="condition-preview text-sm text-surface-700 bg-surface-50 rounded-lg p-3 border border-surface-100"
    role="status"
    aria-label="Condition preview"
  >
    <span v-if="!condition" class="text-surface-400 italic">
      No conditions defined
    </span>
    <span v-else>{{ previewText }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { OntologyProperty } from '@/types'
import type { ConditionExpression } from '@/types/forms'

interface Props {
  condition: ConditionExpression | null
  properties?: OntologyProperty[]
}

const props = withDefaults(defineProps<Props>(), {
  properties: () => [],
})

const propertyLabelMap = computed(() => {
  const map = new Map<string, string>()
  for (const prop of props.properties) {
    map.set(prop.key, prop.label)
  }
  return map
})

const previewText = computed(() => {
  if (!props.condition) return ''
  return renderCondition(props.condition)
})

function getFieldLabel(fieldKey: string): string {
  return propertyLabelMap.value.get(fieldKey) ?? fieldKey
}

function formatOperator(operator: string): string {
  const opMap: Record<string, string> = {
    equals: 'equals',
    not_equals: 'does not equal',
    contains: 'contains',
    not_contains: 'does not contain',
    starts_with: 'starts with',
    ends_with: 'ends with',
    greater_than: 'is greater than',
    less_than: 'is less than',
    greater_or_equal: 'is at least',
    less_or_equal: 'is at most',
    is_empty: 'is empty',
    is_not_empty: 'is not empty',
    in: 'is one of',
    not_in: 'is not one of',
    between: 'is between',
  }
  return opMap[operator] ?? operator
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '""'
  if (Array.isArray(value)) {
    return value.map((v) => `"${v}"`).join(', ')
  }
  return `"${value}"`
}

function renderCondition(condition: ConditionExpression): string {
  switch (condition.type) {
    case 'comparison': {
      const field = getFieldLabel(condition.field ?? '')
      const op = formatOperator(condition.operator ?? 'equals')

      if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') {
        return `${field} ${op}`
      }

      if (condition.operator === 'between' && Array.isArray(condition.value)) {
        return `${field} ${op} ${condition.value[0]} and ${condition.value[1]}`
      }

      return `${field} ${op} ${formatValue(condition.value)}`
    }

    case 'and': {
      const parts = (condition.children ?? []).map(renderCondition)
      if (parts.length === 0) return '(empty group)'
      if (parts.length === 1) return parts[0]
      return parts.join(' AND ')
    }

    case 'or': {
      const parts = (condition.children ?? []).map(renderCondition)
      if (parts.length === 0) return '(empty group)'
      if (parts.length === 1) return parts[0]
      return `(${parts.join(' OR ')})`
    }

    case 'not': {
      if (!condition.child) return 'NOT (empty)'
      return `NOT (${renderCondition(condition.child)})`
    }

    default:
      return '(unknown condition)'
  }
}
</script>
