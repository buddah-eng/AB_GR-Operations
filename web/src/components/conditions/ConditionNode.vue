<template>
  <div
    :class="[
      'condition-node rounded-lg border p-3',
      isGroup ? 'border-surface-200 bg-surface-50' : 'border-surface-100 bg-white',
      depth > 0 ? 'ml-6' : '',
    ]"
    :role="isGroup ? 'group' : undefined"
    :aria-label="nodeAriaLabel"
  >
    <!-- Comparison node -->
    <div v-if="condition.type === 'comparison'" class="flex flex-wrap items-center gap-2">
      <!-- Field picker -->
      <Select
        :modelValue="condition.field"
        :options="fieldOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Select field"
        class="w-40"
        aria-label="Condition field"
        @update:modelValue="updateField"
      />

      <!-- Operator picker -->
      <Select
        :modelValue="condition.operator"
        :options="operatorOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Operator"
        class="w-36"
        aria-label="Condition operator"
        @update:modelValue="updateOperator"
      />

      <!-- Value input -->
      <InputText
        v-if="!isUnaryOperator"
        :modelValue="String(condition.value ?? '')"
        placeholder="Value"
        class="w-40"
        aria-label="Condition value"
        @update:modelValue="updateValue"
      />

      <!-- NOT toggle -->
      <Button
        :icon="isNegated ? 'pi pi-times-circle' : 'pi pi-circle'"
        :severity="isNegated ? 'danger' : 'secondary'"
        text
        rounded
        size="small"
        :aria-label="isNegated ? 'Remove NOT' : 'Add NOT'"
        :title="isNegated ? 'Remove NOT' : 'Negate this condition'"
        @click="toggleNot"
      />

      <!-- Remove button -->
      <Button
        icon="pi pi-trash"
        severity="danger"
        text
        rounded
        size="small"
        aria-label="Remove condition"
        @click="$emit('remove')"
      />
    </div>

    <!-- Group node (AND / OR) -->
    <div v-else-if="condition.type === 'and' || condition.type === 'or'" class="space-y-3">
      <div class="flex items-center gap-2">
        <SelectButton
          :modelValue="condition.type"
          :options="groupTypeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          aria-label="Group logic type"
          @update:modelValue="updateGroupType"
        />

        <div class="flex-1" />

        <Button
          label="Add condition"
          icon="pi pi-plus"
          size="small"
          text
          @click="addChild"
        />

        <Button
          label="Add group"
          icon="pi pi-sitemap"
          size="small"
          text
          severity="secondary"
          @click="addChildGroup"
        />

        <!-- Remove group button -->
        <Button
          v-if="depth > 0"
          icon="pi pi-trash"
          severity="danger"
          text
          rounded
          size="small"
          aria-label="Remove group"
          @click="$emit('remove')"
        />
      </div>

      <!-- Children -->
      <div v-if="children.length === 0" class="text-center py-4 text-xs text-surface-400">
        No conditions in this group. Add a condition to get started.
      </div>

      <ConditionNode
        v-for="(child, index) in children"
        :key="index"
        :condition="child"
        :properties="properties"
        :depth="depth + 1"
        @update="(updated: ConditionExpression) => updateChild(index, updated)"
        @remove="removeChild(index)"
      />
    </div>

    <!-- NOT node -->
    <div v-else-if="condition.type === 'not'" class="space-y-3">
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold uppercase text-red-600 bg-red-50 px-2 py-1 rounded">
          NOT
        </span>
        <div class="flex-1" />
        <Button
          icon="pi pi-trash"
          severity="danger"
          text
          rounded
          size="small"
          aria-label="Remove NOT group"
          @click="$emit('remove')"
        />
      </div>

      <ConditionNode
        v-if="condition.child"
        :condition="condition.child"
        :properties="properties"
        :depth="depth + 1"
        @update="updateNotChild"
        @remove="$emit('remove')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'

import type { OntologyProperty } from '@/types'
import type { ConditionExpression, ConditionOperator } from '@/types/forms'

interface Props {
  condition: ConditionExpression
  properties: OntologyProperty[]
  depth: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  update: [condition: ConditionExpression]
  remove: []
}>()

const isGroup = computed(
  () => props.condition.type === 'and' || props.condition.type === 'or',
)

const isNegated = computed(() => false) // Managed at parent level via NOT wrapper

const isUnaryOperator = computed(() => {
  const op = props.condition.operator
  return op === 'is_empty' || op === 'is_not_empty'
})

const children = computed(() => props.condition.children ?? [])

const nodeAriaLabel = computed(() => {
  if (props.condition.type === 'comparison') {
    return `Condition: ${props.condition.field} ${props.condition.operator} ${props.condition.value}`
  }
  if (isGroup.value) {
    return `${props.condition.type.toUpperCase()} group with ${children.value.length} conditions`
  }
  return 'Condition'
})

// Field options from properties
const fieldOptions = computed(() =>
  props.properties.map((p) => ({
    label: p.label,
    value: p.key,
  })),
)

// Operator options filtered by selected field type
const operatorOptions = computed(() => {
  const field = props.condition.field
  const property = props.properties.find((p) => p.key === field)
  return getOperatorsForType(property?.type ?? 'text')
})

const groupTypeOptions = [
  { label: 'AND', value: 'and' },
  { label: 'OR', value: 'or' },
]

function getOperatorsForType(
  type: string,
): Array<{ label: string; value: ConditionOperator }> {
  const common: Array<{ label: string; value: ConditionOperator }> = [
    { label: 'equals', value: 'equals' },
    { label: 'does not equal', value: 'not_equals' },
    { label: 'is empty', value: 'is_empty' },
    { label: 'is not empty', value: 'is_not_empty' },
  ]

  const textOps: Array<{ label: string; value: ConditionOperator }> = [
    { label: 'contains', value: 'contains' },
    { label: 'does not contain', value: 'not_contains' },
    { label: 'starts with', value: 'starts_with' },
    { label: 'ends with', value: 'ends_with' },
  ]

  const numericOps: Array<{ label: string; value: ConditionOperator }> = [
    { label: 'greater than', value: 'greater_than' },
    { label: 'less than', value: 'less_than' },
    { label: 'greater or equal', value: 'greater_or_equal' },
    { label: 'less or equal', value: 'less_or_equal' },
    { label: 'between', value: 'between' },
  ]

  const listOps: Array<{ label: string; value: ConditionOperator }> = [
    { label: 'is one of', value: 'in' },
    { label: 'is not one of', value: 'not_in' },
  ]

  switch (type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'url':
    case 'phone':
      return [...common, ...textOps]
    case 'number':
    case 'integer':
    case 'decimal':
    case 'currency':
    case 'percentage':
      return [...common, ...numericOps]
    case 'date':
    case 'datetime':
    case 'time':
      return [...common, ...numericOps]
    case 'select':
    case 'radio':
      return [...common, ...listOps]
    case 'multi_select':
      return [...common, ...listOps, ...textOps.slice(0, 2)]
    case 'boolean':
      return common.slice(0, 2)
    default:
      return [...common, ...textOps]
  }
}

function updateField(field: unknown): void {
  emit('update', {
    ...props.condition,
    field: String(field),
  })
}

function updateOperator(operator: unknown): void {
  emit('update', {
    ...props.condition,
    operator: String(operator) as ConditionOperator,
  })
}

function updateValue(value: unknown): void {
  emit('update', {
    ...props.condition,
    value,
  })
}

function updateGroupType(type: unknown): void {
  emit('update', {
    ...props.condition,
    type: String(type) as 'and' | 'or',
  })
}

function toggleNot(): void {
  // Wrap in NOT or unwrap
  emit('update', {
    type: 'not',
    child: { ...props.condition },
  })
}

function addChild(): void {
  const firstProp = props.properties[0]
  const newChild: ConditionExpression = {
    type: 'comparison',
    field: firstProp?.key ?? '',
    operator: 'equals',
    value: '',
  }

  emit('update', {
    ...props.condition,
    children: [...children.value, newChild],
  })
}

function addChildGroup(): void {
  const firstProp = props.properties[0]
  const newGroup: ConditionExpression = {
    type: 'and',
    children: [
      {
        type: 'comparison',
        field: firstProp?.key ?? '',
        operator: 'equals',
        value: '',
      },
    ],
  }

  emit('update', {
    ...props.condition,
    children: [...children.value, newGroup],
  })
}

function updateChild(index: number, updated: ConditionExpression): void {
  const newChildren = children.value.map((child, i) =>
    i === index ? updated : child,
  )

  emit('update', {
    ...props.condition,
    children: newChildren,
  })
}

function removeChild(index: number): void {
  const newChildren = children.value.filter((_, i) => i !== index)
  emit('update', {
    ...props.condition,
    children: newChildren,
  })
}

function updateNotChild(updated: ConditionExpression): void {
  emit('update', {
    ...props.condition,
    child: updated,
  })
}
</script>
