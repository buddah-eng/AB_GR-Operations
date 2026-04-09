<script setup lang="ts">
/**
 * ConditionBuilder Component
 *
 * Visual builder for ConditionExpression trees.
 * Supports field conditions, and/or groups, and not negation.
 * Used in: form showIf, workflow conditions, constraint conditions,
 * contract clause conditions.
 */
import { ref, computed, watch } from 'vue'
import type { OntologyProperty, ConditionExpression } from '@/types'

const props = defineProps<{
  modelValue: ConditionExpression | null
  fields: OntologyProperty[]
  maxDepth?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ConditionExpression | null]
}>()

const maxNesting = computed(() => props.maxDepth ?? 4)

// Operators grouped by field type
const operatorsByType: Record<string, Array<{ value: string; label: string }>> = {
  text: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  number: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'gt', label: 'greater than' },
    { value: 'gte', label: 'greater or equal' },
    { value: 'lt', label: 'less than' },
    { value: 'lte', label: 'less or equal' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  checkbox: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
  ],
  select: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  multi_select: [
    { value: 'contains', label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  date: [
    { value: 'eq', label: 'equals' },
    { value: 'neq', label: 'not equals' },
    { value: 'gt', label: 'after' },
    { value: 'gte', label: 'on or after' },
    { value: 'lt', label: 'before' },
    { value: 'lte', label: 'on or before' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

function getOperators(fieldKey: string) {
  const field = props.fields.find((f) => f.key === fieldKey)
  if (!field) return operatorsByType.text
  const type = field.type
  return operatorsByType[type] ?? operatorsByType.text
}

function needsValue(operator: string): boolean {
  return !['is_empty', 'is_not_empty'].includes(operator)
}

function addFieldCondition(): void {
  const firstField = props.fields[0]?.key ?? ''
  const newCondition: ConditionExpression = {
    type: 'field',
    field: firstField,
    operator: 'eq',
    value: '',
  }

  if (!props.modelValue) {
    emit('update:modelValue', newCondition)
  } else if (props.modelValue.type === 'and') {
    emit('update:modelValue', {
      type: 'and',
      conditions: [...props.modelValue.conditions, newCondition],
    })
  } else {
    emit('update:modelValue', {
      type: 'and',
      conditions: [props.modelValue, newCondition],
    })
  }
}

function addGroup(groupType: 'and' | 'or'): void {
  const newGroup: ConditionExpression = {
    type: groupType,
    conditions: [],
  }

  if (!props.modelValue) {
    emit('update:modelValue', newGroup)
  } else if (props.modelValue.type === 'and' || props.modelValue.type === 'or') {
    emit('update:modelValue', {
      ...props.modelValue,
      conditions: [...props.modelValue.conditions, newGroup],
    })
  }
}

function removeCondition(index: number): void {
  if (!props.modelValue) return

  if (props.modelValue.type === 'and' || props.modelValue.type === 'or') {
    const newConditions = props.modelValue.conditions.filter((_, i) => i !== index)
    if (newConditions.length === 0) {
      emit('update:modelValue', null)
    } else if (newConditions.length === 1) {
      emit('update:modelValue', newConditions[0])
    } else {
      emit('update:modelValue', {
        ...props.modelValue,
        conditions: newConditions,
      })
    }
  } else {
    emit('update:modelValue', null)
  }
}

function updateCondition(index: number, updated: ConditionExpression): void {
  if (!props.modelValue) return

  if (props.modelValue.type === 'and' || props.modelValue.type === 'or') {
    const newConditions = [...props.modelValue.conditions]
    newConditions[index] = updated
    emit('update:modelValue', {
      ...props.modelValue,
      conditions: newConditions,
    })
  } else {
    emit('update:modelValue', updated)
  }
}

function clear(): void {
  emit('update:modelValue', null)
}
</script>

<template>
  <div class="condition-builder">
    <div v-if="!modelValue" class="empty-state">
      <p>No conditions defined.</p>
      <div class="add-buttons">
        <button type="button" @click="addFieldCondition">+ Add Condition</button>
        <button type="button" @click="addGroup('and')" class="secondary">+ AND Group</button>
        <button type="button" @click="addGroup('or')" class="secondary">+ OR Group</button>
      </div>
    </div>

    <!-- Single field condition -->
    <div v-else-if="modelValue.type === 'field'" class="condition-row">
      <select
        :value="modelValue.field"
        @change="updateCondition(0, { ...modelValue, field: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="f in fields" :key="f.key" :value="f.key">{{ f.label }}</option>
      </select>

      <select
        :value="modelValue.operator"
        @change="updateCondition(0, { ...modelValue, operator: ($event.target as HTMLSelectElement).value as any })"
      >
        <option v-for="op in getOperators(modelValue.field)" :key="op.value" :value="op.value">
          {{ op.label }}
        </option>
      </select>

      <input
        v-if="needsValue(modelValue.operator)"
        :value="modelValue.value as string"
        @input="updateCondition(0, { ...modelValue, value: ($event.target as HTMLInputElement).value })"
        placeholder="Value"
      />

      <button type="button" class="remove" @click="clear">x</button>
    </div>

    <!-- Compound group (and/or) -->
    <div v-else-if="modelValue.type === 'and' || modelValue.type === 'or'" class="condition-group">
      <div class="group-header">
        <span class="group-type">{{ modelValue.type.toUpperCase() }}</span>
        <button type="button" class="remove" @click="clear">x</button>
      </div>

      <div class="group-body">
        <div
          v-for="(child, idx) in modelValue.conditions"
          :key="idx"
          class="group-child"
        >
          <ConditionBuilder
            :model-value="child"
            :fields="fields"
            :max-depth="maxNesting - 1"
            @update:model-value="(val: ConditionExpression | null) => val ? updateCondition(idx, val) : removeCondition(idx)"
          />
        </div>

        <div class="add-buttons">
          <button type="button" @click="addFieldCondition">+ Condition</button>
          <button type="button" @click="addGroup('and')" class="secondary" v-if="maxNesting > 1">+ AND</button>
          <button type="button" @click="addGroup('or')" class="secondary" v-if="maxNesting > 1">+ OR</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.condition-builder {
  font-size: 0.875rem;
}

.condition-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem;
  background: var(--surface-50, #fafafa);
  border-radius: 0.375rem;
}

.condition-row select,
.condition-row input {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--surface-border, #d1d5db);
  border-radius: 0.25rem;
  font-size: 0.8125rem;
}

.condition-group {
  border: 1px solid var(--surface-border, #d1d5db);
  border-radius: 0.5rem;
  padding: 0.75rem;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.group-type {
  font-weight: 600;
  color: var(--primary-color, #3b82f6);
  font-size: 0.75rem;
  text-transform: uppercase;
}

.group-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-child {
  padding-left: 1rem;
  border-left: 2px solid var(--primary-200, #bfdbfe);
}

.add-buttons {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.add-buttons button {
  padding: 0.25rem 0.75rem;
  border: 1px dashed var(--surface-border, #d1d5db);
  border-radius: 0.25rem;
  background: white;
  cursor: pointer;
  font-size: 0.8125rem;
  color: var(--text-color-secondary, #6b7280);
}

.add-buttons button:hover {
  border-color: var(--primary-color, #3b82f6);
  color: var(--primary-color, #3b82f6);
}

.remove {
  background: none;
  border: none;
  color: var(--red-500, #ef4444);
  cursor: pointer;
  padding: 0.25rem;
  font-size: 0.75rem;
}

.empty-state {
  text-align: center;
  padding: 1rem;
  color: var(--text-color-secondary, #9ca3af);
}
</style>
