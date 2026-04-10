<template>
  <div
    :class="[
      'cn-root',
      isGroup ? 'cn-root--group' : 'cn-root--leaf',
      depth > 0 ? 'cn-root--nested' : '',
    ]"
    :role="isGroup ? 'group' : undefined"
    :aria-label="nodeAriaLabel"
  >
    <!-- Comparison node -->
    <div v-if="condition.type === 'comparison'" class="cn-comparison">
      <!-- Field picker -->
      <Select
        :modelValue="condition.field"
        :options="fieldOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Select field"
        class="cn-select cn-select--field"
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
        class="cn-select cn-select--op"
        aria-label="Condition operator"
        @update:modelValue="updateOperator"
      />

      <!-- Value input -->
      <InputText
        v-if="!isUnaryOperator"
        :modelValue="String(condition.value ?? '')"
        placeholder="Value"
        class="cn-input"
        aria-label="Condition value"
        @update:modelValue="updateValue"
      />

      <div class="cn-comparison-actions">
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
    </div>

    <!-- Group node (AND / OR) -->
    <div v-else-if="condition.type === 'and' || condition.type === 'or'" class="cn-group">
      <div class="cn-group-header">
        <SelectButton
          :modelValue="condition.type"
          :options="groupTypeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          aria-label="Group logic type"
          class="cn-group-toggle"
          @update:modelValue="updateGroupType"
        />

        <div class="cn-group-spacer" />

        <div class="cn-group-actions">
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
      </div>

      <!-- Children -->
      <div v-if="children.length === 0" class="cn-group-empty">
        <i class="pi pi-info-circle cn-group-empty-icon" aria-hidden="true" />
        No conditions in this group. Add a condition to get started.
      </div>

      <div class="cn-group-children">
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
    </div>

    <!-- NOT node -->
    <div v-else-if="condition.type === 'not'" class="cn-not">
      <div class="cn-not-header">
        <span class="cn-not-badge">NOT</span>
        <div class="cn-group-spacer" />
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

<style scoped>
/* Root node */
.cn-root {
  border-radius: var(--radius-lg);
  border: var(--border-thin) solid var(--surface-100);
  padding: var(--space-3);
  transition: border-color var(--duration-normal) var(--ease-default);
}

.cn-root--leaf {
  background: var(--bg-card);
}

.cn-root--group {
  background: var(--surface-50);
  border-color: var(--surface-200);
}

.cn-root--nested {
  margin-left: var(--space-6);
}

.cn-root:hover {
  border-color: var(--primary-200);
}

/* Comparison node */
.cn-comparison {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.cn-select {
  font-size: var(--text-sm);
}

.cn-select--field {
  width: 10rem;
}

.cn-select--op {
  width: 9rem;
}

.cn-input {
  width: 10rem;
  font-size: var(--text-sm);
}

.cn-comparison-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

/* Group node */
.cn-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cn-group-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.cn-group-spacer {
  flex: 1;
}

.cn-group-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.cn-group-toggle :deep(.p-selectbutton) {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-wider);
}

/* Group empty */
.cn-group-empty {
  text-align: center;
  padding: var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  background: var(--surface-100);
  border-radius: var(--radius-md);
}

.cn-group-empty-icon {
  font-size: var(--text-sm);
  opacity: 0.5;
}

/* Group children */
.cn-group-children {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* NOT node */
.cn-not {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cn-not-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.cn-not-badge {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  color: var(--color-error);
  background: var(--color-error-bg);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  border: var(--border-thin) solid var(--color-error-bg-border);
}
</style>
