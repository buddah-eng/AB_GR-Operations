<template>
  <div
    :class="[
      'condition-diamond-node flex flex-col items-center cursor-pointer',
      'transition-all duration-150',
      selected ? 'scale-105' : '',
    ]"
  >
    <!-- Diamond shape -->
    <div
      :class="[
        'w-[90px] h-[90px] rotate-45 border-2 flex items-center justify-center shadow-sm',
        selected ? 'border-yellow-500 bg-yellow-50' : 'border-yellow-400 bg-white',
      ]"
    >
      <i class="pi pi-question -rotate-45 text-yellow-600 text-lg" />
    </div>

    <!-- Label (below diamond) -->
    <div class="mt-3 text-xs text-surface-600 text-center max-w-[140px] truncate">
      {{ data.summary }}
    </div>

    <!-- Handles -->
    <Handle type="target" :position="Position.Left" class="!bg-yellow-400 !w-2.5 !h-2.5 !top-1/2 !-left-2" />
    <Handle
      id="true"
      type="source"
      :position="Position.Right"
      class="!bg-green-500 !w-2.5 !h-2.5 !top-1/2 !-right-2"
    />
    <Handle
      id="false"
      type="source"
      :position="Position.Bottom"
      class="!bg-red-400 !w-2.5 !h-2.5 !bottom-0 !left-1/2"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'

export interface ConditionDiamondNodeData {
  readonly summary: string
}

defineProps<{ data: ConditionDiamondNodeData }>()

const { node } = useNode()
const selected = computed(() => node.selected)
</script>
