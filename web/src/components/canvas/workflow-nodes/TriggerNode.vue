<template>
  <div
    :class="[
      'trigger-node flex items-center gap-2.5 rounded-lg shadow-sm px-4 py-3 min-w-[180px] cursor-pointer',
      'transition-all duration-150 hover:shadow-md text-white',
      selected ? 'ring-2 ring-white/50' : '',
      bgClass,
    ]"
  >
    <i :class="[iconClass, 'text-lg']" />
    <div class="flex-1 min-w-0">
      <div class="text-sm font-semibold truncate">{{ data.label }}</div>
      <div class="text-[11px] opacity-80 truncate">{{ subtitle }}</div>
    </div>

    <!-- Handles -->
    <Handle type="source" :position="Position.Right" class="!bg-white !w-2.5 !h-2.5" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { TriggerType } from '@/types/workflow'
import { TRIGGER_TYPE_INFO } from '@/types/workflow'

export interface TriggerNodeData {
  readonly label: string
  readonly triggerType: TriggerType
  readonly eventName?: string | null
  readonly fieldName?: string | null
  readonly schedule?: string | null
}

defineProps<{ data: TriggerNodeData }>()

const { node } = useNode()
const selected = computed(() => node.selected)

const bgClass = computed(() => {
  const info = TRIGGER_TYPE_INFO.find((t) => t.type === node.data.triggerType)
  return info?.bgClass ?? 'bg-blue-500'
})

const iconClass = computed(() => {
  const info = TRIGGER_TYPE_INFO.find((t) => t.type === node.data.triggerType)
  return info?.icon ?? 'pi pi-play'
})

const subtitle = computed(() => {
  const data = node.data as TriggerNodeData
  switch (data.triggerType) {
    case 'domain_event':
      return data.eventName ?? 'Event trigger'
    case 'field_changed':
      return `Field: ${data.fieldName ?? 'unknown'}`
    case 'scheduled':
      return data.schedule ?? 'Scheduled'
    case 'manual':
      return 'Manual trigger'
    default:
      return ''
  }
})
</script>
