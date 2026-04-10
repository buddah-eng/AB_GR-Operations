<template>
  <div
    :class="[
      'integration-node rounded-lg border-2 shadow-sm px-4 py-3 min-w-[140px] cursor-pointer',
      'transition-all duration-150 hover:shadow-md',
      selected ? 'border-sky-500 ring-2 ring-sky-200' : 'border-sky-300',
    ]"
  >
    <!-- Header row -->
    <div class="flex items-center gap-2">
      <i class="pi pi-cloud text-sm text-sky-500" />
      <span class="text-sm font-semibold text-surface-900 truncate">
        {{ data.label }}
      </span>
    </div>

    <!-- Type indicator -->
    <div class="flex items-center gap-1 mt-1.5">
      <span class="text-[10px] font-medium text-sky-600 bg-sky-50 rounded-full px-2 py-0.5">
        External System
      </span>
    </div>

    <!-- Connection handles -->
    <Handle type="target" :position="Position.Left" class="!bg-sky-400 !w-2 !h-2" />
    <Handle type="source" :position="Position.Right" class="!bg-sky-400 !w-2 !h-2" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { IntegrationNodeData } from '@/types/canvas'

defineProps<{
  data: IntegrationNodeData
}>()

const { node } = useNode()
const selected = computed(() => node.selected)
</script>

<style scoped>
.integration-node {
  background: #f0f9ff;
}
</style>
