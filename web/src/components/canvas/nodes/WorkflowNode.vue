<template>
  <div
    :class="[
      'workflow-node rounded-lg border-2 border-dashed shadow-sm px-4 py-3 min-w-[140px] cursor-pointer',
      'transition-all duration-150 hover:shadow-md',
      selected ? 'border-purple-500 ring-2 ring-purple-200' : 'border-purple-300',
    ]"
  >
    <!-- Header row -->
    <div class="flex items-center gap-2">
      <i class="pi pi-sitemap text-sm text-purple-500" />
      <span class="text-sm font-semibold text-surface-900 truncate">
        {{ data.label }}
      </span>
    </div>

    <!-- Status indicator -->
    <div class="flex items-center gap-1 mt-1.5">
      <span class="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
      <span class="text-[10px] text-surface-500">Workflow</span>
    </div>

    <!-- Connection handles -->
    <Handle type="target" :position="Position.Left" class="!bg-purple-400 !w-2 !h-2" />
    <Handle type="source" :position="Position.Right" class="!bg-purple-400 !w-2 !h-2" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { WorkflowNodeData } from '@/types/canvas'

defineProps<{
  data: WorkflowNodeData
}>()

const { node } = useNode()
const selected = computed(() => node.selected)
</script>

<style scoped>
.workflow-node {
  background: #faf5ff;
}
</style>
