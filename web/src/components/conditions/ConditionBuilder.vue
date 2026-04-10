<template>
  <div
    class="condition-builder"
    role="region"
    aria-label="Condition builder"
  >
    <!-- Loading state -->
    <div v-if="loading" class="space-y-3" aria-busy="true">
      <Skeleton width="100%" height="3rem" />
      <Skeleton width="80%" height="3rem" />
    </div>

    <!-- Error state -->
    <Message
      v-else-if="errorMessage"
      severity="error"
      :closable="false"
    >
      {{ errorMessage }}
    </Message>

    <!-- Empty state -->
    <div
      v-else-if="!modelValue"
      class="text-center py-8 border-2 border-dashed border-surface-200 rounded-xl"
    >
      <i class="pi pi-filter text-3xl text-surface-300 mb-3" />
      <p class="text-sm text-surface-500 mb-3">
        No conditions defined. Add a condition to filter data.
      </p>
      <Button
        label="Add condition"
        icon="pi pi-plus"
        size="small"
        outlined
        @click="addRootComparison"
      />
    </div>

    <!-- Condition tree -->
    <div v-else class="space-y-4">
      <ConditionNode
        :condition="modelValue"
        :properties="properties"
        :depth="0"
        @update="handleUpdate"
        @remove="handleRemoveRoot"
      />

      <!-- Preview -->
      <div class="mt-4 pt-4 border-t border-surface-200">
        <div class="text-xs font-medium text-surface-400 uppercase tracking-wide mb-2">
          Preview
        </div>
        <ConditionPreview :condition="modelValue" :properties="properties" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'

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
