<template>
  <div
    :class="[
      'action-node rounded-lg border-2 shadow-sm px-4 py-3 min-w-[200px] cursor-pointer bg-white',
      'transition-all duration-150 hover:shadow-md relative',
      selected ? 'ring-2 ring-primary-200' : '',
    ]"
    :style="{ borderColor: borderColor }"
  >
    <!-- Position badge -->
    <span
      class="absolute -top-2 -left-2 w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold text-white"
      :style="{ backgroundColor: borderColor }"
    >
      {{ data.position + 1 }}
    </span>

    <!-- Last result indicator -->
    <span
      v-if="data.lastResult"
      :class="[
        'absolute -top-1 -right-1 w-3 h-3 rounded-full border border-white',
        resultDotClass,
      ]"
      :title="resultTitle"
    />

    <!-- Content -->
    <div class="flex items-center gap-2.5">
      <i :class="[iconClass, 'text-lg']" :style="{ color: borderColor }" />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-surface-700 truncate">
          {{ data.label }}
        </div>
        <div class="text-[11px] text-surface-400 truncate">
          {{ actionTypeLabel }}
        </div>
      </div>
    </div>

    <!-- Handles -->
    <Handle type="target" :position="Position.Left" class="!bg-surface-400 !w-2.5 !h-2.5" />
    <Handle type="source" :position="Position.Right" class="!bg-surface-400 !w-2.5 !h-2.5" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { ActionType } from '@/types/workflow'
import { ACTION_TYPE_INFO } from '@/types/workflow'

export interface ActionNodeData {
  readonly label: string
  readonly actionType: ActionType
  readonly position: number
  readonly lastResult?: 'success' | 'failure' | 'never_run' | null
}

defineProps<{ data: ActionNodeData }>()

const { node } = useNode()
const selected = computed(() => node.selected)

const info = computed(() =>
  ACTION_TYPE_INFO.find((a) => a.type === (node.data as ActionNodeData).actionType),
)

const borderColor = computed(() => {
  const color = info.value?.color ?? 'surface'
  const colorMap: Record<string, string> = {
    green: '#22c55e',
    blue: '#3b82f6',
    red: '#ef4444',
    cyan: '#06b6d4',
    indigo: '#6366f1',
    teal: '#14b8a6',
    orange: '#f97316',
    purple: '#a855f7',
    surface: '#9ca3af',
  }
  return colorMap[color] ?? '#9ca3af'
})

const iconClass = computed(() => info.value?.icon ?? 'pi pi-circle')
const actionTypeLabel = computed(() => info.value?.label ?? '')

const resultDotClass = computed(() => {
  const data = node.data as ActionNodeData
  switch (data.lastResult) {
    case 'success':
      return 'bg-green-500'
    case 'failure':
      return 'bg-red-500'
    case 'never_run':
      return 'bg-gray-400'
    default:
      return 'bg-gray-300'
  }
})

const resultTitle = computed(() => {
  const data = node.data as ActionNodeData
  switch (data.lastResult) {
    case 'success':
      return 'Last run: success'
    case 'failure':
      return 'Last run: failed'
    case 'never_run':
      return 'Never executed'
    default:
      return ''
  }
})
</script>
